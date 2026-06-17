---
title: Reference
description: Types, math, attributes, and the global API available to every script.
---

This page lists the types and global helpers a script reaches for most often.
The full .NET base class library (`System.*`, `System.Math`, `MathF`, LINQ,
collections) is also available — see the
[C# documentation](https://learn.microsoft.com/dotnet/csharp/).

Two namespaces cover almost everything:

```csharp
using LuminaSharp;   // EntityScript, Entity, Registry, attributes, Physics, Net, Asset, Task, Debug
using Lumina;        // FVector3, FQuat, component types (S*), InputEvent, SCollisionEvent
```

## Vectors and quaternions

The math value types live in `Lumina` and are blittable mirrors of the engine's
own (`FVector3` ↔ C++ `FVector3`).

```csharp
FVector3 P = new FVector3(0, 2, 0);
float Y = P.Y;                              // X, Y, Z fields
FVector3 Sum = FVector3.UnitX + P;          // operators: + - * /
float D = FVector3.Distance(P, Sum);
FVector3 Dir = (Sum - P).Normalized();
```

| Type | Highlights |
| --- | --- |
| `FVector2` | `X, Y`; `Zero`, `One`; `Length`, `Normalized()`; `Dot`, `Distance`, `Lerp` |
| `FVector3` | `X, Y, Z`; `Zero`, `One`, `UnitX/Y/Z`; `Length`, `Normalized()`; `Dot`, `Cross`, `Distance`, `Lerp` |
| `FVector4` | `X, Y, Z, W`; `Zero`, `One` — also used for RGBA colors |
| `FQuat` | `X, Y, Z, W`; `Identity`; `AngleAxis(radians, axis)`; `Rotate(v)`; `*` composes |

Colors are `FVector4` (RGBA, components 0–1). Scalar helpers (`Sin`, `Clamp`,
`Lerp`, `Tau`) come from `System.MathF`.

## `Entity`

A lightweight handle to an entity (the C# mirror of `entt::entity`):

```csharp
Entity E = World.GetEntityByName("Player");
if (!E.IsNull) { /* ... */ }
uint Raw = E.Id;
```

`Entity.Null` is the empty handle; `==` / `!=` compare by id.

## Global API

These static classes are usable from anywhere:

| Class | Members |
| --- | --- |
| `Debug` | `Log(msg)`, `LogWarning(msg)`, `LogError(msg)` — writes to the engine log |
| `Asset` | `Load<T>(path)`, `LoadAsync<T>(path, callback)`, `Exists(path)` |
| `Task` | `ParallelFor`, `Run`, `WaitForAll`, `WorkerCount` — see [Parallel Work](/manual/scripting/tasks/) |
| `Profiler` | `Sample(name)` (a `using` scope), `Begin`/`End`, `Enabled` |

```csharp
Debug.Log($"spawned {E}");

CStaticMesh? Mesh = Asset.Load<CStaticMesh>("/Game/Content/Meshes/Crate");

using (Profiler.Sample("Perception"))
{
    RunPerception();
}
```

Entity-script and system `OnUpdate` are auto-profiled by type name, so per-script
timings show up in the editor's **Gameplay Profiler** with no extra code;
`Profiler.Sample` is for breaking a hot method into sub-scopes.

## Asset references

Use these as `[Property]` field types to get an asset picker in the editor, then
resolve them in code. They live in `Lumina`.

| Type | Use |
| --- | --- |
| `FSoftObjectPath` | An untyped reference by path; `Exists()`, `Load<T>()`, `LoadAsync<T>(cb)` |
| `TSoftObjectPtr<T>` | A typed soft reference; `Get()`, `LoadAsync(cb)` |
| `TObjectPtr<T>` | A typed strong reference holding the resolved object; `Value` |

```csharp
[Property(Tooltip = "Played on pickup", AssetType = "CAudioStream")]
public FSoftObjectPath PickupSound;

public override void OnReady()
{
    CAudioStream? Sound = PickupSound.Load<CAudioStream>();
}
```

## The `World` API

`World` (and a system's `World`) exposes the world beyond your entity. Full
detail is in [The World API](/manual/scripting/world/); the surface in brief:

- **Subsystems**: `World.Registry`, `World.Physics`, `World.Navigation`,
  `World.Messages`, `World.Net`, `World.Draw`.
- **Entities**: `SpawnPrefab`, `DuplicateEntity`, `DestroyEntity`,
  `GetEntityByName`, `GetEntityByTag`, `EntityHasTag`, `GetNumEntities`.
- **Transform**: `GetEntityLocation` / `SetEntityLocation`, `SetEntityRotation`,
  `TranslateEntity`.
- **Hierarchy**: `SetParent`, `DetachFromParent`, `GetParent`, `GetRootEntity`.
- **Time**: `DeltaTime`, `ElapsedTime`.

## Attributes

Declared in `LuminaSharp`, applied to script members or classes:

| Attribute | On | Effect |
| --- | --- | --- |
| `[Property]` | field/property | Exposes it in the editor and serializes it. Keys: `Category`, `Tooltip`, `Name`, `Min`, `Max`, `Units`, `Color`, `Slider`, `AssetType`. |
| `[Serialize]` | field/property | Persists it without showing it in the inspector. |
| `[Hide]` | field/property | Never serialized or shown. |
| `[RequireComponent]` | component-typed field | Resolves and caches the component before `OnReady` (adding it if missing). |
| `[EntitySystem]` | class (on `EntitySystem`) | Declares a [script system](/manual/scripting/systems/)'s `Stage` and `Priority`. |
