---
title: Physics & Collisions
description: Forces, velocities, raycasts, overlaps, and contacts from a script.
---

Physics lives on `World.Physics`. Most methods take the **entity** you want to
act on, so the same call works for your own entity or any other.

```csharp
World.Physics.AddImpulse(Entity, new FVector3(0, 5, 0));
FVector3 Velocity = World.Physics.GetLinearVelocity(Entity);
```

The entity needs a [Rigid Body](/manual/physics/rigid-bodies/) for body methods
to do anything. Calls on a body-less entity are safe (mutators no-op, getters
return zero).

:::note
Getters return the latched physics snapshot, which is frame-coherent. The physics
step runs slightly behind the game thread, so `GetBodyPosition` is the true
simulated pose, not the interpolated render transform.
:::

## Forces and impulses

| Method | Effect |
| --- | --- |
| `AddForce(entity, force)` | World-space force (N) for one step |
| `AddImpulse(entity, impulse)` | Instantaneous impulse (kg·m/s) |
| `AddTorque(entity, torque)` | Torque (N·m) for one step |
| `AddAngularImpulse(entity, impulse)` | Instantaneous angular impulse |
| `AddForceAtPosition(entity, force, point)` | Force at a world point (adds spin) |
| `AddImpulseAtPosition(entity, impulse, point)` | Impulse at a world point |

## Velocities

| Method | Effect |
| --- | --- |
| `SetLinearVelocity(entity, v)` | Replace linear velocity (m/s) |
| `SetAngularVelocity(entity, v)` | Replace angular velocity (rad/s) |
| `GetLinearVelocity(entity)` / `GetAngularVelocity(entity)` | Read it back (`FVector3`) |
| `GetVelocityAtPoint(entity, point)` | Velocity of a world point on the body |

## Reading and waking a body

| Method | Returns / effect |
| --- | --- |
| `GetBodyPosition(entity)` / `GetBodyRotation(entity)` | The true physics pose |
| `GetCenterOfMass(entity)` | World-space center of mass |
| `GetBodyId(entity)` | The Jolt body id (`0xFFFFFFFF` if no body) |
| `ActivateBody(entity)` / `DeactivateBody(entity)` | Wake or sleep the body |
| `SetGravityFactor(entity, factor)` | Per-body gravity multiplier (0 = float, 1 = normal) |

## Raycasts

A **raycast** shoots a line through the world and returns the first thing it
hits, the workhorse behind shooting, line of sight, ground checks, and
interaction. Pass an origin, a direction (normalized for you), and a distance.
The result is a `RaycastHit?`, `null` when nothing is hit. Pass an entity to
`Ignore` to skip its body (usually the caster's own).

```csharp
FVector3 From = Transform.GetWorldLocation();
FVector3 Dir = Transform.GetForward();

RaycastHit? Hit = World.Physics.Raycast(From, Dir, 100.0f, Ignore: Entity);
if (Hit is RaycastHit H)
{
    Debug.Log($"hit {H.Entity} at {H.Point}");
}
```

The `RaycastHit` fields.

| Field | Meaning |
| --- | --- |
| `Entity` | The entity that was hit |
| `Point` | The world-space hit point (`FVector3`) |
| `Normal` | The surface normal at the hit (`FVector3`) |
| `Distance` | Distance from the origin to the hit |
| `Fraction` | How far along the ray the hit is, `0` at the origin, `1` at the end |
| `BodyId` | The Jolt body id that was hit |

## Sphere casts and overlaps

A **sphere cast** sweeps a sphere along a line instead of an infinitely thin
ray, useful for thick projectiles, character probes, or "is there room here"
checks. It returns every hit, sorted near-to-far.

```csharp
RaycastHit[] Hits = World.Physics.SphereCast(From, Dir, 100.0f, Radius: 0.5f, Ignore: Entity);
foreach (RaycastHit Swept in Hits)
{
    Debug.Log($"swept into {Swept.Entity}");
}
```

An **overlap** returns every entity whose body intersects a shape *right now*,
the core AI-perception, area-of-effect, and trigger primitive.

```csharp
// Everything within 5m, excluding ourselves.
Entity[] Nearby = World.Physics.OverlapSphere(Transform.GetWorldLocation(), 5.0f, Ignore: Entity);

// An oriented or axis-aligned box.
Entity[] InBox = World.Physics.OverlapBox(center, halfExtents, rotation, Ignore: Entity);
```

Each query is capped at `Physics.MaxQueryResults` (256). For per-frame queries,
the `OverlapSphere` overload that writes into a caller `Span<uint>` avoids the
array allocation.

## Collision callbacks

Override any of these on your script to be notified. The payload is an
`SCollisionEvent`, oriented from your entity's point of view.

**Contacts** are solid collisions. **Overlaps** are triggers (a collider with
its trigger flag set, or a body marked as a sensor) which produce overlap events
but no physical response.

```csharp
public override void OnContactBegin(SCollisionEvent Event)
{
    Debug.Log($"hit {Event.Other} at {Event.ImpactSpeed} m/s");
}

public override void OnOverlapBegin(SCollisionEvent Event)   // entered a trigger
{
    Debug.Log($"entered trigger of {Event.Other}");
}

// Also: OnContactEnd, OnOverlapEnd.
```

The `SCollisionEvent` fields, all read from your entity's point of view.

| Field | Meaning |
| --- | --- |
| `Entity` | Your entity |
| `Other` | The other entity |
| `Point` | World-space contact point (`FVector3`) |
| `Normal` | Contact normal, pointing away from you (`FVector3`) |
| `Velocity` / `OtherVelocity` | Linear velocities at contact (m/s) |
| `RelativeVelocity` | Other minus self (`FVector3`) |
| `ImpactSpeed` | Speed along the normal (m/s) |
| `IsTrigger` | `true` if the other side was a trigger or sensor |
| `BodyID` / `OtherBodyID` | The Jolt body ids |
