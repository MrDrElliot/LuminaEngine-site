---
title: Rigid Bodies
description: How an entity moves under physics.
---

The **Rigid Body** component makes an entity simulate. Its most important
setting is the **body type**:

| Body type | Moves? | Use for |
| --- | --- | --- |
| **Static** | Never | Floors, walls, level geometry. |
| **Kinematic** | Only when you move it | Platforms, doors, scripted movers. |
| **Dynamic** | Yes, fully simulated | Crates, props, anything that falls and bounces. |

A dynamic body needs a [collider](/manual/physics/colliders/) with volume to get
its mass. Static and kinematic bodies are not pushed by collisions, but dynamic
bodies still collide with them.

## Key properties

| Property | What it does |
| --- | --- |
| **Body Type** | Static, Kinematic, or Dynamic (above). |
| **Mass** / **Override Mass** | Mass in kg. By default mass is computed from the collider's volume and density; turn on Override Mass to set it directly. |
| **Use Gravity** | Turn off for projectiles or floating objects. |
| **Linear / Angular Damping** | Drag that bleeds off movement and spin over time. |
| **Restitution Override** | Bounciness, 0 (no bounce) to 1 (perfectly elastic). |
| **Friction Override** | Surface grip. |
| **Center Of Mass Offset** | Shift the balance point; lower it for car-like stability. |
| **Allow Sleeping** | Let a body that comes to rest stop simulating, which saves cost. |
| **Motion Quality** | 0 = Discrete (cheap); 1 = LinearCast, which stops fast bodies tunneling through thin walls. |
| **Max Linear / Angular Velocity** | Speed caps. |

:::note
The Restitution and Friction **Override** fields are a fallback. If a collider
has a [Physics Material](/manual/physics/materials-destruction/), that wins.
:::

## Moving bodies from a script

Apply forces and impulses, or read velocities, through `World.Physics`, see
[Scripting › Physics](/manual/scripting/physics/). Apply forces in `OnFixedUpdate`
so they land on the physics step.
