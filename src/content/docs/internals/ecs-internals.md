---
title: ECS Internals
description: The EnTT registry facade, entity systems, access declarations, and parallel execution.
---

Lumina's world model is **EnTT**. `CWorld` owns an `entt::registry` (aliased as
`FEntityRegistry`) and everything gameplay-facing is a component on an entity.

For the authoring view (what components exist, how to compose entities) see the
manual's [Entities & Components](/manual/ecs/) page. This page covers how the
system layer works.

## CWorld and the registry

`CWorld` (`World/World.h`) is a `CObject`. It holds the registry, the list of
systems, the physics scene, and the render scene.

The registry is **private**. `GetEntityRegistry()` exists but callers are
expected to go through `CWorld`'s wrappers:

```cpp
FEntity Entity = World->CreateEntity();
World->DestroyEntity(Entity);
auto Signal = World->OnUpdate<SMyComponent>();   // entt on_update
```

The wrappers exist because raw registry access bypasses the world's bookkeeping:
prefab links, network identity, editor selection, and the dirty tracking the
render scene relies on.

### View caching hazard

The **non-const** `registry.view<Ts...>()` assures the component pools exist,
creating any that are missing. That is a structural mutation. Calling it from
inside a `ParallelFor` is a data race: two workers can race to create the same
pool.

Assure pools up front, on the game thread, before any parallel work touches
them. `FSystemContext::CreateView` exists for this reason and should be used from
system code.

## Systems

A system is a plain struct with any of three optional methods. There is no base
class and no virtual dispatch:

```cpp
struct SMySystem
{
    ENTITY_SYSTEM(RequiresUpdate(US_PrePhysics, EUpdatePriority::High))

    static inline FSystemAccess Access = FSystemAccess{}
        .Write<SMyComponent>()
        .Read<STransformComponent>();

    void Startup(const FSystemContext& Context) noexcept  {}
    void Update(const FSystemContext& Context) noexcept   {}
    void Teardown(const FSystemContext& Context) noexcept {}
};
```

The methods are detected by concept (`HasStartup`, `HasUpdate`, `HasTeardown`)
and **must be `noexcept`**, or the concept does not match and the method is
silently ignored.

`ENTITY_SYSTEM(...)` declares the `FUpdatePriorityList`: which
[update stages](/internals/application-lifecycle/) the system participates in and
at what priority. A system with no enabled stage never ticks.

### The system registry

`RegisterECSSystem<T>()` populates a process-wide `FSystemRegistry` at startup.
Each entry resolves the system's `Startup` / `Update` / `Teardown` to **raw
function pointers once**, at reflection-registration time.

That is a deliberate performance decision: per-frame dispatch is a direct call
through a function pointer, with no `entt::meta` lookup, no `meta_any` boxing,
and no variant visit. The system stays reflected for meta-driven consumers (the
editor's system list, for instance), but reflection is off the hot path.

Stateless systems read their priority list from a throwaway instance's in-class
initializer, so no per-world allocation is needed for them.

### Registration and rebuilds

`CWorld::RegisterSystems()` builds the world's system set.
`bSystemsDirty` triggers a rebuild, which is applied at the **top of `Update()`**
so it never runs inside a system batch.

The editor can enable and disable systems at runtime;
`PendingDisabledSystems` is the requested next state and diverges from the live
state only until the next rebuild. Script systems are rebuilt on assembly reload
so stale GC handle slots are never ticked.

## FSystemContext

The context passed to every system method is the system-facing API surface. It
carries the frame clock (`GetDeltaTime`, `GetTime`, `GetUpdateStage`) and wraps
the things a system commonly needs:

- `CreateView<Ts...>(...)` and `CreateRuntimeView(ComponentIds)` for iteration.
- Transform mutation: `TranslateEntity`, `SetEntityLocation`,
  `SetEntityRotation`, `SetEntityScale`.
- Physics queries and impulses: `CastSphere`, `AddForceAtPosition`,
  `GetVelocityAtPoint`, `ApplyBuoyancyImpulse`.
- Debug drawing: `DrawDebugLine`, `DrawDebugBox`, `DrawDebugSphere`,
  `DrawDebugCone`, `DrawDebugArrow`, `DrawFrustum`.

Going through the context rather than touching the registry directly is what
keeps transform dirty tracking and physics synchronization correct.

## Access declarations and parallel execution

`FSystemAccess` (`Systems/SystemAccess.h`) is how a system opts into concurrent
execution:

```cpp
static inline FSystemAccess Access = FSystemAccess{}
    .Write<SSkeletalMeshComponent>()
    .Read<SAnimationGraphComponent>();
```

IDs are `entt::type_hash` values for component types or `SystemResource::` tag
types. Two systems **conflict** (and must serialize) if their write sets overlap,
or if one writes what the other reads.

**A system with no `Access` member is treated as exclusive**: it conflicts with
everything and runs alone. That is the safe default for anything doing structural
changes, calling into scripts, or with access the scheduler cannot see.
`FSystemAccess::Exclusive()` states it explicitly.

Access sets are tiny (a handful of types each), so conflict testing is a nested
scan rather than a hash set intersection.

In development builds the declaration is **validated at runtime**: touching a
component you did not declare is reported. Treat those reports as correctness
bugs, not warnings, because the scheduler used the declaration to decide it was
safe to run your system next to another one.

## Built-in systems

`World/Entity/Systems` contains the engine's own systems. They are also the best
worked examples of the patterns above:

| System | Responsibility |
| --- | --- |
| `InputSystem` | Routes input to input components. |
| `CameraSystem`, `CameraRigSystem` | Active camera resolution, camera rigs and shakes. |
| `AnimationSystem` | Animation graph evaluation and pose tasks. |
| `SocketAttachmentSystem` | Attaches entities to skeletal sockets. |
| `RagdollSystem` | Ragdoll activation and blending. |
| `AudioSystem` | Spatialized audio sources and listeners. |
| `NavMeshSystem`, `PathFollowSystem` | Navigation mesh build and path following. |
| `PerceptionSystem` | AI sight and hearing stimuli. |
| `ProjectileSystem` | Projectile integration and hit resolution. |
| `BuoyancySystem` | Water buoyancy. |
| `FoliageTerrainSystem` | Foliage placement against terrain. |
| `LifetimeSystem` | Timed entity destruction. |
| `TimerSystem` | Gameplay timers. |
| `NetworkSystem`, `NetMovementInterpSystem` | Replication and client-side movement interpolation. |
| `CSharpScriptSystem` | Ticks script components. |

## Entity storage details

- **In-place delete** is opt in per component type
  (`static constexpr auto in_place_delete = true;` on the component). It keeps
  element addresses stable across removals at the cost of tombstones in the pool.
  The line and triangle batcher components use it because their storage is
  written through retained pointers. EnTT views skip tombstones automatically;
  a hand-written pool walk does not.
- Entity references stored in components are remapped on world load and on
  prefab instantiation. Storing a raw `entt::entity` in a serialized structure
  without going through the remapping path produces references into the wrong
  entity after a load.
- Transforms are resolved lazily: writes mark a hierarchy dirty and a resolve
  pass computes world transforms in dependency order. Reading a world transform
  mid-frame may need an explicit resolve first.

## World lifecycle

| Call | When |
| --- | --- |
| `Update(Context)` | Once per update stage, from `FWorldManager::UpdateWorlds`. Applies pending system rebuilds first. |
| `TickPhysics()` | On a physics job, kicked at `FrameEnd` and joined at the next `FrameStart`. |
| `DispatchPhysicsEvents()` | Right after the join, so collision events arrive on the game thread. |
| `Extract()` | At `FrameEnd`, fills the render snapshot. Also ticks UI, which is why a paused world still updates its UI. |

Pausing stops systems and physics but keeps UI updating, because UI is ticked
from `Extract`. A script-driven pause menu therefore keeps working.

Worlds live in `FWorldContext` records owned by `FWorldManager`, each carrying
the world type (`Editor`, `Game`, `Simulation`, and so on) and its net mode.
Creating a context flushes rendering commands first, so the render side never
observes a half-built context.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| A system never ticks | Its methods are not `noexcept`, so the concept did not match, or no stage is enabled in its priority list. |
| Intermittent crash under parallel systems | An undeclared component access, or a non-const `view<>()` call from inside a parallel body. |
| Everything runs serially | Systems are missing `Access` members, so they default to exclusive. |
| Entity reference points at the wrong entity after load | A raw `entt::entity` serialized without going through reference remapping. |
| Stale world transform | Read before the resolve pass ran for that hierarchy. |
| Script systems tick after a reload and crash | The system rebuild did not run; it is applied at the top of `Update`. |
