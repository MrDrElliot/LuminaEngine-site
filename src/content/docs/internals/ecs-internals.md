---
title: ECS Internals
description: Lumina's sparse-set ECS, component storage layouts, views, signals, entity systems, and parallel execution.
---

Lumina's world model is an entity component system written for the engine.
`CWorld` owns an `ECS::FRegistry` and everything gameplay-facing is a component
on an entity.

For the authoring view (what components exist, how to compose entities) see the
manual's [Entities & Components](/manual/ecs/) page. This page covers how the
storage and system layers actually work.

## Entity handles

`ECS::FEntity` is a 4-byte value type. It packs a 20-bit index with a 12-bit
version:

```cpp
ECS::FEntity Entity = World->CreateEntity();

Entity.GetIndex();     // slot in the registry, up to ~1M live entities
Entity.GetVersion();   // bumped when the slot is recycled
Entity.Value;          // the packed 32 bits, what scripts and shaders see
```

The version is what makes a stale handle detectable. Destroying an entity
returns its index to a free list and bumps the version, so an old handle keeps
the right index but the wrong version and `IsValid` rejects it. `ECS::NullEntity`
is the sentinel for "no entity".

The handle is trivially copyable and blittable to a `uint32`, which is why the
same value crosses into C# and into GPU buffers without conversion. Pass it by
value; it is never a pointer to anything.

## Storage

Each component type gets one pool. A pool is a sparse set: a paged sparse array
mapping entity index to a dense slot, plus a dense array of entities and a
parallel payload.

```
sparse[entity index] -> dense slot        (paged, 4096 slots per page)
dense[slot]          -> entity handle     (contiguous)
payload[slot]        -> component value
```

The sparse slot stores the dense index packed with the owner's version, so a
membership test is a single load and a compare. It never touches the dense array,
which keeps `HasAll` and view filtering off the payload's cache lines entirely.

Iteration walks the dense array, so it is linear in the number of entities that
actually have the component, not in the size of the world.

### Component type identity

A component type gets a **dense 16-bit id**, handed out in registration order.
Looking up a pool is an array index rather than a hash of a type name.

Declaring a component takes nothing at all. There is no macro and no base class:

```cpp
struct SMyComponent
{
    float Value = 0.0f;
};
```

A reflected component keeps its reflected name, so the pool and the `CStruct`
agree on one spelling. An unreflected internal type gets its name from the
compiler's own function signature instead, which means reflection is never
required to put a type in a registry.

An empty struct is a **tag**. Tags allocate no payload at all, and the API
refuses to compile a read of one, because there is nothing to read:

```cpp
struct SDisabledTag {};        // membership only

Registry.Emplace<SDisabledTag>(Entity);    // fine, hands back nothing
Registry.Get<SDisabledTag>(Entity);        // does not compile
```

### Storage traits

A component customizes its storage by declaring plain static members. Anything
it does not declare falls back to the default:

| Member | Type | Default | Effect |
| --- | --- | --- | --- |
| `InPlaceDelete` | `bool` | `false` | Removal leaves a tombstone instead of swapping, so an element address never moves |
| `Layout` | `EComponentLayout` | `Automatic` | `Packed` or `Paged` overrides the size threshold |
| `PageSize` | `uint32` | `1024` | Elements per payload page, must be a power of two |

```cpp
struct SProjectile
{
    static constexpr auto Layout = ECS::EComponentLayout::Paged;
    static constexpr uint32 PageSize = 64;

    FVector3 Position;
    FVector3 Velocity;
};
```

Two contradictions are compile errors rather than runtime surprises:
`InPlaceDelete` with `Layout::Packed` (a packed pool relocates as it grows), and
a `PageSize` that is not a non-zero power of two.

### Layout and removal are separate decisions

**Layout** decides where the payload lives. A packed pool is one growing block,
which is the fastest thing to read at random and has to relocate the whole
payload as it grows. A paged pool allocates a page at a time, so growth never
relocates, at the cost of an indirection.

Relocation cost scales with element size, so the default is automatic: a
component larger than 32 bytes is paged, anything smaller is packed. At 64 bytes
that is worth about 3x on an unreserved insert, and a bulk spawn of 200k entities
of a fat component costs roughly 2.4 ms less.

**Removal** decides what happens to the hole. The default is swap-and-pop: the
last element moves into the gap, so the dense array stays hole-free and iteration
never checks anything. `InPlaceDelete` instead leaves a tombstone, keeping every
surviving element at a fixed address, which is what a component held through a
retained pointer needs. The line and triangle batcher components opt in for
exactly that reason.

The two are independent, so a fat component with no stability requirement gets
paged storage **and** swap-and-pop: growth stops relocating and removal still
leaves no holes.

Tombstones are cheap to walk (the iteration loop splits the check out rather than
branching per element) but they do accumulate. `Registry.Compact()` drops them,
which is worth doing after a bulk delete.

## Views

A view iterates the entities that have every included component and none of the
excluded ones:

```cpp
auto View = Registry.View<STransformComponent, SVelocityComponent>(
    ECS::TExclude<SDisabledTag>{});

View.ForEach([&](ECS::FEntity Entity, STransformComponent& Transform, SVelocityComponent& Velocity)
{
    Transform.SetLocalLocation(Transform.GetLocalLocation() + Velocity.Value * Dt);
});
```

The view picks the **smallest included pool as its driver** and walks that,
testing the others by membership. That is why a rare component belongs in the
include list: it bounds the whole loop.

Tags are dropped from the callback's argument list, because they carry no value.
A view of `<STransformComponent, SDisabledTag>` calls back with the transform
only.

Three iteration shapes are available, and the callback may take the entity or
omit it:

```cpp
View.ForEach([](ECS::FEntity E, SFoo& Foo) { });   // callback
View.ForEach([](SFoo& Foo) { });                   // entity omitted

for (ECS::FEntity Entity : View) { }               // entities only

for (auto&& [Entity, Foo, Bar] : View.Each()) { }  // structured binding
```

The range-for shapes exist because a callback cannot `break`.

`CreateRuntimeView(ComponentIds)` builds the same thing from ids resolved at
runtime, which is what the editor and the script bridge use when the types are
not known at compile time.

### View caching hazard

`Registry.View<Ts...>()` assures the component pools exist, creating any that are
missing. That is a structural mutation. Calling it from inside a `ParallelFor` is
a data race: two workers can race to create the same pool.

Assure pools up front, on the game thread, before any parallel work touches them.
`FSystemContext::CreateView` exists for this reason and should be used from
system code.

## Signals

Every pool carries three lifecycle channels. Handlers are named in a template
argument, so a caller binds and unbinds by identity with no token to store:

```cpp
Registry.GetSignals<SMyComponent>().OnConstruct.Connect<&FMyClass::OnAdded>(this);
Registry.GetSignals<SMyComponent>().OnDestroy.Disconnect<&FMyClass::OnRemoved>(this);
```

`OnConstruct`, `OnDestroy` and `OnUpdate` all pass the registry and the entity,
and a handler may take both, the entity alone, or nothing. Entity creation and
destruction have their own registry-level channels, `OnEntityCreated` and
`OnEntityDestroyed`.

An empty signal costs one load and a branch, so pools nobody listens to pay
almost nothing.

## Singletons and named pools

The registry carries a **context** for per-world singletons, keyed by the same
dense type id the pools use:

```cpp
Registry.Ctx().Emplace<FMyWorldState>();
FMyWorldState& State = Registry.Ctx().Get<FMyWorldState>();
FMyWorldState* Maybe = Registry.Ctx().Find<FMyWorldState>();
```

The context stores objects, so a singleton that is really a reference to
something the world already owns is stored as a pointer.

A **named pool** is a second pool of the same component type under its own name,
which is how one tag type becomes many independent tags:

```cpp
auto TagPool = Registry.NamedStorage<STagComponent>(FName("Flammable"));
TagPool.Emplace(Entity);
TagPool.Contains(Entity);
```

## Events

`ECS::FEventDispatcher` is a typed event bus, one per world, keyed by the same
dense type id. Sinks are bound the same way signals are:

```cpp
Dispatcher.Sink<SImpulseEvent>().Connect<&FPhysicsScene::OnImpulse>(this);
Dispatcher.Trigger<SImpulseEvent>(SImpulseEvent{ Entity, Impulse });
```

Listeners are copied before dispatch, so a handler that binds or unbinds during
the broadcast cannot invalidate the walk.

## CWorld and the registry

`CWorld` (`World/World.h`) is a `CObject`. It holds the registry, the list of
systems, the physics scene, and the render scene.

The registry is **private**. `GetEntityRegistry()` exists but callers are
expected to go through `CWorld`'s wrappers:

```cpp
ECS::FEntity Entity = World->CreateEntity();
World->DestroyEntity(Entity);
```

The wrappers exist because raw registry access bypasses the world's bookkeeping:
prefab links, network identity, editor selection, and the dirty tracking the
render scene relies on.

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
through a function pointer, with no reflection lookup, no boxing, and no variant
visit. The system stays reflected for meta-driven consumers (the editor's system
list, for instance), but reflection is off the hot path.

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

Ids are the component's dense type id, or a `SystemResource::` tag type. Two
systems **conflict** (and must serialize) if their write sets overlap, or if one
writes what the other reads.

**A system with no `Access` member is treated as exclusive**: it conflicts with
everything and runs alone. That is the safe default for anything doing structural
changes, calling into scripts, or with access the scheduler cannot see.
`FSystemAccess::Exclusive()` states it explicitly.

Access sets are tiny (a handful of types each), so conflict testing is a nested
scan rather than a hash set intersection.

Declaring access also registers a **pool assurer**. Creating a pool mutates the
registry's pool table, and a read is enough to create one, so the scheduler runs
every declared type's assurer on the tick thread before the batch starts. Every
lookup inside the batch is then a pure read.

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

## Other storage details

- Entity references stored in components are remapped on world load and on
  prefab instantiation. Storing a raw entity handle in a serialized structure
  without going through the remapping path produces references into the wrong
  entity after a load.
- An entity serializes as its packed handle, and a component serializes by name
  rather than by type id, so a save file does not depend on registration order.
- Transforms are resolved lazily: writes mark a hierarchy dirty and a resolve
  pass computes world transforms in dependency order. Reading a world transform
  mid-frame may need an explicit resolve first.
- `Registry.Swap(Other)` trades two whole worlds, which is how a level loads into
  a pending registry and then goes live without a copy.

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
| Intermittent crash under parallel systems | An undeclared component access, or a `View<>()` call from inside a parallel body. |
| Everything runs serially | Systems are missing `Access` members, so they default to exclusive. |
| Entity reference points at the wrong entity after load | A raw entity handle serialized without going through reference remapping. |
| A held component pointer dangles after an unrelated removal | The pool swaps on removal. Hold the entity handle, or opt the type into `InPlaceDelete`. |
| Iteration slows down over a long session | Tombstones accumulating in an `InPlaceDelete` pool. Call `Compact()` after bulk deletes. |
| Stale world transform | Read before the resolve pass ran for that hierarchy. |
| Script systems tick after a reload and crash | The system rebuild did not run; it is applied at the top of `Update`. |
