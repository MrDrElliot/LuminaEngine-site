---
title: The World API
description: Spawning, finding, and moving entities through the World.
---

`World` is how a script reaches everything beyond its own entity. It has two
parts, **methods** on the world itself, and **subsystem** properties that group
related functionality.

```csharp
Entity Pickup = World.SpawnPrefab("/Game/Content/Prefabs/Coin", new FVector3(0, 1, 0));
World.Physics.AddImpulse(Pickup, new FVector3(0, 5, 0));   // a subsystem
```

## Subsystems

Each subsystem is a property on `World`.

| Property | What it does |
| --- | --- |
| `World.Registry` | The component store, with `Get<T>`, `Emplace<T>`, views, signals. See [Entities & Components](/manual/scripting/entities-components/). |
| `World.Physics` | Forces, velocities, raycasts, overlaps. See [Physics](/manual/physics/). |
| `World.Navigation` | Pathfinding and agent movement over the navmesh. |
| `World.UI` | Screen-space RmlUi documents. See [User Interface](/manual/scripting/ui/). |
| `World.Perception` | What AI entities can see and hear. See [Perception](/manual/scripting/perception/). |
| `World.Messages` | The gameplay message bus. See [Events](/manual/scripting/events/). |
| `World.Tags` | The gameplay tag registry. See [Gameplay Tags](/manual/gameplay-tags/). |
| `World.Net` | Network role and replication state. See [Networking](/manual/scripting/networking/). |
| `World.Draw` | Debug drawing (Development and Debug builds only). |
| `World.Input` | Poll actions, keys, and the mouse by name. See [Input](/manual/scripting/input/). |
| `World.Camera` | The active camera, screen projection, and camera shakes. See [Cameras](/manual/cameras/). |
| `World.Audio` | Playing and mixing sound. See [Audio](/manual/audio/). |
| `World.Timers` | One-shot and looping timers. See [Timers](/manual/scripting/timers/). |
| `World.Animation` | Clips, graph parameters, and montages. See [Animation](/manual/scripting/animation/). |

## Entities

| Call | Result |
| --- | --- |
| `World.CreateEntity(name, location?, rotation?, scale?)` | A new named entity with a transform and nothing else |
| `World.SpawnPrefab(path)` | Instantiates a prefab, returns its root `Entity` |
| `World.SpawnPrefab(path, location, rotation?, parent?)` | Same, placed (and optionally parented) in one call |
| `World.SpawnPrefab(path, transform, configure, parent?)` | Same, running `configure(root)` before the next frame so values are in place for `OnReady` |
| `World.SpawnProjectile(origin, velocity, damage?, lifetime?)` | Fires a swept projectile entity (see [Projectiles](/manual/physics/projectiles/)) |
| `World.DuplicateEntity(entity)` | Deep-copies an entity and its children, returns the new root |
| `World.DestroyEntity(entity)` | Removes the entity |
| `World.SetLifetime(entity, seconds)` | Destroys it after a delay; calling again retimes the countdown |
| `World.IsValidEntity(entity)` | `false` once it has been destroyed and its id recycled |
| `World.GetEntityByName(name)` | First entity with that name (`Entity.Null` if none) |
| `World.FindByTag(tag)` | First entity with that tag (`GetEntityByTag` is the same call) |
| `World.FindAllByTag(tag)` | Every entity with that tag, as a fresh `List<Entity>` |
| `World.EntityHasTag(entity, tag)` | `bool` |
| `World.GetEntityName(entity)` | The entity's name |
| `World.GetNumEntities()` | Count of live entities |

Every `SpawnPrefab` overload also takes a `TSoftObjectPtr<CPrefab>` or an
`FSoftObjectPath` instead of a path string, so a prefab authored as a
`[Property]` reference spawns without unwrapping it first.

```csharp
[Property] public TSoftObjectPtr<CPrefab> EnemyPrefab;

Entity Enemy = World.SpawnPrefab(EnemyPrefab, Where, Configure: E =>
{
    Registry.GetScript<Enemy>(E)!.Health = 50.0f;
});
```

```csharp
Entity Player = World.GetEntityByName("Player");
if (!Player.IsNull)
{
    World.SetEntityRotation(Player, FQuat.Identity);
}
```

`World.CreateEntity` makes a bare entity you build up with
`World.Registry.Emplace<T>(entity)`. A [world system](/manual/scripting/world-systems/)
has the same pair on its context as `Create()` / `Destroy(entity)`.

## Transform (world space)

| Call | Result |
| --- | --- |
| `World.GetEntityLocation(entity)` / `World.SetEntityLocation(entity, v)` | `FVector3` |
| `World.SetEntityRotation(entity, q)` | sets rotation |
| `World.TranslateEntity(entity, delta)` | moves by a world-space delta |

For several operations on one entity in a single callback, resolve its
`STransformComponent` once with `World.Registry.Get<STransformComponent>(entity)`
and call its methods directly. Do not keep that wrapper past the callback: it
points into registry storage that any structural change can move, so re-resolve
it next frame, exactly as
[`Transform`](/manual/scripting/entities-components/#transform) does.

## Hierarchy

| Call | Result |
| --- | --- |
| `World.SetParent(child, parent)` | Reparents `child` (preserving world transform) |
| `World.DetachFromParent(entity)` | Detaches to the world root |
| `World.GetParent(entity)` | The parent, or `Entity.Null` |
| `World.GetRootEntity(entity)` | The top of the entity's tree |

## Time

| Call | Returns |
| --- | --- |
| `World.DeltaTime` | Seconds since the last frame |
| `World.ElapsedTime` | Seconds since the world was created |
| `World.Paused` | Get or set. Pauses systems, scripts, and physics; the UI keeps running, so a pause menu can set it back |
| `World.TimeDilation` | Get or set. Below 1 is slow motion, above 1 speeds the world up. Clamped to 0 or greater |

`OnUpdate` already receives `DeltaTime` as its argument; `World.DeltaTime` is
there for code reached outside a hook.

## Components and scripts on other entities

Anything you can do to your own entity's components, you can do to another's
through `World.Registry`, passing that entity.

```csharp
Entity Door = World.GetEntityByName("Door");
SStaticMeshComponent Mesh = World.Registry.Get<SStaticMeshComponent>(Door);
```

To call into another entity's **script**, fetch its instance by type.

```csharp
Health? H = World.Registry.GetScript<Health>(Door);
H?.ApplyDamage(10);
```

`GetScript<T>` returns the live managed instance (or `null`), so you call its
public methods directly, with no marshalling. See [Events](/manual/scripting/events/)
for decoupled communication that doesn't need a direct reference.

## Debug drawing

`World.Draw` draws shapes for tuning and visualization. The draws are no-ops in
Shipping builds, and a `Duration` of `0` draws for a single frame.

```csharp
FVector4 Red = new FVector4(1, 0, 0, 1);
World.Draw.Sphere(Transform.GetWorldLocation(), 0.5f, Red);
World.Draw.Line(a, b, Red, Thickness: 2.0f, Duration: 1.0f);
```

The `World.Draw` methods are `Line`, `Sphere`, `Box`, and `Text` (screen-space).
