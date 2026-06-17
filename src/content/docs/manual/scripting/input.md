---
title: Input
description: Reading keyboard, mouse, and actions from a script.
---

There are two ways to read input in a script:

- **React to events** with `OnInput`. The engine hands you each key and mouse
  event as it happens. Best for discrete actions: jump, fire, open a menu.
- **Poll state** with the **Input** component. You ask each frame whether a key
  or action is currently held. Best for continuous input: movement, holding to
  aim.

Both require an enabled `SInputComponent` on the entity, and both work only in
play mode, for the viewport that has input focus.

## React to events: `OnInput`

Override `OnInput` and the engine calls it once per keyboard or mouse event. The
event is an `InputEvent`. For a keyboard key, `IsKey('W')` is the easy test;
letters and digits compare against their character:

```csharp
public override void OnInput(InputEvent Event)
{
    if (Event.Type == EInputEventType.KeyDown && Event.IsKey(' '))   // space
    {
        Jump();
    }
    else if (Event.Type == EInputEventType.MouseScroll)
    {
        Zoom((float)Event.Scroll);
    }
}
```

The `InputEvent` fields, all read-only:

| Field | Meaning |
| --- | --- |
| `Type` | `KeyDown`, `KeyUp`, `MouseDown`, `MouseUp`, `MouseMove`, or `MouseScroll` (`EInputEventType`). |
| `KeyCode` | The key or mouse-button code; letters/digits use their ASCII-upper value. |
| `IsMouse` | `true` when `KeyCode` is a mouse button rather than a keyboard key. |
| `IsKey(char)` | `true` if this is a keyboard event for the given letter/digit. |
| `Ctrl` / `Shift` / `Alt` | Modifier keys held with the event. |
| `Repeat` | On `KeyDown`, `true` when it is an OS auto-repeat. |
| `MouseX` / `MouseY` | The cursor position. |
| `DeltaX` / `DeltaY` | Cursor movement, on `MouseMove`. |
| `Scroll` | The signed wheel amount, on `MouseScroll`. |

`OnInput` only fires while the entity has an enabled `SInputComponent` — call
`EnableInput()` in `OnReady` (below).

## Poll state: the Input component

Polling asks "is this down right now?" each frame, through the entity's
`SInputComponent`. Opt in with `EnableInput()` — it adds the component (if
missing) and returns it, so cache it and query each frame:

```csharp
public sealed class Player : EntityScript
{
    private SInputComponent _Input = null!;

    public override void OnReady()
    {
        _Input = EnableInput();
    }

    public override void OnUpdate(float DeltaTime)
    {
        if (_Input.IsKeyDown("W"))
        {
            Transform.Translate(Transform.GetForward() * (5.0f * DeltaTime));
        }

        Transform.AddYaw((float)_Input.GetMouseDeltaX() * 0.1f);
    }
}
```

`DisableInput()` removes the component again.

| Method | Returns |
| --- | --- |
| `IsKeyDown(key)` / `IsKeyPressed(key)` / `IsKeyReleased(key)` | `bool` |
| `IsActionDown(name)` / `IsActionPressed(name)` / `IsActionReleased(name)` | `bool` |
| `GetActionAxis(name)` | `float` |
| `GetMouseDeltaX()` / `GetMouseDeltaY()` | Mouse movement this frame |
| `GetMouseX()` / `GetMouseY()` | Cursor position |
| `IsInputActive()` | `true` only when this world has input focus |

Key names are single letters like `"W"`, names like `"Space"`, `"Shift"`,
`"Ctrl"`, and mouse buttons `"Left"`, `"Right"`, `"Middle"`.

## Input actions

An **action** is a named binding like `"Jump"`, `"Fire"`, or `"MoveX"`, defined in
**Tools > Input Actions**. Reading an action by name
(`_Input.IsActionPressed("Jump")`) instead of a raw key lets players rebind
controls and supports gamepads, so prefer actions for anything a player triggers.

## Which to use

- **Discrete actions** (jump, shoot, interact, toggle a menu): use `OnInput`. You
  react exactly once per press.
- **Continuous state** (movement, holding aim, charging): poll the Input
  component each frame in `OnUpdate`.
