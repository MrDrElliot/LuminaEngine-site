---
title: Input
description: Defining input actions and reading them from a script.
---

An **action** is a named input like `"Jump"`, `"Interact"`, or `"MoveForward"`,
defined once in project settings and bound to whatever keys you like. Scripts
react to the action, not to the key, so controls stay data.

There are three ways to read input in a script.

- **Bind to an action** with an `SInputAction` or `SInputAxis` field. You pick the
  action from a dropdown in the inspector and subscribe to its events. This is
  the usual choice.
- **Poll state** through `World.Input`. You ask each frame whether a key or
  action is down. Good for continuous input like movement.
- **React to raw events** with `OnInput`. The engine hands you each key and mouse
  event as it happens, before any action mapping.

All three work only in play mode, for the viewport that has input focus.

A fourth thing shapes all of them: **mapping contexts**, layers you push to change
what input means right now. A pause menu pushes one so gameplay stops hearing the
movement keys. See [Mapping contexts](#mapping-contexts).

## Defining actions

Actions live in **File > Settings > Engine > Input**, and are saved to the
project's `Config/InputSettings.json`. Add an action, name it, then add the
bindings that feed it.

| Action field | What it does |
| --- | --- |
| **Name** | The name scripts refer to. |
| **Type** | `Digital` is on or off. `Axis1D` produces a value. `Axis2D` produces a value per channel, for a movement stick. |
| **Runs In UI** | Keep firing while the viewport is in UI input mode. Superseded by mapping contexts, but still honoured when no context is pushed. |
| **Dead Zone** | Input below this magnitude reads as zero, and the rest is rescaled so full deflection still reaches its old value. Applied radially on `Axis2D`. |
| **Sensitivity** | Multiplies the value. The usual home for mouse look sensitivity. |
| **Invert** | Flips the sign. |
| **Hold Time** | Seconds the action must stay down before it counts as held. `0` means held from the first frame. |
| **Tap Time** | A press released within this many seconds also reports a tap. |

| Binding field | What it does |
| --- | --- |
| **Key** | The key or mouse button, with an optional Ctrl, Shift, or Alt chord. |
| **Scale** | What this binding contributes while held, for example `+1` and `-1` for a pair. Also multiplies a mouse source. |
| **Source** | `Key` reads the key above. `MouseX`, `MouseY`, and `MouseWheel` read this frame's motion instead, and ignore the key. |
| **Channel** | Which channel of an `Axis2D` action this binding drives, `X` or `Y`. Ignored by the other types. |

So a movement stick is one `Axis2D` action with four key bindings, A at `-1` on
X, D at `+1` on X, S at `-1` on Y, W at `+1` on Y. Mouse look is an `Axis1D`
action with a single `MouseX` binding and sensitivity to taste.

Actions are keyboard and mouse only. Gamepads are not supported yet.

## Bind to an action

Declare an `SInputAction` (digital) or `SInputAxis` (analog) field, mark it
`[Property]`, and the inspector shows a dropdown of the project's actions. The
field stores the action's name, so rebinding a key never touches the script.

```csharp
public sealed class Player : EntityScript
{
    [Property] public SInputAction Jump = new("Jump");
    [Property] public SInputAxis   Move = new("MoveForward");

    public override void OnReady()
    {
        Jump.Pressed += () => Launch();
        Jump.Held    += Seconds => ChargeJump(Seconds);
    }

    public override void OnUpdate(float DeltaTime)
    {
        Transform.Translate(Transform.GetForward() * (Move.Value * 5.0f * DeltaTime));
    }
}
```

The constructor argument is just the default shown in the inspector, and you can
leave it out. Declaring a binding is enough on its own, the entity gets its input
component automatically.

Bindings are updated once per frame, before `OnUpdate`, so a handler and a poll
in the same frame agree.

`SInputAction` members.

| Member | What it is |
| --- | --- |
| `Pressed` | Event, raised on the frame the action goes down. |
| `Released` | Event, raised on the frame it comes up. |
| `Held` | Event, raised every frame once it has been down for **Hold Time**. Carries seconds held. |
| `Tapped` | Event, raised when a press shorter than **Tap Time** is released. |
| `IsDown` / `WasPressed` / `WasReleased` / `IsHeld` | The same state, polled. |
| `HeldTime` | Seconds the current press has lasted, `0` while up. |

`SInputAxis` members.

| Member | What it is |
| --- | --- |
| `Changed` | Event, raised when the value differs from last frame, including the frame it returns to zero. |
| `Changed2D` | The same, for both channels of an `Axis2D` action. |
| `Value` | The value this frame, the X channel of an `Axis2D` action. |
| `Value2D` | Both channels of an `Axis2D` action. |
| `IsMoving` | `true` while the axis is off zero. |

Both also expose `Name`, which you can assign at runtime to point the binding at
a different action, and `IsBound`, which is `false` when the name matches no
action in the settings.

## Poll state: `World.Input`

Polling asks "is this down right now?" each frame, through `World.Input`. It is
scoped to the world, not to one entity, so it needs no component and no setup.

```csharp
public sealed class Player : EntityScript
{
    public override void OnUpdate(float DeltaTime)
    {
        if (World.Input.IsKeyDown(EKey.W))
        {
            Transform.Translate(Transform.GetForward() * (5.0f * DeltaTime));
        }

        Transform.AddYaw(World.Input.MouseDelta.X * 0.1f);
    }
}
```

| Member | Returns |
| --- | --- |
| `IsActionDown(name)` / `WasActionPressed(name)` / `WasActionReleased(name)` | `bool` |
| `IsActionHeld(name)` | `bool`, down and past the action's **Hold Time** |
| `WasActionTapped(name)` | `bool`, on the frame a short press was released |
| `GetActionHeldTime(name)` | Seconds the current press has lasted |
| `GetActionAxis(name)` / `GetActionAxis2D(name)` | The action's value, and both channels |
| `GetActionState(name)` | The whole `FInputActionState` at once, if you want several fields |
| `GetAxis(positive, negative)` | `+1`, `-1`, or `0` from two digital actions |
| `IsKeyDown(EKey)` / `WasKeyPressed(EKey)` / `WasKeyReleased(EKey)` | `bool` |
| `IsMouseButtonDown(EMouseKey)` / `WasMouseButtonPressed` / `WasMouseButtonReleased` | `bool` |
| `MousePosition` / `MouseDelta` | `FVector2` |
| `MouseWheel` | `float`, this frame's signed wheel amount |
| `IsReceivingInput` | `true` only when this world has input focus |

Keys and buttons are enum values, `EKey.W`, `EKey.Space`, `EKey.LeftShift`,
`EMouseKey.ButtonLeft`, so a typo is a compile error rather than a query that
silently never fires.

Everything here returns the neutral value when the world does not have input
focus, so you rarely need to test `IsReceivingInput` first.

The raw key and mouse members read the device directly. They are not rebindable
and every entity in the world sees the same values, so reach for an action first
and keep these for debug keys and prototypes.

## React to raw events: `OnInput`

Override `OnInput` and the engine calls it once per keyboard or mouse event,
before any action mapping. Use it for text entry, debug keys, and anything that
should not go through an action.

```csharp
public override void OnReady()
{
    EnableInput();
}

public override void OnInput(SInputEvent Event)
{
    if (Event.IsKeyDown(EKey.Space) && !Event.IsRepeat())
    {
        Jump();
    }
    else if (Event.Type == EInputEventType.MouseScroll)
    {
        Zoom((float)Event.Scroll);
    }
}
```

The `SInputEvent` fields.

| Field | Meaning |
| --- | --- |
| `Type` | `KeyDown`, `KeyUp`, `MouseDown`, `MouseUp`, `MouseMove`, or `MouseScroll` (`EInputEventType`). |
| `Device` | `Keyboard`, `Mouse`, or `None` for move and scroll (`EKeyDevice`). |
| `Key` | The `EKey`, when `Device` is `Keyboard`. |
| `Button` | The `EMouseKey`, when `Device` is `Mouse`. |
| `Flags` | Shift, Ctrl, Alt, and Repeat, as `EInputEventFlags` bits. Read them with the helpers below. |
| `MouseX` / `MouseY` | The cursor position. |
| `DeltaX` / `DeltaY` | Cursor movement, on `MouseMove`. |
| `Scroll` | The signed wheel amount, on `MouseScroll`. |

Helper methods save you unpacking any of that.

| Helper | `true` when |
| --- | --- |
| `IsKeyDown(EKey)` / `IsKeyUp(EKey)` | This is a key down or up event for that key. |
| `IsMouseDown(EMouseKey)` / `IsMouseUp(EMouseKey)` | The same for a mouse button. |
| `IsShiftDown()` / `IsCtrlDown()` / `IsAltDown()` | That modifier was held. |
| `IsRepeat()` | This `KeyDown` is an OS auto-repeat, not a fresh press. |
| `IsKeyboard()` / `IsMouse()` | Which device the event came from. |

`OnInput` only fires while the entity has an enabled input component, so call
`EnableInput()` in `OnReady`. `DisableInput()` removes it again. Action bindings
add it for you; polling through `World.Input` does not need it at all.

## Mapping contexts

A **mapping context** is a named layer of actions that a world pushes onto a
stack. It answers "what does input mean right now": while the pause menu is up,
the movement keys should do nothing and only the menu's own actions should fire.

Author them in **File > Settings > Engine > Input**, beside the actions.

| Field | What it does |
| --- | --- |
| **Name** | The name scripts push and pop. |
| **Actions** | The actions this layer allows. |
| **Block Lower** | When ticked, an action this layer does not list stops here instead of reaching whatever is underneath. Leave it off for a layer that only adds actions. |

```csharp
private void TogglePause()
{
    if (World.Input.HasLayer("Menu"))
    {
        World.Input.PopLayer("Menu");
        World.Paused = false;
    }
    else
    {
        World.Input.PushLayer("Menu");   // gameplay actions stop firing
        World.Paused = true;
    }
}
```

| Member | What it does |
| --- | --- |
| `PushLayer(name)` | Pushes the layer on top. Pushing one already on the stack moves it up rather than duplicating it, so one pop always removes it. |
| `PopLayer(name)` | Removes it. Returns `false` if it was not on the stack. |
| `HasLayer(name)` | Whether it is currently pushed. |
| `ClearLayers()` | Removes all of them. |

How the stack is read, from the top down:

- The first layer that **lists** the action allows it.
- A layer with **Block Lower** that does **not** list it stops there, and nothing
  underneath is consulted.
- If no layer decides, the action fires.

So an empty stack changes nothing, which is why existing projects behave the same
until they push their first layer. A layer whose name is not in the settings is
skipped rather than blocking everything.

Layers are per world and are cleared when the world is torn down, so a layer left
pushed at the end of a play session does not leak into the next one.

**Runs In UI** predates mapping contexts and still works: with no layer pushed,
UI input mode blocks every action except the ones that opt in. A pushed layer
takes precedence over it.

## Which to use

- **Anything a player triggers** (jump, fire, interact, movement), define an
  action and bind to it. Players can rebind it, and the key never appears in your
  script.
- **Continuous state you check anyway**, poll `World.Input` in `OnUpdate`.
- **Raw keys** (debug shortcuts, text entry), use `OnInput`.
- **Changing what input means** (menus, cutscenes, vehicles), push a mapping
  context rather than adding `if` checks to every handler.
