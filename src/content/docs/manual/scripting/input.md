---
title: Input
description: Defining input actions and reading them from a script.
---

An **action** is a named input like `"Jump"`, `"Interact"`, or `"MoveForward"`,
defined once in project settings and bound to whatever keys you like. Scripts
react to the action, not to the key, so controls stay data.

There are three ways to read input in a script.

- **Bind to an action** with an `InputAction` or `InputAxis` field. You pick the
  action from a dropdown in the inspector and subscribe to its events. This is
  the usual choice.
- **Poll state** with the **Input** component. You ask each frame whether a key
  or action is down. Good for continuous input like movement.
- **React to raw events** with `OnInput`. The engine hands you each key and mouse
  event as it happens, before any action mapping.

All three work only in play mode, for the viewport that has input focus.

## Defining actions

Actions live in **File > Settings > Engine > Input**, and are saved to the
project's `Config/InputSettings.json`. Add an action, name it, then add the
bindings that feed it.

| Action field | What it does |
| --- | --- |
| **Name** | The name scripts refer to. |
| **Type** | `Digital` is on or off. `Axis1D` produces a value. `Axis2D` produces a value per channel, for a movement stick. |
| **Runs In UI** | Keep firing while the viewport is in UI input mode. Use it for pause and other menu keys. |
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

Declare an `InputAction` (digital) or `InputAxis` (analog) field, mark it
`[Property]`, and the inspector shows a dropdown of the project's actions. The
field stores the action's name, so rebinding a key never touches the script.

```csharp
public sealed class Player : EntityScript
{
    [Property] public InputAction Jump = new("Jump");
    [Property] public InputAxis   Move = new("MoveForward");

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

`InputAction` members.

| Member | What it is |
| --- | --- |
| `Pressed` | Event, raised on the frame the action goes down. |
| `Released` | Event, raised on the frame it comes up. |
| `Held` | Event, raised every frame once it has been down for **Hold Time**. Carries seconds held. |
| `Tapped` | Event, raised when a press shorter than **Tap Time** is released. |
| `IsDown` / `WasPressed` / `WasReleased` / `IsHeld` | The same state, polled. |
| `HeldTime` | Seconds the current press has lasted, `0` while up. |

`InputAxis` members.

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

## Poll state: the Input component

Polling asks "is this down right now?" each frame, through the entity's
`SInputComponent`. Opt in with `EnableInput()`, which adds the component if
missing and returns it, so cache it and query each frame.

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
| `IsActionHeld(name)` | `bool`, down and past the action's **Hold Time** |
| `WasActionTapped(name)` | `bool`, on the frame a short press was released |
| `GetActionHeldTime(name)` | Seconds the current press has lasted |
| `GetActionAxis(name)` / `GetActionAxisY(name)` | The action's X and Y channels |
| `GetAxis(positive, negative)` | `+1`, `-1`, or `0` from two digital actions |
| `GetMouseDeltaX()` / `GetMouseDeltaY()` | Mouse movement this frame |
| `GetMouseX()` / `GetMouseY()` | Cursor position |
| `IsInputActive()` | `true` only when this world has input focus |

Key names are single letters like `"W"`, names like `"Space"`, `"Shift"`,
`"Ctrl"`, and mouse buttons `"Left"`, `"Right"`, `"Middle"`.

## React to raw events: `OnInput`

Override `OnInput` and the engine calls it once per keyboard or mouse event,
before any action mapping. Use it for text entry, debug keys, and anything that
should not go through an action. The event is an `InputEvent`. For a keyboard
key, `IsKey('W')` is the easy test, letters and digits compare against their
character.

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

The `InputEvent` fields, all read-only.

| Field | Meaning |
| --- | --- |
| `Type` | `KeyDown`, `KeyUp`, `MouseDown`, `MouseUp`, `MouseMove`, or `MouseScroll` (`EInputEventType`). |
| `KeyCode` | The key or mouse-button code, letters and digits use their ASCII-upper value. |
| `IsMouse` | `true` when `KeyCode` is a mouse button rather than a keyboard key. |
| `IsKey(char)` | `true` if this is a keyboard event for the given letter or digit. |
| `Ctrl` / `Shift` / `Alt` | Modifier keys held with the event. |
| `Repeat` | On `KeyDown`, `true` when it is an OS auto-repeat. |
| `MouseX` / `MouseY` | The cursor position. |
| `DeltaX` / `DeltaY` | Cursor movement, on `MouseMove`. |
| `Scroll` | The signed wheel amount, on `MouseScroll`. |

`OnInput` only fires while the entity has an enabled `SInputComponent`, so call
`EnableInput()` in `OnReady`.

## Which to use

- **Anything a player triggers** (jump, fire, interact, movement), define an
  action and bind to it. Players can rebind it, and the key never appears in your
  script.
- **Continuous state you check anyway**, poll the Input component in `OnUpdate`.
- **Raw keys** (debug shortcuts, text entry), use `OnInput`.
