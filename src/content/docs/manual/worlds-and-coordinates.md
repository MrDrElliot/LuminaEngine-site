---
title: Worlds & Coordinates
description: What a world is, and the coordinate space everything lives in.
---

## Worlds

A **world** is the container your game lives in: all of its entities, the
systems that run them, and per-world settings. It is what you edit in the
viewport and what runs when you press Play. In a script, `World` is the
world your entity belongs to.

A world is saved as a **map**. In your project settings you pick which map opens
in the editor and which one the game boots into.

### Several worlds at once

More than one world can be alive at a time, each with a **type**:

| Type | When it exists |
| --- | --- |
| **Editor** | The world you edit in the viewport. |
| **Game** | A running game, created when you press **Play** (a copy of the editor world). |
| **Simulation** | The editor world running in place when you press **Simulate**. |

Only Game and Simulation worlds run physics. This is why **Play** makes a copy:
your edits stay safe in the Editor world while the copy runs, and **Stop**
throws the copy away.

### World settings

Each world has its own rendering, physics, and environment settings. Edit them
in the **World Settings** panel, see [Editor](/manual/editor/).

## Coordinate space

Lumina is **left-handed**, **Y-up**, and measured in **meters**. If you have
used Unity, this is the same convention.

| Axis | Direction | Identity value |
| --- | --- | --- |
| **+X** | Right | `new FVector3(1, 0, 0)` |
| **+Y** | Up | `new FVector3(0, 1, 0)` |
| **+Z** | Forward | `new FVector3(0, 0, 1)` |

- **1 unit is 1 meter.** A 2-meter character is 2 units tall.
- **Gravity** pulls down, along **−Y**.
- **Rotations** are in **degrees** in the API and the editor, stored as
  quaternions internally. Euler angles are (pitch about X, yaw about Y, roll
  about Z). If you do your own trig with `System.MathF`, remember that works in
  radians as usual.

### Directions are relative to the entity

`GetForward`, `GetRight`, and `GetUp` return an entity's **local** axes after
its rotation, so "forward" is wherever the entity is facing, not world +Z:

```csharp
// Move this entity along its own facing, 5 m/s:
Transform.Translate(Transform.GetForward() * (5.0f * DeltaTime));

// Turn 90 degrees:
Transform.AddYaw(90.0f);   // yaw turns around up (+Y)
```

At identity rotation, `GetForward()` is world `+Z`, `GetRight()` is `+X`, and
`GetUp()` is `+Y`. Yaw turns around up, pitch around right, roll around forward.

:::tip
For ground movement, flatten the forward vector (set its `y` to 0) before using
it, otherwise looking up or down tilts your movement off the floor.
:::
