---
title: Rigid Bodies
description: How an entity moves under physics.
---

The **Rigid Body** component (`SRigidBodyComponent`) makes an entity simulate.
Its most important setting is the **body type**.

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
| **Mass** / **Override Mass** | Mass in kg. By default it is computed from the collider's volume and density; turn on **Override Mass** to set **Mass** directly. |
| **Use Gravity** | Turn off for projectiles or floating objects. |
| **Linear / Angular Damping** | Drag that bleeds off movement and spin over time. |
| **Restitution Override** | Bounciness, 0 (no bounce) to 1 (perfectly elastic). |
| **Friction Override** | Surface grip. |
| **Center Of Mass Offset** | Shift the balance point; lower it for car-like stability. |
| **Allow Sleeping** | Let a body that comes to rest stop simulating, which saves cost. |
| **Is Sensor** | Detect overlaps without a physical response, a whole-body [trigger](/manual/physics/collisions/). |
| **Motion Quality** | 0 = Discrete (cheap); 1 = LinearCast, which stops fast bodies tunneling through thin walls. |
| **Max Linear / Angular Velocity** | Speed caps (m/s and rad/s). |
| **Collision Profile** | The layer and mask that decide what this body collides with, see [Collisions & Triggers](/manual/physics/collisions/). |

:::note
The Restitution and Friction **Override** fields are a fallback. If a collider
has a [Physics Material](/manual/physics/materials-destruction/), that wins.
:::

## From a script

All of these properties are readable and writable from C# through the component.

```csharp
SRigidBodyComponent Body = Registry.Get<SRigidBodyComponent>(Entity);
Body.LinearDamping = 0.2f;
Body.bUseGravity = false;
```

To apply forces and impulses or read velocities, use `World.Physics` (keyed by
entity). Apply forces in `OnUpdate`, and they accumulate onto the next physics step.

```csharp
public override void OnUpdate(float DeltaTime)
{
    World.Physics.AddForce(Entity, new FVector3(0, 20, 0));
}
```

See [Scripting › Physics](/manual/scripting/physics/) for the full force,
velocity, and query API.
