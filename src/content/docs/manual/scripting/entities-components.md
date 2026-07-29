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
entity it lives on.

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

The returned wrapper points at the **live** component, writing its fields writes
through to the entity's data. A component's own methods and fields depend on its
type; see [Entities & Components](/manual/ecs/) for the catalog.

### Caching a component with `[RequireComponent]`

`Registry.Get` crosses into native code each call, so for a component you touch
every frame, cache it. Mark a component-typed field `[RequireComponent]` and the
engine resolves it once (adding the component if missing) and assigns it before
`OnReady`.

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

`Transform` is already cached for you this way. It's every entity's
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

Parent and child links live on `World`, keyed by entity.

```csharp
Entity Parent = World.GetParent(Entity);     // Entity.Null if none
World.SetParent(Child, Entity);               // reparent, preserving world transform
World.DetachFromParent(Entity);               // detach to the world root
Entity Root = World.GetRootEntity(Entity);    // top of this entity's tree
```

## Camera

If this entity has a camera, you can read and tune it through its component.

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
like any field. The field's **type** picks the widget: a numeric drag, a vector
or color picker, an enum dropdown, an asset or entity picker, a nested struct, a
resizable list, and so on.

```csharp
[Property(Category = "Movement", Min = 0, Max = 20, Units = "m/s", Tooltip = "Top speed.")]
public float Speed = 5.0f;

[Property(Color = true)] public FVector3 Tint = new(1, 1, 1);

// Typed asset and entity references draw a searchable picker from their type.
[Property] public TSoftObjectPtr<CStaticMesh> Mesh;
[Property] public Entity Target;
```

Every `[Property]` key is optional.

| Key | Effect |
| --- | --- |
| `Category = "X"` | Groups the field under a collapsible header. Nest with `"A\|B"`. |
| `Tooltip = "X"` | Hover help on the field. |
| `Name = "X"` | Renames the field; this is both its inspector label and its saved key. |
| `Min = n` / `Max = n` | Clamp range for a numeric field. |
| `Units = "X"` | Unit suffix after a numeric value, e.g. `"m/s"`. |
| `Color = true` | Draws an RGBA color picker for an `FVector3` / `FVector4` instead of drag fields. |

Related attributes control persistence and hot reload.

| Attribute | Effect |
| --- | --- |
| `[Serialize]` | Persists the field with the entity **without** showing it in the inspector. |
| `[Hide]` | Keeps the field from ever being serialized or shown. |
| `[Alias("OldName")]` | A prior member name, so a saved value still loads after you rename the field. Repeatable. |
| `[SkipHotReload]` | Resets the field to its default on a C# hot reload instead of carrying the old value. Also valid on the script class to reset all of its properties. |

## Collections

A `List<T>` or `T[]` field is a resizable list, and a `Dictionary<K, V>` field is
a key/value map. Both edit in the Details panel: a list adds a numbered row per
element, a map adds one row per entry with the **key** on the left and the
**value** on the right, each with Add, Clear, and per-row remove controls.

```csharp
[Property] public List<float> Cooldowns;
[Property] public Dictionary<string, int> Ammo;
```

The element, key, and value can be any type that works as a plain `[Property]`: a
number, `bool`, `string`, enum, vector, a reflected struct (edits inline as a
nested table), or an asset or entity reference. A map **key** must additionally be
a value the inspector can edit inline, a number, `string`, or enum; a struct key
is shown read-only. **Map keys are unique**, editing one to a key that already
exists reverts with a warning.

A collection cannot nest directly as a map value (for example
`Dictionary<string, List<int>>` is skipped); wrap it in a reflected struct
instead. Put `[Instanced]` on a `Dictionary<K, V>` to make each **value** an
instanced object with its own type picker, the same way it works on a list.

## Instanced properties

An **instanced** property holds an owned instance of a type you pick in the
inspector. Mark a `[Property]` field with `[Instanced]` and the Details panel
shows a type picker of the concrete classes that derive from the field's
declared type. Choose one and its own `[Property]` members edit inline, right
below the picker. It is the value-type analog of swapping in a different
behavior object per entity.

```csharp
// A family of behaviors. The field is typed as the base (here an interface).
public interface ICommand { }

public sealed class AttackCommand : ICommand
{
    [Property(Min = 0)] public float Damage = 10.0f;
    [Property] public string Target = "Enemy";
}

public sealed class WaitCommand : ICommand
{
    [Property(Min = 0, Units = "s")] public float Seconds = 1.0f;
}

public sealed class Enemy : EntityScript
{
    // The picker offers AttackCommand and WaitCommand; the chosen one edits inline.
    [Property(Category = "AI"), Instanced] public ICommand Command;
}
```

The declared type can be an interface, an abstract class, or a concrete base
class. When it is concrete, the base type is itself one of the choices.

:::note
Instancing is **opt-in only**. A field is never instanced unless it carries
`[Instanced]`, whatever its declared type. A plain interface- or
abstract-typed `[Property]` without it is skipped (it has no inline editor).
:::

A candidate type must be **default-constructible** (have a public parameterless
constructor) so the editor and the loader can create it. The chosen value
persists and round-trips by the concrete type's name, so it survives save,
reload, and hot reload even though the rest of the picker is rebuilt each time.

### Lists of instanced objects

Put `[Instanced]` on a `List<T>` (or `T[]`) and each element becomes its own
instanced object: every entry has its own type picker and its own inline editor,
so a single list can mix concrete types. The attribute applies to the elements,
not the list.

```csharp
public sealed class Enemy : EntityScript
{
    // A list where each element picks its own command type and edits inline.
    [Property(Category = "AI"), Instanced] public List<ICommand> Commands;
}
```

Add, remove, and reorder elements with the usual list controls. Each element
follows the same rules as a single instanced field: the candidate type must be
default-constructible, and the value round-trips by the concrete type's name
through save, reload, and hot reload.
