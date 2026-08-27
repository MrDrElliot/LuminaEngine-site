---
title: Physics Internals
description: The Jolt facade, scene lifecycle, the job bridge, and where physics sits in the frame.
---

Physics is **Jolt**, behind a facade that keeps Jolt types out of gameplay and
engine code. `Runtime/Physics` declares the abstraction; `Physics/API/Jolt`
implements it.

For the authoring view (rigid bodies, colliders, characters) see the
[Physics](/manual/physics/) section of the manual.

## The facade

```cpp
namespace Lumina::Physics
{
    constexpr float GEarthGravity = -9.81f;

    enum class EPhysicsAPI : uint8 { Jolt };

    void Initialize(EPhysicsAPI API = EPhysicsAPI::Jolt);
    void Shutdown();
    IPhysicsContext* GetPhysicsContext();
}
```

`IPhysicsContext` is the backend entry point. It initializes and shuts down the
library and creates one `IPhysicsScene` per world:

```cpp
virtual TUniquePtr<IPhysicsScene> CreatePhysicsScene(CWorld* World) = 0;
```

Jolt is the only implementation. The enum reserves room for another, and the
interface is written so a second backend compiles: optional capabilities have
default implementations that do nothing rather than being pure virtual.

The design rule throughout: **no Jolt type appears in a signature gameplay code
touches.** Ragdoll and constraint descriptions are explicitly "Jolt-free structs"
so world and gameplay code can build them without including Jolt.

## Where physics sits in the frame

The step is **synchronous, on the game thread**, sitting between the two stages
named for it:

```
PrePhysics stage       set up, apply forces, move kinematics
  FWorldManager::TickPhysics()
    CWorld::TickPhysics()              IPhysicsScene::Update(DeltaTime)
    CWorld::DispatchPhysicsEvents()    contact events reach gameplay
PostPhysics stage      read this frame's results
```

There is no physics thread. See [Threading Model](/internals/threading-model/)
for why the async version was removed.

`DuringPhysics` is a stage name inherited from the async layout; it runs *before*
the step, alongside `PrePhysics`. Read results in `PostPhysics` or later.

Jolt still parallelises the step internally through the engine job pool, so a
synchronous call is not a single-core call.

`IPhysicsScene` exposes the step in four parts (`PreUpdate`, `Update(DeltaTime)`,
`PostUpdate`, plus `Simulate` / `StopSimulate` to gate whether stepping happens at
all), with `DispatchPendingEvents()` as the game-thread drain of step-side events.

## The Jolt job bridge

`FJoltJobSystemBridge` (`API/Jolt/JoltJobSystemBridge.h`) implements Jolt's
`JobSystemWithBarrier` on top of the engine's fiber scheduler.

Each Jolt job is enqueued as a **detached, counter-free engine job**, so physics
work runs on the shared worker pool rather than a separate Jolt thread pool. Two
things fall out of that:

- No oversubscription. Jolt no longer competes with the engine's own workers for
  cores.
- Physics shows up on the same Tracy timeline as everything else.

`JobSystemWithBarrier` supplies the barrier and dependency machinery. Its `Wait()`
still executes runnable jobs on the waiting thread, and Jolt's `Job::Execute()` is
CAS-guarded execute-once, so a worker and the waiter racing the same job is safe.

`MaxConcurrency` caps how finely Jolt splits work: it batches into roughly
`GetMaxConcurrency` chunks, so a lower value means fewer, larger jobs and less
per-job scheduling overhead.

## Bodies

Bodies are addressed by a `uint32 BodyID`, not by a pointer.
`GetEntityBodyID(Entity)` maps an entity to its body, and each body's user data
carries its owning entity so contacts can be mapped back.

| Call | Purpose |
| --- | --- |
| `ActivateBody` / `DeactivateBody` | Wake and sleep. |
| `IsBodyActive` | Awake versus at rest. |
| `ChangeBodyMotionType(BodyID, EBodyType)` | Switch between static, kinematic, and dynamic at runtime. |
| `GetBodyPosition` / `GetBodyRotation` | The **actual** current body pose. |
| `GetLinearVelocity` / `GetAngularVelocity` / `GetVelocityAtPoint` / `GetCenterOfMass` | Motion state. |
| `GetBodyCount` / `GetMaxBodyCount` | Live count and the configured ceiling. |

:::caution
`GetBodyPosition` returns the simulated pose, which is **not** the entity's
transform component. The transform is the interpolated render pose and lags the
body. Read the body directly when you need the true simulation state, and read
the transform when you want what is on screen.
:::

`GetMaxBodyCount` exists so bulk spawners (fracture, destruction) can clamp to
capacity rather than overflowing Jolt's body buffer.

### Batched insertion

```cpp
Scene->BeginBodyBatch();
// ... construct many bodies ...
Scene->EndBodyBatch();          // one AddBodiesPrepare/Finalize
```

Between the two calls, body constructions are queued and inserted by `End` in a
single prepare-and-finalize pass. It is **game thread only and must be balanced**,
and BodyIDs are only valid after `EndBodyBatch`. This matters for destruction,
where a single fracture can produce hundreds of bodies.

## Applying forces

Forces are **events**, not direct calls. The `On*Event` virtuals take a struct
carrying a `BodyID`, and convenience wrappers on `IPhysicsScene` build the struct
from an entity:

```cpp
Scene->AddForce(Entity, Force);
Scene->AddImpulse(Entity, Impulse);
Scene->AddTorque(Entity, Torque);
Scene->AddAngularImpulse(Entity, AngularImpulse);
Scene->AddForceAtPosition(Entity, Force, Position);
Scene->AddImpulseAtPosition(Entity, Impulse, Position);
Scene->SetLinearVelocity(Entity, Velocity);
Scene->SetAngularVelocity(Entity, AngularVelocity);
```

`SSetGravityFactorEvent` scales gravity per body.

The event shape exists so the backend controls when the change is applied
relative to the step, rather than gameplay poking Jolt mid-simulation.

## Queries

All queries are **game thread only** and take an ignore list of BodyIDs so a
querier can exclude its own body, which is the usual cause of "my raycast always
hits me".

| Query | Returns |
| --- | --- |
| `CastRay(SRayCastSettings)` | The nearest hit, or nothing. |
| `CastRayAll(SRayCastSettings)` | Every body the ray crosses, sorted near to far. For penetrating bullets and all-targets line traces. |
| `CastSphere(SSphereCastSettings)` | Sphere sweep hits. |
| `CollidePoint(Point, Ignore, Out)` | Distinct entities whose bodies **contain** the point. Volume containment, "am I inside X", trigger tests with no sweep. |
| `OverlapSphere` / `OverlapBox` | Distinct entities intersecting the shape. For AI perception, triggers, and area of effect. |

Overlap and point results are **de-duplicated by entity** and appended to the
output vector rather than replacing it, so you can accumulate across several
queries. Pass a reused vector to avoid per-query allocation.

## Collision filtering

`FCollisionProfile` (`PhysicsTypes.h`) carries a layer and a mask over
`ECollisionProfiles`, a reflected bitmask enum. A pair collides when each side's
layer is in the other's mask.

`EBodyType` is static, kinematic, or dynamic. `EMoveMode` selects how a kinematic
move is applied:

| Mode | Behavior |
| --- | --- |
| `Teleport` | Hard set position. Loses velocity. |
| `MoveKinematic` | Move with velocity calculation, preserving physics interaction. |
| `ActivateOnly` | Just wake the body, do not move it. |

## Constraints

`FConstraintDesc` is a Jolt-free description built by gameplay or editor code and
resolved by the scene. Frames are world space, and a body set to `ECS::NullEntity` is
treated as **fixed to the world**, which is how you anchor a joint.

`EPhysicsConstraintType`:

| Type | Removes | Typical use |
| --- | --- | --- |
| `Fixed` | All six degrees of freedom | Compound props, breakable welds |
| `Point` | Three translation DOF | Ropes, chains |
| `Distance` | Keeps two points at a fixed or ranged distance | Rope length caps, stiff springs |
| `Hinge` | All but one rotation axis | Doors, wheels, levers |
| `Slider` | All but one translation axis | Pistons, drawers, lifts |
| `Cone` | Swing-limited ball socket | Twist axis constrained within a cone |

The descriptor also carries limits (`MinLimit`, `MaxLimit`, `HalfConeAngle`,
`bHasLimits`), soft-limit springs (`LimitFrequency`, 0 meaning a hard limit),
friction (`MaxFriction`), motor tuning (`MotorFrequency`, `MotorForceLimit`,
`MotorTorqueLimit`), and `BreakForce` (0 meaning unbreakable).

```cpp
uint32 Id = Scene->CreateConstraint(Desc);            // 0 == failure
Scene->SetConstraintMotor(Id, EConstraintMotorMode::Velocity, TargetRadiansPerSecond);
bool Broken = Scene->IsConstraintBroken(Id);
float Value = Scene->GetConstraintValue(Id);          // hinge angle (rad) or slider position (m)
Scene->DestroyConstraint(Id);
```

`EConstraintMotorMode` is `Off` (free or friction only), `Velocity` (rad/s for a
hinge, m/s for a slider), or `Position` (rad or m, driven through the motor
spring). `GetConstraintValue` returns 0 for joints with no single driven scalar
(fixed, point, distance, cone).

**Constraint and ragdoll creation must happen outside the physics step.** Gameplay
or the pre-physics stage is the right place.

## Ragdolls

`FRagdollDesc` describes one ragdoll without referencing Jolt: the owning entity
(written into each body's user data for contact mapping), an optional
`CPhysicsAsset` (null means auto-generate from the skeleton), the source
skeleton, component-space bone globals to spawn at, the entity world matrix, a
fallback collision profile, and a **collision group id** unique per ragdoll for
parent and child self-collision filtering (`AllocateRagdollGroupID`).

```cpp
TSharedPtr<FJoltRagdollHandle> Handle = Scene->CreateRagdoll(Desc);   // null on failure
Scene->ReadRagdollPose(*Handle, WorldToEntity, Skeleton, OutBoneTransforms);
Scene->GetRagdollRootTransform(*Handle, OutPosition, OutRotation);
Scene->DestroyRagdoll(Handle);                                        // safe with null
```

`ReadRagdollPose` writes component-space GPU skinning matrices
(`Global * InvBind`) sized to the skeleton; bones with no mapped body are rebuilt
from their parent plus the bind-pose local transform, so a partial physics asset
still produces a complete pose.

`GetRagdollRootTransform` is what drives the owning entity so culling bounds track
the ragdoll rather than staying at its spawn point.

## Buoyancy and surface velocity

Two capabilities worth knowing about because they are easy to miss:

**`ApplyBuoyancyImpulse`** applies Jolt's submerged-volume buoyancy plus linear
and angular drag for one frame. The caller supplies the fluid surface **point and
normal**, so the plane can follow the rendered Gerstner wave surface instead of
being flat. `Buoyancy` is the fluid-to-body density ratio: 1 is neutral, above 1
floats. It is a no-op without a dynamic body.

**`SetSurfaceVelocity`** turns a body into a conveyor: objects resting on its
surface are dragged at the given world-space linear and angular velocity. Zero
clears it.

## Extending the backend

Optional capabilities have default implementations that do nothing and return
empty results (`CastRayAll`, `CollidePoint`, `ApplyBuoyancyImpulse`,
`SetSurfaceVelocity`, the constraint API, `IsBodyActive`). That is deliberate: a
new backend implements the pure-virtual core and compiles immediately, growing
capability over time.

If you add a capability, follow the pattern: a Jolt-free descriptor struct, a
virtual with a safe default, and an opaque handle for anything with a lifetime.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Raycast always hits the caller | The querier's own BodyID was not in the ignore list. |
| Body pose and rendered pose disagree | Expected. `GetBodyPosition` is the simulation pose; the transform component is the interpolated render pose. |
| Gameplay reads look one frame stale | By design. Physics kicks at `FrameEnd` and joins at the next `FrameStart`. |
| Crash creating a ragdoll or constraint | Created during the physics step. Do it from gameplay or pre-physics. |
| Bodies silently missing after a bulk spawn | The body count hit `GetMaxBodyCount`. Clamp before spawning. |
| BodyIDs invalid right after construction | Inside a body batch. They are valid only after `EndBodyBatch`. |
| Ragdoll parts collide with each other | The ragdoll was built without a unique collision group id. |
| Physics starves the frame | `MaxConcurrency` set too high, producing many tiny jobs with scheduling overhead. |
