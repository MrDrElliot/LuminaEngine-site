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

Both work only in play mode (a Game or Simulation world), for the viewport that
has input focus.

## React to events: `OnInput`

Define `OnInput` and the engine calls it once per keyboard or mouse event. The
event is an `SInputEvent`, and no Input component is required:

```lua
function Script:OnInput(Event: SInputEvent)
    if Event.Type == "KeyDown" and Event.Key == "Space" then
        self:Jump()
    elseif Event.Type == "MouseScroll" then
        self:Zoom(Event.Scroll)
    end
end
```

The `SInputEvent` fields, all read-only:

| Field | Meaning |
| --- | --- |
| `Event.Type` | The event: `"KeyDown"`, `"KeyUp"`, `"MouseDown"`, `"MouseUp"`, `"MouseMove"`, or `"MouseScroll"`. |
| `Event.Key` | The key or button, for example `"Space"`, `"A"`, `"Left"`. Empty for move and scroll. |
| `Event.Ctrl` / `Event.Shift` / `Event.Alt` | Modifier keys held with the event. |
| `Event.Repeat` | On `KeyDown`, true when it is an OS auto-repeat (a held key firing again). |
| `Event.X` / `Event.Y` | The cursor position. |
| `Event.DeltaX` / `Event.DeltaY` | Cursor movement, on `MouseMove`. |
| `Event.Scroll` | The signed wheel amount, on `MouseScroll`. |

The engine type behind the event:

```cpp
enum class EInputEventType : uint8
{
    KeyDown, KeyUp, MouseDown, MouseUp, MouseMove, MouseScroll
};

struct SInputEvent
{
    EInputEventType Type;
    SKey   Key;              // key or button, plus Ctrl / Shift / Alt modifiers
    bool   bRepeat;          // OS auto-repeat (KeyDown only)
    double MouseX, MouseY;   // cursor position
    double DeltaX, DeltaY;   // mouse-move delta
    double Scroll;           // wheel delta
};
```

## Poll state: the Input component

Polling asks "is this down right now?" each frame. It goes through the entity's
**Input** component, so it is scoped to the entity that owns it (the player's
pawn, usually). Opt in with `self:EnableInput()`, then query `self.Input`:

```lua
function Script:OnReady()
    self:EnableInput()
end

function Script:OnUpdate(DeltaTime: number)
    if self.Input:IsKeyDown("W") then
        self.Transform:Translate(self.Transform:GetForward() * (5 * DeltaTime))
    end

    self.Transform:AddYaw(self.Input:GetMouseDeltaX() * 0.1)
end
```

`self:DisableInput()` removes the component again.

These are colon-called on `self.Input`:

| Method | Returns |
| --- | --- |
| `IsKeyDown(Key)` / `IsKeyPressed(Key)` / `IsKeyReleased(Key)` | `boolean` |
| `IsActionDown(Name)` / `IsActionPressed(Name)` / `IsActionReleased(Name)` | `boolean` |
| `GetActionAxis(Name)` | `number` |
| `GetMouseDeltaX()` / `GetMouseDeltaY()` | Mouse movement this frame |
| `GetMouseX()` / `GetMouseY()` | Cursor position |
| `IsInputActive()` | `true` only when this world has input focus |

Key names are single letters like `"W"`, names like `"Space"`, `"Shift"`,
`"Ctrl"`, and mouse buttons `"Left"`, `"Right"`, `"Middle"`.

You can also bind a callback to an action instead of polling it:

```lua
local Id = self.Input:BindAction("Fire", function() self:Shoot() end)
self.Input:UnbindAction(Id)
```

## Input actions

An **action** is a named binding like `"Jump"`, `"Fire"`, or `"MoveX"`, defined in
**Tools > Input Actions**. Reading an action by name
(`self.Input:IsActionPressed("Jump")`) instead of a raw key lets players rebind
controls and supports gamepads, so prefer actions for anything a player
triggers.

## Mouse mode

The global `Input` table is separate from everything above and only controls the
window's mouse mode, capture it for mouse-look, release it for menus:

```lua
Input.SetMouseMode("Captured")   -- "Captured", "Hidden", or "Normal"
```

## Which to use

- **Discrete actions** (jump, shoot, interact, toggle a menu): use `OnInput`, or
  a bound action callback. You react exactly once per press.
- **Continuous state** (movement, holding aim, charging): poll `self.Input` each
  frame in `OnUpdate`.
