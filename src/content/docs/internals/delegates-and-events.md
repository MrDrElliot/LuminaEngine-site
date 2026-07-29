---
title: Delegates and Events
description: Single and multicast delegates, reentrancy rules, core delegates, script delegates, and the input event processor.
---

Lumina has three separate notification mechanisms, and they are not
interchangeable:

| Mechanism | For |
| --- | --- |
| **Delegates** (`Core/Delegates`) | Engine-side C++ callbacks. Type safe, in-process, synchronous. |
| **Script delegates** (`Core/Delegates/ScriptDelegate.h`) | Reflected events that both C++ and C# can bind to. |
| **Events** (`Runtime/Events`) | Input and window events, dispatched through a prioritized handler chain. |

The gameplay message bus (tag-addressed messages between entities) is a fourth,
separate thing; see [Gameplay Tags](/manual/gameplay-tags/) and
[Events](/manual/scripting/events/) in the scripting section.

## Single-cast delegates

`TBaseDelegate<R, Args...>` holds one callable.

```cpp
using FMyDelegate = TBaseDelegate<bool, int32>;

auto D = FMyDelegate::CreateLambda([](int32 X) { return X > 0; });
auto E = FMyDelegate::CreateMember(this, &FThing::Handle);
auto F = FMyDelegate::CreateStatic(&FreeFunction);

if (D.IsBound())
{
    bool Result = D.Execute(5);
}
D.Unbind();
```

- `Execute` **asserts** if nothing is bound. Check `IsBound()` first, or use
  `ExecuteIfBound`, which returns false instead of asserting and is only
  available on void-returning delegates.
- `CreateMember` captures a raw object pointer in a lambda. The delegate does not
  keep the object alive and does not know when it dies. Unbind in the owner's
  destructor.

## Multicast delegates

`TMulticastDelegate<R, Args...>` holds an invocation list. Declare one with a
macro so it gets a real type name:

```cpp
DECLARE_MULTICAST_DELEGATE(FProjectLoadedDelegate);                 // void()
DECLARE_MULTICAST_DELEGATE(FWindowResizeDelegate, FWindow*, FUIntVector2);
DECLARE_MULTICAST_DELEGATE_R(FQueryDelegate, bool, int32);          // explicit return type first
```

```cpp
FDelegateHandle Handle = OnThing.AddMember(this, &FThing::Handle);
FDelegateHandle H2     = OnThing.AddLambda([]{ /* ... */ });
OnThing.Broadcast();
OnThing.Remove(Handle);
```

`Add*` is `NODISCARD`: the returned `FDelegateHandle` is how you unsubscribe.
Handles come from a process-wide atomic counter starting at 1, so 0 is always
invalid.

If you genuinely intend an engine-lifetime subscription, discard it explicitly so
the intent is visible:

```cpp
(void)FCoreDelegates::OnSettingsSaved.AddLambda([](CClass* Class) { /* ... */ });
```

### Reentrancy

This is the part worth reading carefully, because subscribers routinely modify
the delegate they are being invoked from.

`Broadcast` increments a lock count for its duration. While locked:

- **`Remove` and `Clear` defer.** The entry's handle is reset and its callable
  unbound, marking it dead; the list is compacted when the lock count returns to
  zero. So removing a subscriber during a broadcast does not invalidate the
  iteration, and a subscriber removed mid-broadcast that has not been reached yet
  will not fire.
- **`Add` during a broadcast does not fire this broadcast.** The loop captures
  the list size up front, so entries appended during iteration are skipped until
  the next `Broadcast`.
- Each entry is **copied before invocation**, so a subscriber that destroys the
  entry it is running from does not pull the callable out from under itself.
- Nested broadcasts work: the lock count nests, and compaction happens once on
  the outermost unwind.

What is still unsafe: destroying the object that **owns** the delegate from
inside one of its own broadcasts. The lock count protects the list, not the
delegate's storage.

### BroadcastAndClear

`BroadcastAndClear` broadcasts and then clears the list. `FCoreDelegates::OnPreEngineInit`
and `OnPostEngineInit` use it, which has a consequence people hit regularly:

> **A subscriber added after the broadcast never fires.** These are one-shot
> lifecycle signals, not standing subscriptions.

Subscribe from a module constructor or `StartupModule`, not from a lazily created
singleton that may not exist yet at broadcast time. See
[Application Lifecycle](/internals/application-lifecycle/).

### Threading

Delegates are **not** thread safe. There is no lock around the invocation list;
the lock count is a reentrancy guard, not a mutex. Broadcast and mutate from one
thread, normally the game thread. To signal across threads, marshal with
`MainThread::Enqueue` and broadcast there.

## Core delegates

`FCoreDelegates` (`Core/Delegates/CoreDelegates.h`) is the set of engine-wide
signals. They are `RUNTIME_API` static members specifically so applications and
game DLLs can subscribe across a module boundary.

| Delegate | Fires |
| --- | --- |
| `OnPreEngineInit` | Before engine subsystems come up. Broadcast and clear. In a packaged game this is where the cooked `.pak` is mounted. |
| `OnPostEngineInit` | After all engine init, before the main loop. Broadcast and clear. Starts the cooked game in a packaged build. |
| `OnPreEngineShutdown` | First step of `FEngine::Shutdown`. Broadcast and clear. |
| `OnModuleLoaded(FModuleInfo*)` / `OnModuleUnloaded()` | Module lifecycle. |
| `PostWorldUnload` | After a world is unloaded. |
| `OnWorldTravelled(OldWorld, NewWorld)` | After `FEngine::Travel` swaps worlds. **`OldWorld` is already torn down**, so it is valid only for identity comparison. Subscribers must drop cached entity handles and property tables pointing at it. |
| `OnContentFileModified(Path)` | Editor file watchers saw a content change. Subscribers filter by extension. Editor-only in practice. |
| `OnContentFileRenamed(OldPath, NewPath)` | A tracked text asset was renamed or moved. Open file editors retarget so a later save writes the new file. |
| `OnSettingsSaved(CClass*)` | A `CDeveloperSettings` class was persisted. Lets open editors live-refresh instead of waiting for a reopen. The input action map and audio settings rebuild from this. |
| `OnGameQuitRequested` | Gameplay asked to quit. The editor binds this to end the PIE session; when unbound (a packaged game) the engine exits the process. |

That last one is a useful pattern: the delegate's **bound state** is the branch.
The engine does not need to know whether an editor exists.

## Script delegates

`TScriptDelegate<TPayload>` is a reflectable multicast event that **both C++ and
C# can bind to**, carrying one blittable payload struct. It is what backs
delegate properties on components (collision callbacks, perception events, and
so on).

```cpp
PROPERTY(Editable, Category = "Events")
TScriptDelegate<SCollisionEvent> OnHit;
```

Structurally it is two lists behind one interface:

- A native `TMulticastDelegate` with the usual `AddStatic` / `AddMember` /
  `AddLambda` / `Remove` and `FDelegateHandle` semantics.
- A managed list of `(thunk, context)` pairs bound through `BindManaged`, removed
  by id through `UnbindManaged`, both reentrancy safe.

`Broadcast` fans out to the native list first, then the managed one, passing a
pointer to the payload (or null for the `void` specialization). `IsBound()` is
true if **either** side has listeners.

Details that matter:

- `FScriptDelegateBase` sits at **offset 0** of `TScriptDelegate<T>`, which is
  what lets the non-templated interop code operate on any script delegate.
- **Copy and move are inert.** A copied or moved component starts unbound rather
  than aliasing the original's listeners. Duplicating an entity therefore does
  not double-fire its events, which is almost always what you want, and is a
  surprise if you expected listeners to carry over.
- The managed side owns its GC handles. `GOnScriptDelegateDestroyed` is installed
  by the .NET host and called when a delegate with live managed bindings is
  destroyed, so the handles are released. See
  [Scripting Host](/internals/scripting-host/).
- `BindManaged` is **game thread only**.

## Input events

`Runtime/Events` is a different mechanism entirely: a polymorphic event object
dispatched through a prioritized handler chain. It carries input and window
events, not gameplay signals.

### Event objects

`FEvent` is the base. Each concrete event uses `EVENT_CLASS_TYPE(Type)`, which
generates `GetStaticType()`, `GetEventType()`, and `GetName()`.

```cpp
bool FMyHandler::OnEvent(FEvent& Event)
{
    if (Event.IsA<FKeyPressedEvent>())
    {
        FKeyPressedEvent& Key = Event.As<FKeyPressedEvent>();
        // ...
        return true;   // consumed
    }
    return false;
}
```

`EEventType` covers keys (`KeyPressed`, `KeyReleased`, `KeyRepeat`, `CharInput`,
`CharInputMods`), the mouse (`MouseButtonPressed`, `MouseButtonReleased`,
`MouseMoved`, `MouseScrolled`, `MouseEntered`, `MouseLeft`), the window
(`WindowResize`, `WindowClose`, `WindowFocus`, `WindowLostFocus`, `WindowMoved`,
`WindowMaximized`, `WindowMinimized`, `WindowRestored`, `WindowRefresh`,
`WindowContentScaleChanged`, `FramebufferResize`), `FileDrop`, joystick connect
and disconnect, and the app ticks.

`IsHandled()` and `SetHandled()` carry consumption state on the event itself,
alongside the boolean return from `OnEvent`.

### The processor

`FEventProcessor` owns the handler list. `FApplication` owns the processor.

```cpp
Processor.RegisterEventHandler(Handler, (int32)EInputLayer::Viewport);
Processor.Dispatch<FKeyPressedEvent>(Key, Mods);
Processor.UnregisterEventHandler(Handler);
```

`Dispatch<TEvent>(Args...)` constructs the event in place and dispatches it, so
there is no allocation per event.

Handlers are ordered by priority, and **higher values are dispatched first**:

| Layer | Priority | Registered by |
| --- | --- | --- |
| `Viewport` | 1000 | `FInputViewportRegistry` |
| `EditorChrome` | 500 | The development tool UI |
| `Default` | 0 | Everything else |

A handler returning true consumes the event. That ordering is what lets a focused
viewport take input before editor chrome sees it. See
[Platform Layer](/internals/platform/) for the input viewport model.

Handlers are raw pointers. **Unregister before destruction**, or the processor
dispatches into freed memory.

## Choosing between them

| Need | Use |
| --- | --- |
| One C++ callback, engine internal | `TBaseDelegate` |
| Many C++ callbacks, engine internal | `TMulticastDelegate` plus a `DECLARE_*` macro |
| An engine-wide lifecycle signal | Add to `FCoreDelegates` |
| An event a C# script should be able to bind to | `TScriptDelegate<T>` as a reflected property |
| Input or window input routing | An `IEventHandler` registered on `FEventProcessor` |
| Gameplay messages between entities | The tag-addressed message bus |

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Assert inside `Execute` | Nothing bound. Use `IsBound()` or `ExecuteIfBound`. |
| Crash after an object is destroyed | A member binding outlived its object. Delegates hold raw pointers and do not keep anything alive. |
| A core delegate callback never runs | `OnPreEngineInit` / `OnPostEngineInit` / `OnPreEngineShutdown` are broadcast and clear. The subscription happened too late. |
| A subscriber added during a broadcast did not fire | By design. The invocation list size is captured before iteration; it fires on the next broadcast. |
| Crash iterating after a subscriber unsubscribed itself | Should not happen: removal defers while locked. If it does, something mutated the list without going through `Remove` or `Clear`. |
| Duplicated entity does not fire the original's events | By design. Script delegate copy and move are inert; a copy starts unbound. |
| Managed listeners leak GC handles | The delegate was destroyed without the host's destroyed-callback installed, or the script generation unloaded with a stale holder. |
| Input reaches the wrong handler | Priority ordering. Higher layer values are dispatched first, and returning true consumes. |
| Dispatch into freed memory | A handler destroyed without `UnregisterEventHandler`. |
