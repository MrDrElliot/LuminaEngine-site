---
title: Platform Layer
description: Windowing, input routing, filesystem, process, and crash handling.
---

Lumina targets **Windows only** today. The platform layer is thin and mostly
lives in `Runtime/Platform`, `Runtime/Core/Windows`, and `Runtime/Input`.
Generic declarations sit in `Platform/GenericPlatform.h` and `Platform/Platform.h`
with Windows implementations under `Platform/Windows`, so a port has a seam to
work against, but no second implementation exists.

## Windowing

`FWindow` (`Core/Windows/Window.h`) wraps **GLFW**. `GLFWwindow` is forward
declared; the full `glfw3.h` is pulled in only by translation units that need it,
through `GLFWInclude.h`.

```cpp
FUIntVector2 GetExtent();
float        GetContentScale();       // 1.0 = 96 DPI, drives editor UI scaling
FUIntVector2 GetMonitorResolution();
void         SetWindowPosition / SetWindowSize / SetCursorMode / SetTitleBarHovered
bool         ShouldClose / IsWindowMinimized / IsWindowMaximized
void         Minimize / Restore / Maximize / Close / CancelClose
GLFWwindow*  GetWindow();             // for the Vulkan surface and the ImGui GLFW backend
```

Rules:

- **GLFW calls are main thread only.** That includes `RHI::CreateSurface`, which
  is why the surface is created on the main thread and handed to the render side.
- `CancelClose()` clears the close flag the OS set (the X button, Alt+F4). The
  editor uses it to stay alive when the user cancels the unsaved-changes prompt.
- `FWindow::OnWindowResized` is a static multicast delegate. `FApplication`,
  `FRenderManager`, and the input viewport registry all subscribe.
- `Windowing::GetPrimaryWindowHandle()` returns the main window.
  `Windowing::SetCursorModeForNativeWindow` and
  `Windowing::IsNativeWindowFocused` take a native handle, so mouse capture and
  focus resolution can target a dragged-out preview window rather than always the
  primary one.

The frame loop skips all world updates while the window is minimized.

## Events

`FEventProcessor` (`Events/EventProcessor.h`) dispatches `FEvent` objects to
`IEventHandler` implementations in layer order. `EInputLayer` values are:

| Layer | Value | Handler |
| --- | --- | --- |
| `Viewport` | 1000 | `FInputViewportRegistry` |
| `EditorChrome` | 500 | The development tool UI |
| `Default` | 0 | Everything else |

Higher values are dispatched first, and `OnEvent` returning true consumes the
event. That ordering is what lets a focused viewport take input before editor
chrome sees it.

## Input

Input is **viewport-scoped**, not global. `FInputViewport` (`Input/InputViewport.h`)
represents one rectangle that can receive input, and owns an `FInputContext`
holding the actual key, axis, and mouse state.

A viewport carries:

- Its window rectangle and its render target size, which are different when the
  render target is scaled.
- Hovered and focused flags.
- The `CWorld` it drives.
- The native window handle it is currently drawn into, set each frame by the
  editor.

`FInputViewportRegistry` is the singleton that owns the set and tracks three
distinct pointers:

| Pointer | Meaning |
| --- | --- |
| Hovered | The viewport under the cursor. |
| Focused | The viewport with keyboard focus. |
| Active | The viewport receiving game input. |

Plus `IsGameInputFocused()` / `SetGameInputFocused()`, which is how PIE takes
exclusive input, and `GetRawInput()` for unfiltered device state.

`EndFrame(DeltaSeconds)` runs after `FEngine::Update` and advances edge states
(pressed and released transitions) for the next frame.

Two things that are easy to get wrong:

- Setting the mouse mode on a context does **not** touch the window cursor.
  `ReapplyActiveCursorMode()` pushes it through to the OS.
- With multiple platform windows, OS focus is authoritative and exactly one
  window has it. `IsNativeWindowFocused` disambiguates which preview window
  should receive game input.

In a game build, `FApplication` creates a single primary viewport covering the
window and marks it hovered, focused, and active. In an editor build there is no
primary viewport at all; every tool owns and registers its own.

### Actions and bindings

- `FKey` (`Input/Key.h`) is the key identity type. Reflected as `SKey`, so key
  bindings can be edited in the property grid.
- `FInputAction` is a named action; `FInputActionMap` maps actions to bindings
  and is rebuilt from `CInputSettings` whenever those settings are saved
  (`FCoreDelegates::OnSettingsSaved`).
- `FInputProcessor` translates raw events into action state.
- `EInputMode` selects game, UI, or mixed routing.

## Filesystem

Three layers:

- `Platform/Filesystem` and `FileHelper` for native file access
  (`LoadFileIntoString`, and so on).
- `Runtime/FileSystem` for the [virtual file system](/internals/assets/) and the
  pak-backed filesystem.
- `Runtime/Paths` for the canonical directories: engine directory, engine install
  directory, project directory, project content and scripts directories.

`Paths::InitializePaths()` runs in `FApplication::PreInitStartup`, before
anything reads a file.

## Process

`Platform/Process` wraps process creation and control. `PlatformProcess` is what
launches the build tools, opens the generated solution, and runs project file
regeneration from the editor.

`Platform::EnableHighResolutionTiming()` / `DisableHighResolutionTiming()` bracket
the engine's lifetime so the frame limiter's sleeps land with 1 ms granularity.
`Platform::GetTime()` is the monotonic clock the frame loop uses.

## Crash handling

`CrashHandler::Install()` is the very first call in `LuminaMain`, before the
global state object exists, so a crash during initialization is still captured.

It installs a structured exception handler that writes a minidump plus a
symbolized callstack into `CrashDumps/`. `CrashHandler::Shutdown()` removes it
at the end of `LuminaMain`.

GPU faults are separate; see
[Vulkan Backend](/internals/vulkan-backend/) for device fault and Aftermath.

## Hang watchdog

`HangWatchdog::Start()` runs immediately after the crash handler. A background
thread watches for `HangWatchdog::Heartbeat()`, which the main thread calls at the
top of every `FEngine::Update`. If the heartbeat stops advancing, the watchdog
dumps every thread's callstack.

Subsystems whose work rides a pool worker rather than a thread of their own can
register a reporter so they still show up in a dump, since the watchdog cannot
find them by thread.

## Threading primitives

`Core/Threading` provides the low-level pieces:

- Type aliases over the standard library: `FThread`, `FMutex`, `FSharedMutex`,
  `FRecursiveMutex`, and the matching scoped lock types.
- `Threading::Initialize(MainThreadName)` and `Shutdown`, called by
  `FApplicationGlobalState`.
- `SetThreadName(Name, GroupHint)`, which also assigns the Tracy timeline group.
  `EThreadGroup` values (`Main` 0, `Physics` 10, `Audio` 20, `Worker` 100,
  `Fiber` 200, `Other` 1000) control ordering: lower sorts higher, and threads
  sharing a hint are grouped.
- `SetThreadPerformanceHint()`, which opts a thread out of EcoQoS power
  throttling.
- `InitializeThreadHeap()` / `ShutdownThreadHeap()` for the rpmalloc per-thread
  heap.

Prefer the fiber-aware locks from `TaskSystem/FiberSync.h` for anything a job may
contend. See [Task System](/internals/task-system/).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Crash creating a window or surface | A GLFW call off the main thread. |
| Cursor mode does not apply | The context was changed without `ReapplyActiveCursorMode()`. |
| Input goes to the wrong viewport with multiple windows | Native window focus not consulted; OS focus is authoritative. |
| Editor closes despite a cancelled save prompt | `CancelClose()` was not called, so the OS close flag is still set. |
| Nothing updates after minimizing | Expected: the frame loop skips world updates while minimized. |
| No crash dump for an early crash | The crash occurred before `CrashHandler::Install`, which is the first line of `LuminaMain`. |
| Hang dump does not show the culprit | The stalled work is on a fiber with no OS thread. Look for the registered reporter output instead. |
