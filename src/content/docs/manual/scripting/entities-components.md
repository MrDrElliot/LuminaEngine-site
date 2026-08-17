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
or color picker, an enum dropdown, an asset or entity picker, a list.

```csharp
[Property(Category = "Movement", Min = 0, Max = 20, Units = "m/s", Tooltip = "Top speed.")]
public float Speed = 5.0f;

[Property(Color = true)] public FVector3 Tint = new(1, 1, 1);

// Typed asset and entity references draw a searchable picker from their type.
[Property] public TSoftObjectPtr<CStaticMesh> Mesh;
[Property] public Entity Target;
```

### The initializer is the default

`= 5.0f` is not just a starting value for one instance, it is the property's
**default**. The engine records it once per script type, and every new instance
of that script starts from it. The Details panel's reset control returns the
field to exactly that value.

Change a default and existing entities keep whatever they were authored with.
Only entities that never overrode the field pick up the new value.

### Where the value lives

A script property's value lives in **native memory**, not in a C# field. The
engine gives your script type a real reflected property, and the `[Property]`
field you wrote becomes an accessor over it.

You do not have to do anything about this, and reading or writing the field is
an ordinary field access. It is worth knowing because it is why a script
property needs no save or sync code: the inspector, scene saving, undo, prefab
overrides, and network replication all read the same storage your script does,
so they always agree.

Two consequences show up in what you can declare.

### Supported types

The C# types carry the same names as their C++ counterparts, so a `TVector<T>`
here is the engine's `TVector<T>` there.

| Type | Notes |
| --- | --- |
| `float`, `double`, `bool`, `int`, `uint`, `long`, `byte`, ... | Every numeric type, plus `bool`. |
| An `enum` | Draws a dropdown. |
| `string` | Stored as an engine `FString`. |
| `FString` | The same storage as `string`, spelled as the engine type. Use this one inside a container, where `string` cannot go. |
| `FName` | An interned name. Compared by id rather than by text, and case insensitive. |
| `FVector2` / `FVector3` / `FVector4` / `FQuat` / `FTransform` | Any engine math type. |
| `Entity` | Draws an entity picker. |
| `FSoftObjectPath`, `TSoftObjectPtr<T>` | Soft asset references, resolved on demand. See [Asset references](/manual/scripting/reference/#asset-references). |
| `TObjectPtr<T>` | A hard reference to a live object, which keeps it alive. |
| A class deriving `NativeObject` | A direct reference to a `CObject`, for example `CTexture`. |
| `TVector<T>` | A list. See [Lists and maps](#lists-and-maps) for what `T` may be. |
| `THashMap<K, V>` | A key/value map. `K` and `V` are plain values. |

Anything else is a build error naming the field, rather than a property that
silently never appears. A plain C# class or struct of your own is not currently
supported as a `[Property]` type.

### Lists and maps

A list is a `TVector<T>` and a map is a `THashMap<K, V>`. Both are **views** over
the container the engine owns, so you declare them without an initializer and use
them like an `IList<T>` and an `IDictionary<K, V>`.

```csharp
[Property] public TVector<float> Cooldowns;
[Property] public TVector<FString> Tags;
[Property] public TVector<FName> Slots;
[Property] public THashMap<int, float> WeightByTier;

public override void OnReady()
{
    Cooldowns.Clear();
    Cooldowns.Add(1.5f);
    Cooldowns[0] = 2.0f;

    Tags.Add("boss");
    Tags.Set(0, "elite");
    string First = Tags.Get(0);

    Slots.Add(new FName("Head"));

    WeightByTier.Set(1, 0.5f);
    if (WeightByTier.TryGetValue(1, out float Weight))
    {
        // ...
    }

    foreach (var Pair in WeightByTier)
    {
        // Pair.Key, Pair.Value
    }
}
```

#### What can be an element

A `TVector<T>` element is stored in the engine's own buffer, so `T` has to be
something that can live there.

| Element | Allowed | Why |
| --- | --- | --- |
| A number, `bool`, `Entity`, or a math type like `FVector3` | Yes | The value is its bytes. |
| `FName` | Yes | An interned id, so it is a plain value too. |
| `FString` | Yes | The list reads and writes each slot through the engine's string, not by copying bytes. |
| `TObjectPtr<T>` | Yes | The list assigns each slot through the engine, so the reference count stays right. |
| `string` | No | A managed reference cannot live in native memory. Use `FString`. |
| A class deriving `NativeObject`, such as `CTexture` | No | Not a storable reference. Use `TObjectPtr<CTexture>`. |
| An `enum` | No | The engine stores an enum property in a 64 bit slot, which does not match the C# underlying type's width. Use a `TVector<long>` and cast. |
| `FSoftObjectPath`, `TSoftObjectPtr<T>` | No | An asset reference is stored as a path, not as bytes. |
| Another `TVector<T>` or `THashMap<K, V>` | No | There is no nested container property. Give the elements a struct type instead. |

A `THashMap<K, V>` is stricter: its key and value must both be plain values.

Each rejection is a build error naming the field and the element type, and it
names the type to write instead.

```csharp
[Property] public TVector<TObjectPtr<CTexture>> Layers;

public override void OnReady()
{
    Layers.Add(new TObjectPtr<CTexture>(SomeTexture));
    Layers.Set(0, new TObjectPtr<CTexture>(OtherTexture));
    CTexture? First = Layers.Get(0).Value;
}
```

In the Details panel a list adds a numbered row per element, and a map adds one
row per entry with the key on the left and the value on the right, each with Add,
Clear, and per-row remove controls.

Because the container is a view, assigning the property itself is meaningless and
the compiler rejects both `= new TVector<float>()` and a later assignment. Add to
it, clear it, or remove from it instead.

#### Writing an element

Assigning through a property that returns a struct does not compile, so how you
write an element depends on whether the C# value is the stored bytes.

| Container | Writing an element |
| --- | --- |
| `TVector<T>` of a plain value | `List[i] = value` works. The element is a `T` in native memory, so the list hands it back by reference. |
| `TVector<FString>`, `TVector<TObjectPtr<T>>` | Use `List.Set(i, value)` and `List.Get(i)`. The indexer throws for these, because a reference into the slot would let a plain assignment copy a string's buffer pointer or store an object pointer without taking a reference. |
| `THashMap<K, V>` | Use `Map.Set(key, value)`. A by-reference indexer would have to insert on a miss, which would make *reading* an absent key add it. |

### Every supported type at once

One script declaring one of everything, as a reference to copy from.

The engine types (`FVector3`, `FString`, `FName`, `TVector<T>`, and the rest)
live in the `Lumina` namespace, so a script in a namespace of your own needs
`using Lumina;`. Scripts are compiled with implicit usings off, so nothing adds
it for you.

```csharp
using Lumina;
using LuminaSharp;

namespace Game;

public sealed class EveryPropertyType : EntityScript
{
    public enum EMode { Off, Slow, Fast }

    // Numbers and bool. The initializer is the default.
    [Property] public float   Speed    = 3.5f;
    [Property] public double  Precise  = -1.25;
    [Property] public bool    Enabled  = true;
    [Property] public sbyte   Tiny     = -3;
    [Property] public short   Small    = -300;
    [Property(Min = -100, Max = 100)]
    public int              Ranged   = 7;
    [Property] public long    Big      = 900000;
    [Property] public byte    Level    = 200;
    [Property] public ushort  Count    = 4000;
    [Property] public uint    Id       = 70000;
    [Property] public ulong   Huge     = 12345678901;

    // An enum draws a dropdown.
    [Property] public EMode Mode = EMode.Slow;

    // Math types. Color = true swaps the drag fields for a color picker.
    [Property] public FVector2  Offset = new FVector2(10, 20);
    [Property(Color = true)]
    public FVector3           Tint   = new FVector3(0.25f, 0.5f, 0.75f);
    [Property] public FVector4  Rect   = new FVector4(1, 0, 0, 1);
    [Property] public FTransform Anchor = FTransform.Identity;

    // Text. FString is the same storage as string, and FName is an interned id.
    [Property] public string  Label = "declared default";
    [Property] public FString Note  = "also a native string";
    [Property] public FName   Slot  = new FName("Head");

    // An entity picker.
    [Property] public Entity Target;

    // References. Soft ones resolve on demand, the hard one keeps its object alive.
    [Property] public FSoftObjectPath          AnyAsset;
    [Property] public TSoftObjectPtr<CTexture> Icon;
    [Property] public TObjectPtr<CTexture>     LoadedIcon;
    [Property] public CTexture?                Direct;

    // Containers. No initializer: they are views over storage the engine owns.
    [Property] public TVector<int>                  Steps;
    [Property] public TVector<FVector3>             Path;
    [Property] public TVector<FString>              Tags;
    [Property] public TVector<FName>                Slots;
    [Property] public TVector<TObjectPtr<CTexture>> Layers;
    [Property] public THashMap<int, float>          WeightByTier;

    public override void OnReady()
    {
        // Plain-value elements: the indexer hands back a reference.
        Steps.Add(1);
        Steps[0] = 2;

        // Marshalled elements: Get and Set, because the C# value is not the bytes.
        Tags.Add("boss");
        Tags.Set(0, "elite");
        string First = Tags.Get(0);

        Slots.Add(new FName("Offhand"));

        WeightByTier.Set(1, 0.5f);
    }
}
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
| `[Alias("OldName")]` | A prior name, so the value survives a rename: both when loading a saved scene and across a live C# hot reload. Repeatable. Also valid on the script **class**, which carries attached scripts onto the renamed class. |
| `[SkipHotReload]` | Resets the field to its default on a C# hot reload instead of carrying the old value. Also valid on the script class to reset all of its properties. |

### Renaming things

A hot reload picks up added, removed, and retyped properties on attached scripts: the engine rebuilds the
class and replays your authored values.

The replay matches by **name**, so a rename looks like one property removed and another added, and the value
is lost. `[Alias]` is what carries it across.

```csharp
// Speed was renamed to Velocity. The old name keeps the authored value.
[Property, Alias("Speed")] public float Velocity = 5.0f;
```

The same applies to renaming the script class itself. Put `[Alias]` on the class and every attached script
moves onto the new one, in a live reload and when loading a scene saved under the old name.

```csharp
[Alias("Game.OldPatrolScript")]
public sealed class Patrol : EntityScript { }
```

Without an alias the property or class is treated as new, so it starts at its default rather than picking up
whatever happened to be in those bytes.

If a `[Property]` is rejected, the compile error says which field and why.

| Error | Cause |
| --- | --- |
| `LUM0101` | The field's type cannot be a script property. See the table above. |
| `LUM0102` | A `TVector<T>` or `THashMap<K, V>` was given an initializer. Fill it in `OnReady` instead. |
| `LUM0103` | The member is a `partial` property. Declare it as a plain field. |
