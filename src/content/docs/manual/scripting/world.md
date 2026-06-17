---
title: The World API
description: Spawning, finding, and moving entities through the World.
---

`World` is how a script reaches everything beyond its own entity. It has two
parts: **methods** on the world itself, and **subsystem** properties that group
related functionality.

```csharp
Entity Pickup = World.SpawnPrefab("/Game/Prefabs/Coin", new FVector3(0, 1, 0));
World.Physics.AddImpulse(Pickup, new FVector3(0, 5, 0));   // a subsystem
```

## Subsystems

Each subsystem is a property on `World`:

| Property | What it does |
| --- | --- |
| `World.Registry` | The component store — `Get<T>`, `Emplace<T>`, views, signals. See [Entities & Components](/manual/scripting/entities-components/). |
| `World.Physics` | Forces, velocities, raycasts, overlaps. See [Physics & Collisions](/manual/scripting/physics/). |
| `World.Navigation` | Pathfinding and agent movement over the navmesh. |
| `World.Messages` | The gameplay message bus. See [Events](/manual/scripting/events/). |
| `World.Net` | Network role and replication state. See [Networking](/manual/scripting/networking/). |
| `World.Draw` | Debug drawing (Development and Debug builds only). |

## Entities

| Call | Result |
| --- | --- |
| `World.SpawnPrefab(path)` | Instantiates a prefab, returns its root `Entity` |
| `World.SpawnPrefab(path, location, rotation?, parent?)` | Same, placed (and optionally parented) in one call |
| `World.DuplicateEntity(entity)` | Deep-copies an entity and its children, returns the new root |
| `World.DestroyEntity(entity)` | Removes the entity |
| `World.GetEntityByName(name)` | First entity with that name (`Entity.Null` if none) |
| `World.GetEntityByTag(tag)` | First entity with that tag |
| `World.EntityHasTag(entity, tag)` | `bool` |
| `World.GetEntityName(entity)` | The entity's name |
| `World.GetNumEntities()` | Count of live entities |

```csharp
Entity Player = World.GetEntityByName("Player");
if (!Player.IsNull)
{
    World.SetEntityRotation(Player, FQuat.Identity);
}
```

To create entities from nothing rather than from a prefab, use a
[script system](/manual/scripting/systems/), whose context exposes
`Create()` / `Destroy(entity)`.

## Transform (world space)

| Call | Result |
| --- | --- |
| `World.GetEntityLocation(entity)` / `World.SetEntityLocation(entity, v)` | `FVector3` |
| `World.SetEntityRotation(entity, q)` | sets rotation |
| `World.TranslateEntity(entity, delta)` | moves by a world-space delta |

For an entity you act on every frame, prefer caching its `STransformComponent`
via `World.Registry.Get<STransformComponent>(entity)` and calling its methods
directly — same as [`Transform`](/manual/scripting/entities-components/#transform)
does for your own entity.

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

`OnUpdate` already receives `DeltaTime` as its argument; `World.DeltaTime` is
there for code reached outside a hook.

## Components and scripts on other entities

Anything you can do to your own entity's components, you can do to another's
through `World.Registry`, passing that entity:

```csharp
Entity Door = World.GetEntityByName("Door");
SStaticMeshComponent Mesh = World.Registry.Get<SStaticMeshComponent>(Door);
```

To call into another entity's **script**, fetch its instance by type:

```csharp
Health? H = World.Registry.GetScript<Health>(Door);
H?.ApplyDamage(10);
```

`GetScript<T>` returns the live managed instance (or `null`), so you call its
public methods directly — no marshalling. See [Events](/manual/scripting/events/)
for decoupled communication that doesn't need a direct reference.

## Debug drawing

`World.Draw` draws shapes for tuning and visualization. The draws are no-ops in
Shipping builds, and a `Duration` of `0` draws for a single frame.

```csharp
FVector4 Red = new FVector4(1, 0, 0, 1);
World.Draw.Sphere(Transform.GetWorldLocation(), 0.5f, Red);
World.Draw.Line(a, b, Red, Thickness: 2.0f, Duration: 1.0f);
```

`World.Draw` methods: `Line`, `Sphere`, `Box`, and `Text` (screen-space).
