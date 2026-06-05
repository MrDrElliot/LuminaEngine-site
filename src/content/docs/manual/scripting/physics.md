---
title: Physics & Collisions
description: Forces, velocities, raycasts, and contacts from a script.
---

Physics lives on `World.Physics`. Most methods take the **entity** you want to
act on, so the same call works for your own entity or any other:

```lua
World.Physics:AddImpulse(self.Entity, Vec3(0, 500, 0))
local Velocity: vector = World.Physics:GetLinearVelocity(self.Entity)
```

The entity needs a [Rigid Body](/manual/physics/rigid-bodies/) for body methods
to do anything.

:::note
Apply forces in `OnFixedUpdate` so they land on the physics step. Getters return
the latched physics snapshot, which is frame-coherent.
:::

## Forces and impulses

| Method | Effect |
| --- | --- |
| `AddForce(Entity, Force)` | World-space force (N) for one step |
| `AddImpulse(Entity, Impulse)` | Instantaneous impulse (kg·m/s) |
| `AddTorque(Entity, Torque)` | Torque (N·m) for one step |
| `AddAngularImpulse(Entity, Impulse)` | Instantaneous angular impulse |
| `AddForceAtPosition(Entity, Force, Point)` | Force at a world point (adds spin) |
| `AddImpulseAtPosition(Entity, Impulse, Point)` | Impulse at a world point |

## Velocities

| Method | Effect |
| --- | --- |
| `SetLinearVelocity(Entity, Velocity)` | Replace linear velocity (m/s) |
| `SetAngularVelocity(Entity, Velocity)` | Replace angular velocity (rad/s) |
| `GetLinearVelocity(Entity)` / `GetAngularVelocity(Entity)` | Read it back (`vector`) |
| `GetVelocityAtPoint(Entity, Point)` | Velocity of a point on the body |

## Reading and waking a body

| Method | Returns / effect |
| --- | --- |
| `GetBodyPosition(Entity)` / `GetBodyRotation(Entity)` | The true physics pose, not the lagged render transform |
| `GetCenterOfMass(Entity)` | World-space center of mass |
| `GetBodyID(Entity)` | The Jolt body id (used below for ignore lists and waking) |
| `ActivateBody(BodyId)` / `DeactivateBody(BodyId)` | Wake or sleep a body (pass a `GetBodyID` result) |
| `SetGravityFactor(Entity, Factor)` | Per-body gravity multiplier (0 = float, 1 = normal) |

## Raycasts

A **raycast** shoots a line through the world and tells you the first thing it
hits, the workhorse behind shooting, line of sight, ground checks, and
interaction.

Build an `SRayCastSettings`, set its `Start` and `End`, and call
`World.Physics:RayCast`. It returns the closest hit as an `SRayResult`, or `nil`
when the ray hits nothing:

```lua
local From = self.Transform:GetWorldLocation()
local To   = From + self.Transform:GetForward() * 100

local Settings = SRayCastSettings.new()
Settings.Start = From
Settings.End   = To

local Hit = World.Physics:RayCast(Settings)
if Hit then
    print("hit", Hit.Entity, "at", Hit.Location)
end
```

The `SRayResult` fields:

| Field | Meaning |
| --- | --- |
| `Hit.Entity` | The entity that was hit |
| `Hit.Location` | The world-space hit point (`vector`) |
| `Hit.Normal` | The surface normal at the hit (`vector`) |
| `Hit.Distance` | Distance from `Start` to the hit |
| `Hit.Fraction` | How far along the ray the hit is, 0 at `Start`, 1 at `End` |
| `Hit.BodyID` | The Jolt body id that was hit |

The engine types behind a cast:

```cpp
struct SRayCastSettings        // and SSphereCastSettings, which adds: float Radius;
{
    FVector3 Start, End;
    ECollisionProfiles  LayerMask;       // which layers the ray can hit
    TVector<uint32>     IgnoreBodies;    // bodies to skip
    bool     bDrawDebug = false;
    // ...
};

struct SRayResult
{
    uint32   Entity;        // the entity that was hit
    int64    BodyID;        // its Jolt body id
    FVector3 Location;      // world-space hit point
    FVector3 Normal;        // surface normal at the hit
    float    Fraction;      // 0 at Start, 1 at End
    float    Distance;      // distance from Start to the hit
};
```

### Filtering the ray

`SRayCastSettings` has more fields to control what the ray can hit:

| Field / method | What it does |
| --- | --- |
| `Settings:AddIgnoredBody(BodyId)` | Skip a specific body. Ignore the shooter with `Settings:AddIgnoredBody(World.Physics:GetBodyID(self.Entity))`. |
| `Settings.IgnoreBodies` | The list of ignored body ids. |
| `Settings.LayerMask` | Only hit bodies on certain collision layers. |
| `Settings.bDrawDebug` / `Settings.DebugDuration` | Draw the ray for debugging, with `DebugHitColor` / `DebugMissColor`. |

## Sphere casts

A **sphere cast** sweeps a sphere along a line instead of an infinitely thin
ray, useful for thick projectiles, character probes, or "is there room here"
checks. Build an `SSphereCastSettings` (the same fields, plus a `Radius`) and
call `World.Physics:SphereCast`, which returns an array of every body the sphere
touches along the sweep:

```lua
local Settings = SSphereCastSettings.new()
Settings.Start  = From
Settings.End    = To
Settings.Radius = 0.5

for _, Hit in ipairs(World.Physics:SphereCast(Settings)) do
    print("swept into", Hit.Entity)
end
```

Each element is an `SRayResult` with the same fields as a raycast hit.

## Collision callbacks

Define any of these on your script to be notified. The payload is a
`SCollisionEvent`, annotate it for autocomplete on its fields.

**Contacts** are solid collisions. **Overlaps** are triggers, a collider with
its trigger flag set, or a rigid body marked as a sensor, which produces overlap
events but no physical response.

```lua
function Script:OnContactBegin(Event: SCollisionEvent)
    print("hit", Event.Other, "at", Event.ImpactSpeed, "m/s")
end

function Script:OnContactEnd(Event: SCollisionEvent) end

function Script:OnOverlapBegin(Event: SCollisionEvent)   -- entered a trigger
    print("entered trigger of", Event.Other)
end

function Script:OnOverlapEnd(Event: SCollisionEvent) end
```

The `SCollisionEvent` fields, all read from your entity's point of view:

| Field | Meaning |
| --- | --- |
| `Entity` | Your entity |
| `Other` | The other entity |
| `Point` | World-space contact point (`vector`) |
| `Normal` | Contact normal, pointing away from you (`vector`) |
| `Velocity` / `OtherVelocity` | Linear velocities at contact (m/s) |
| `RelativeVelocity` | Other minus self (`vector`) |
| `ImpactSpeed` | Speed along the normal (m/s) |
| `bIsTrigger` | `true` if the other side was a trigger or sensor |
| `BodyID` / `OtherBodyID` | The Jolt body ids |

The engine type behind the callback:

```cpp
struct SCollisionEvent
{
    uint32   Entity, Other;          // this entity, the other entity
    uint32   BodyID, OtherBodyID;    // Jolt body ids
    FVector3 Point;                  // world-space contact point
    FVector3 Normal;                 // away from self, toward the other body
    FVector3 Velocity, OtherVelocity, RelativeVelocity;
    float    ImpactSpeed;            // speed along the normal
    bool     bIsTrigger;             // true if the other side was a trigger
};
```
