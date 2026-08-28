---
title: World Systems
description: Author world-level ECS systems in C# that run across every entity, in the same pipeline as native systems.
---

A **world system** runs over the *whole world*, not a single entity. Where an
[entity system](/manual/scripting/entity-systems/) is a script attached to one
entity that runs that entity's behavior, a world system is created once per world
and iterates entities itself, once per frame, just like an engine (C++) system.
The two are different tools.

| | Entity system | World system |
| --- | --- | --- |
| Instance | one per entity (C# Script component) | one per world |
| `this` is | that entity's script | the system (no entity) |
| Iterates | nothing (it *is* the entity) | entities you query through the context |
| Good for | one actor's behavior | a rule applied across many entities |

Reach for a world system when a behavior is really a *rule over a set of
entities* (spin everything tagged a certain way, drain every `Health` below zero)
rather than logic that belongs to one actor.

## Anatomy of a system

A world system is a class that derives from `EntitySystem` and carries an
`[EntitySystem]` attribute declaring its stage and priority. The attribute is
what makes the type discovered and run; one instance is created per world
automatically.

```csharp
using LuminaSharp;
using Lumina;

namespace GameScripts;

[EntitySystem(Stage = EUpdateStage.PrePhysics, Priority = 128)]
public sealed class SpinSystem : EntitySystem
{
    public override void OnUpdate(SystemContext Context)
    {
        float Dt = Context.DeltaTime;
        Context.Registry.View<STransformComponent>().Each((Entity E, STransformComponent Transform) =>
        {
            Transform.AddYaw(90.0f * Dt);
        });
    }
}
```

### Hooks

Override only what you need. All three receive the per-tick `SystemContext`.

| Method | When it runs |
| --- | --- |
| `OnStartup(SystemContext)` | Once, when the system is created for a world. |
| `OnUpdate(SystemContext)` | Every frame, in its stage. |
| `OnTeardown(SystemContext)` | Once, when the world (or this system) is torn down. |

The system's `World` property is also available, for the full
[World API](/manual/scripting/world/).

## Stages and priority

A world system runs in one **update stage**, and systems within a stage run in
**priority** order. These mirror the engine's own pipeline, and they are the same
pre- and post-physics phases an [entity system](/manual/scripting/entity-systems/)
can opt into.

| `EUpdateStage` | Runs |
| --- | --- |
| `FrameStart` | Start of frame, before anything else. |
| `PrePhysics` | Before the physics step (input, movement intent). The default. |
| `DuringPhysics` | Alongside the physics step. |
| `PostPhysics` | After physics resolves (react to results). |
| `FrameEnd` | End of frame. |
| `Paused` | The only stage that runs while `World.Paused` is true, and the only one that does **not** run otherwise. |

`Priority` is an `int`, **lower runs first**, and `128` is the default (medium).

```csharp
[EntitySystem(Stage = EUpdateStage.PostPhysics, Priority = 0)]   // runs early in PostPhysics
```

## The system context

`SystemContext` mirrors the C++ system context, exposing time, entity creation, and access
to the live world's component store.

| Member | Does |
| --- | --- |
| `Context.DeltaTime` / `Context.Time` | Seconds this frame / total world time. |
| `Context.Registry` | The component store. Author views with `Registry.View<...>()`. |
| `Context.Create()` / `Context.Destroy(entity)` | Make or destroy an entity. |
| `Context.SetEntityLocation(entity, v)` | Set an entity's world-space location. |
| `Context.DrawDebugLine(start, end, color)` | One-frame debug line (Dev/Debug only). |

### Iterating entities with views

`Registry.View<...>()` is a typed view, every entity that has *all*
of the listed components. Iterate it with `.Each(...)` or `foreach`, and pass an
`Exclude<...>()` filter as the argument to skip entities that also have a
component.

```csharp
public override void OnUpdate(SystemContext Context)
{
    EntityRegistry Registry = Context.Registry;

    // Every entity with both components, excluding the frozen ones.
    var View = Registry.View<STransformComponent, SVelocityComponent>(
        EntityRegistry.Exclude<SFrozenTag>());

    foreach ((Entity E, STransformComponent Transform, SVelocityComponent Velocity) in View)
    {
        Transform.Translate(Velocity.Value * Context.DeltaTime);
    }
}
```

Views support arity 1–4 and an exclude filter of up to 3 types. The wrappers a
view hands back are valid only for the current iteration step. Read out any
field you need to keep, don't store the wrapper.

:::note[Stateless]
Keep per-frame work in the view loop, not on the instance. A system holds the
*rule*, not per-entity state.
:::

## Running systems in parallel

A system that declares nothing about the components it touches runs
**exclusively**: the scheduler gives it the world to itself. Declare the access
and it can run beside any system that does not conflict, C# and C++ alike.

```csharp
[EntitySystem(Stage = EUpdateStage.PrePhysics)]
[Reads(typeof(SVelocityComponent))]
[Writes(typeof(STransformComponent))]
public sealed class MoveSystem : EntitySystem
{
    public override void OnUpdate(SystemContext Context) { }
}
```

Both attributes are repeatable and take any number of component types. Reads run
concurrently with each other; a reader serializes only against a writer of the
same type, and a writer against any reader or writer of it.

:::caution[Declaring access is a promise]
A system that declares access must do synchronous compute over **only** the
components it declared. Under-declaring races. It also must make no structural
change (no creating or destroying entities, no adding or removing components) and
must not block or await, because it runs on a job-system fiber. A system that
declares nothing is always correct, just serialized.
:::

## Subsystems

Everything outside the entity set (physics, navigation, networking, debug
drawing) is reached through the system's `World` property, exactly as in entity
systems, via `World.Physics`, `World.Navigation`, `World.Net`, `World.Draw`. See
[The World API](/manual/scripting/world/).
