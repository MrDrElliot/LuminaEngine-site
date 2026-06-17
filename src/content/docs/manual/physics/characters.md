---
title: Character Controller
description: Walking, jumping, and player movement.
---

Players and walking NPCs do not use a plain rigid body. They use a **character
controller**, a capsule that climbs steps, slides along walls, and never tips
over. It is three components on one entity.

| Component | Role |
| --- | --- |
| **Character Physics** | The collision capsule (Radius, Half Height) and how it handles slopes, steps, and pushing dynamic bodies. |
| **Character Movement** | The feel, including speed, acceleration, jump, gravity, air control, rotation. |
| **Character Controller** | The intent layer your script talks to. |

Add all three in the Details panel to make an entity a character.

## Movement tuning

On **Character Movement** you shape how it feels, with **Move Speed**, **Acceleration**
and **Deceleration**, **Jump Speed**, **Max Jump Count** (set 2 for a double
jump), **Air Control**, **Ground Friction**, **Gravity**, and **Rotation Rate**.
**Orient Rotation To Movement** turns the character to face the way it's moving;
**Use Controller Rotation** instead matches the controller's look direction. It
also reports read-only **Grounded** and **Velocity**.

How it handles terrain is set on **Character Physics** with **Max Slope Angle**
(the steepest walkable incline) and **Step Height** (the tallest ledge it climbs
automatically), plus the capsule's **Radius**, **Half Height**, and **Mass**.

## Driving it from a script

Talk to the **Character Controller**, not the transform. Feed it intent each
frame and the movement system resolves it on the physics step.

```csharp
SCharacterControllerComponent Controller = Registry.Get<SCharacterControllerComponent>(Entity);
Controller.AddMovementInput(Direction);   // accumulate a world-space move direction
Controller.AddYaw(Turn);                   // look left/right (degrees)
Controller.Jump();                         // jump this frame
```

| Method | Does |
| --- | --- |
| `AddMovementInput(FVector3)` | Accumulate a world-space move direction for this frame. |
| `AddYaw(float)` / `AddPitch(float)` | Turn the look direction (degrees; pitch is clamped). |
| `AddLookInput(FVector2)` | Yaw + pitch together (x = yaw, y = pitch). |
| `GetLookForward()` / `GetLookRight()` | The controller's look axes, for building a move vector. |
| `Jump()` | Request a jump this frame. |
| `Launch(velocity, overrideHorizontal, overrideVertical)` | A velocity impulse for jump pads, knockback, or dashes. |
| `TeleportTo(location)` | Move the character (for respawns). |

:::caution
Move a character with `TeleportTo`, never by writing its transform. The physics
capsule owns the character's position, so a plain transform write is silently
overwritten on the next physics step.
:::
