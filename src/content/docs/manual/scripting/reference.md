---
title: Reference
description: Types, math, attributes, and the global API available to every script.
---

This page lists the types and global helpers a script reaches for most often.
The full .NET base class library (`System.*`, `System.Math`, `MathF`, LINQ,
collections) is also available. See the
[C# documentation](https://learn.microsoft.com/dotnet/csharp/).

Two namespaces cover almost everything.

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
| `FVector4` | `X, Y, Z, W`; `Zero`, `One` (also used for RGBA colors) |
| `FQuat` | `X, Y, Z, W`; `Identity`; `AngleAxis(radians, axis)`; `Rotate(v)`; `*` composes |

Colors are `FVector4` (RGBA, components 0–1). Scalar helpers (`Sin`, `Clamp`,
`Lerp`, `Tau`) come from `System.MathF`.

## Strings and names

Two engine string types are available to scripts, and they answer different
questions.

| Type | Use |
| --- | --- |
| `string` | Ordinary text. Stored as an engine `FString`. |
| `FString` | The same storage, spelled as the engine type. Required inside a container, where a `string` cannot go. |
| `FName` | An interned name: an id, not text. Cheap to compare and copy, case insensitive. |

`FString` converts to and from `string` implicitly, so it reads like text
wherever you use it.

```csharp
FString Text = "hello";          // implicit
string Back = Text;              // implicit
int Length = Text.Length;
```

`FName` is the right type for an identifier you compare a lot, like a slot or a
tag. Comparison is an id check, so it never walks the characters.

```csharp
FName Slot = new FName("Head");

if (Slot == new FName("HEAD"))   // true, interning is case insensitive
{
    // ...
}

string AsText = Slot.ToString(); // resolves the id back to text
bool Empty = FName.None.IsNone;  // the empty name
```

## Containers

`TVector<T>` and `THashMap<K, V>` mirror the engine's own containers. As a
`[Property]` they are **views** over storage the engine owns; see
[Lists and maps](/manual/scripting/entities-components/#lists-and-maps) for what
`T` may be and how the Details panel draws them.

```csharp
TVector<float> Values = Cooldowns;

Values.Add(1.5f);
Values.Insert(0, 0.5f);
Values.RemoveAt(0);
Values.Clear();

int Index = Values.IndexOf(1.5f);
bool Present = Values.Contains(1.5f);

foreach (float V in Values) { }
```

| Member | Notes |
| --- | --- |
| `Count`, `Clear()`, `Add`, `Insert`, `RemoveAt`, `Remove`, `IndexOf`, `Contains` | The usual `IList<T>` surface. |
| `List[i]` | By reference, so `List[i] = value` works. Plain-value elements only. |
| `Get(i)` / `Set(i, value)` | Works for every element type, including `FString` and `TObjectPtr<T>`. |
| `AsSpan()` | The storage as a `Span<T>`, for plain-value elements. A mutation invalidates it. |

```csharp
THashMap<int, float> Weights = WeightByTier;

Weights.Set(1, 0.5f);                                  // insert or assign
bool Found = Weights.TryGetValue(1, out float Weight);
bool Has = Weights.ContainsKey(1);
Weights.Remove(1);

foreach (var Pair in Weights) { /* Pair.Key, Pair.Value */ }
```

A view does not own its storage, so do not hold one past the frame you got it
in, and treat any index or enumerator as invalid after you change the container.

## `Entity`

A lightweight handle to an entity (the C# mirror of `entt::entity`).

```csharp
Entity E = World.GetEntityByName("Player");
if (!E.IsNull) { /* ... */ }
uint Raw = E.Id;
```

`Entity.Null` is the empty handle; `==` / `!=` compare by id.

## Global API

These static classes are usable from anywhere.

| Class | Members |
| --- | --- |
| `Debug` | `Log(msg)`, `LogWarning(msg)`, `LogError(msg)` (writes to the engine log) |
| `Asset` | `Load<T>(path)`, `LoadAsync<T>(path, callback)`, `Exists(path)` |
| `Task` | `ParallelFor`, `Run`, `WaitForAll`, `WorkerCount` (see [Parallel Work](/manual/scripting/tasks/)) |
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

The two **soft** types store a virtual path and resolve when you ask.
`TObjectPtr<T>` is a **hard** reference: it holds the object itself and keeps it
alive, which is what you want for something already loaded, or for an object
that has no asset path at all. For when to choose which, see
[Hard vs soft references](/manual/assets/references/#hard-vs-soft-references).

| Type | Use |
| --- | --- |
| `FSoftObjectPath` | An untyped **soft** reference by path; `Exists()`, `Load<T>()`, `LoadAsync<T>(cb)` |
| `TSoftObjectPtr<T>` | A typed **soft** reference; `Get()`, `LoadAsync(cb)` |
| `TObjectPtr<T>` | A typed **hard** reference to a live object, which keeps it alive; `Value` |

```csharp
[Property(Tooltip = "Played on pickup")]
public TSoftObjectPtr<CAudioStream> PickupSound;

public override void OnReady()
{
    CAudioStream? Sound = PickupSound.Get();
}
```

## The `World` API

`World` (and a system's `World`) exposes the world beyond your entity. Full
detail is in [The World API](/manual/scripting/world/); the surface in brief.

- **Subsystems**, `World.Registry`, `World.Physics`, `World.Navigation`,
  `World.UI`, `World.Messages`, `World.Net`, `World.Draw`.
- **Entities**, `SpawnPrefab`, `DuplicateEntity`, `DestroyEntity`,
  `GetEntityByName`, `GetEntityByTag`, `EntityHasTag`, `GetNumEntities`.
- **Transform**, `GetEntityLocation` / `SetEntityLocation`, `SetEntityRotation`,
  `TranslateEntity`.
- **Hierarchy**, `SetParent`, `DetachFromParent`, `GetParent`, `GetRootEntity`.
- **Time**, `DeltaTime`, `ElapsedTime`.

## Attributes

Declared in `LuminaSharp`, applied to script members or classes.

| Attribute | On | Effect |
| --- | --- | --- |
| `[Property]` | field | Exposes it in the editor and serializes it. Keys are `Category`, `Tooltip`, `Name`, `Min`, `Max`, `Units`, `Color`. A field, not a property; see [Editable properties](/manual/scripting/entities-components/#editable-properties). |
| `[Serialize]` | field | Persists it without showing it in the inspector. |
| `[Hide]` | field | Never serialized or shown. |
| `[Alias("OldName")]` | field/class | A prior name so saved data survives a rename. Repeatable. |
| `[SkipHotReload]` | field/class | Resets to default on a C# hot reload instead of carrying the old value. |
| `[RequireComponent]` | component-typed field | Resolves and caches the component before `OnReady` (adding it if missing). |
| `[EntitySystem]` | class (on `EntitySystem`) | Declares a [world system](/manual/scripting/world-systems/)'s `Stage` and `Priority`. |
| `[UpdatePhase]` | class (on `EntityScript`) | Runs an [entity system](/manual/scripting/entity-systems/)'s `OnUpdate` in `EScriptPhase.PrePhysics` (default) or `PostPhysics`. |
