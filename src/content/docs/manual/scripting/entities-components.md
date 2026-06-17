---
title: Entities & Components
description: Working with this entity, its components, and its transform from a script.
---

`Entity` is the entity the script is attached to, and `Registry` is the world's
component store. This page covers working with this entity. To work with *other*
entities, see [The World API](/manual/scripting/world/).

## Components

Component types come from C++ through [reflection](/manual/reflection/), so you
refer to them by name (`STransformComponent`, `SRigidBodyComponent`, and so on)
as a generic type argument. You reach a component through `Registry`, passing the
entity it lives on:

```csharp
// Read this entity's rigid body, if it has one.
SRigidBodyComponent? Body = Registry.TryGet<SRigidBodyComponent>(Entity);
if (Body != null)
{
    Body.Mass = 5.0f;
}

// Add a mesh component and configure it in place.
SStaticMeshComponent Mesh = Registry.Emplace<SStaticMeshComponent>(Entity)!;

Registry.Remove<SBillboardComponent>(Entity);
```

| Method | Returns |
| --- | --- |
| `Registry.Get<T>(Entity)` | The component; throws if absent |
| `Registry.TryGet<T>(Entity)` | The component, or `null` |
| `Registry.Has<T>(Entity)` | `bool` |
| `Registry.Emplace<T>(Entity)` | Adds the component if missing and returns it (idempotent) |
| `Registry.Remove<T>(Entity)` | `bool` (whether one was removed) |

The returned wrapper points at the **live** component — writing its fields writes
through to the entity's data. A component's own methods and fields depend on its
type; see [Entities & Components](/manual/ecs/) for the catalog.

### Caching a component with `[RequireComponent]`

`Registry.Get` crosses into native code each call, so for a component you touch
every frame, cache it. Mark a component-typed field `[RequireComponent]` and the
engine resolves it once (adding the component if missing) and assigns it before
`OnReady`:

```csharp
public sealed class Mover : EntityScript
{
    [RequireComponent] private SRigidBodyComponent _Body = null!;

    public override void OnUpdate(float DeltaTime)
    {
        _Body.LinearDamping = 0.1f;     // no per-frame lookup
    }
}
```

`Transform` is already cached for you this way — it's every entity's
`STransformComponent`, resolved once.

## Identity

| Member | What it is |
| --- | --- |
| `Entity.Id` | This entity's raw id (a `uint`) |
| `Entity.IsNull` | `true` for the null handle |
| `World.GetEntityName(Entity)` | This entity's name |
| `World.DestroyEntity(Entity)` | Removes this entity |
| `World.DuplicateEntity(Entity)` | Deep-copies it, returns the new entity |

## Transform

`Transform` is the live `STransformComponent`. Most methods work in **local**
space (relative to the parent); the `World` variants resolve through the parent
chain. Getters return `FVector3` / `FQuat`.

```csharp
FVector3 Here = Transform.GetLocalLocation();        // local-space position
Transform.SetLocalLocation(new FVector3(0, 2, 0));   // local-space
FVector3 World = Transform.GetWorldLocation();       // resolved world position
Transform.Translate(new FVector3(0, 0, 1));
Transform.AddYaw(90.0f);                             // degrees; also AddPitch, AddRoll
Transform.SetLocalRotationFromEuler(new FVector3(0, 90, 0));
```

| Method | Space | Returns |
| --- | --- | --- |
| `GetLocalLocation()` / `SetLocalLocation(v)` | local | `FVector3` |
| `GetLocalRotation()` / `SetLocalRotation(q)` | local | `FQuat` |
| `GetLocalScale()` / `SetLocalScale(v)` | local | `FVector3` |
| `GetWorldLocation()` / `GetWorldRotation()` / `GetWorldScale()` | world | |
| `GetLocalRotationAsEuler()` / `SetLocalRotationFromEuler(e)` | local | degrees |
| `AddLocalRotationFromEuler(e)` | local | degrees |
| `Translate(delta)` | local | `FVector3` |
| `AddYaw(deg)` / `AddPitch(deg)` / `AddRoll(deg)` | local | |
| `GetForward()` / `GetRight()` / `GetUp()` | world | `FVector3` |
| `SetWorldTransform(t)` | world | |

:::note
Lumina is left-handed and Y-up (`+Z` is forward), in meters, and rotations are
in degrees. See [Worlds & Coordinates](/manual/worlds-and-coordinates/).
:::

## Hierarchy

Parent and child links live on `World`, keyed by entity:

```csharp
Entity Parent = World.GetParent(Entity);     // Entity.Null if none
World.SetParent(Child, Entity);               // reparent, preserving world transform
World.DetachFromParent(Entity);               // detach to the world root
Entity Root = World.GetRootEntity(Entity);    // top of this entity's tree
```

## Camera

If this entity has a camera, you can read and tune it through its component:

```csharp
SCameraComponent Camera = Registry.Get<SCameraComponent>(Entity);
Camera.SetFOV(70.0f);
```

`World.GetActiveCamera()` returns the world's current view camera. To make a
camera follow another entity, add an `SCameraFollowComponent` and set its target
(see [Cameras](/manual/cameras/)).

## Editable properties

Expose a field to the editor with the `[Property]` attribute. It appears in the
entity's **C# Script** section in the Details panel, and you read or write it
like any field:

```csharp
[Property(Min = 0, Units = "m/s", Category = "Movement")]
public float Speed = 5.0f;

[Property(Tooltip = "Mesh to spawn", AssetType = "CStaticMesh")]
public FSoftObjectPath Mesh;
```

The field's type picks the widget. Supported keys include `Category`, `Tooltip`,
`Name` (label override), `Min`, `Max`, `Units`, `Color` (a color picker for a
vector), `Slider` (with `Min`/`Max`), and `AssetType` (a reflected asset class
like `"CStaticMesh"` or `"CMaterial"`, which shows an asset picker — load it with
`Asset.Load<T>(path)`).

Two related attributes:

- `[Serialize]` persists a field with the entity **without** showing it in the
  inspector.
- `[Hide]` keeps a field from ever being serialized or shown.
