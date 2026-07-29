---
title: Blackboards
description: Author a named, typed value store as an asset and read or write it per entity from script or an animation graph.
---

A **blackboard** is an entity's named value store. You declare the keys once, as
a shared asset, and every entity that uses it gets its own copy of the values.
It is the common language between the parts of a character that don't otherwise
know about each other: a script writes `"Speed"`, an animation graph reads it and
picks a state, an AI routine writes `"TargetEntity"` and something else acts on
it.

The design splits cleanly in two:

| Piece | Role |
| --- | --- |
| **Blackboard** asset (`CBlackboard`) | The **schema**. Declares the keys, their types, and their defaults. Shared, read-only at runtime. |
| **Blackboard Component** (`SBlackboardComponent`) | The **instance**. Sits on an entity, points at a schema, and holds that entity's live values. |

Ten guards can share one blackboard asset and still each track their own target,
because the asset never holds a value, only the shape of one.

## Quick start

1. In the [Content Browser](/manual/editor/content-browser/), create a
   **Blackboard** asset and add a few keys.
2. Add a **Blackboard Component** to your entity (inspector → **AI** category)
   and point its **Blackboard** property at that asset.
3. Read and write it from a script:

```csharp
public sealed class Guard : EntityScript
{
    public override void OnUpdate(float DeltaTime)
    {
        // Blackboard is null when the entity has no Blackboard Component.
        if (Blackboard is null)
        {
            return;
        }

        FVector3 Velocity = World.Physics.GetLinearVelocity(Entity);
        Blackboard.SetFloat("Speed", Velocity.Length);
        Blackboard.SetBool("IsAlert", Alerted);
    }
}
```

Values start at the schema's defaults, so reading a key before anything has
written it gives you the value you authored, not zero.

## Authoring the schema

The blackboard editor lists one card per key. **Add Key** appends a new one;
the trash button on a card removes it.

Each card has three fields:

- **Type**, the value the key carries (see below). The colored dot on the card
  matches the type.
- **Default**, the value every new entity starts with. The editor shows the
  right control for the type: a drag field for numbers, a checkbox for bools, an
  enum picker for enums, an asset drop target for objects.
- **Flags**, per-key behavior, see [Key flags](#key-flags).

Duplicate key names are highlighted in red. Names are the only thing anything
else stores, so keep them stable, see [Renaming and retyping](#renaming-retyping-and-deleting-keys).

### Key types

| Type | Holds | Read it with |
| --- | --- | --- |
| **Float** | A single float. | `GetFloat` |
| **Int** | A whole number. | `GetInt` |
| **Bool** | True/false. | `GetBool` |
| **Enum** | A value of a reflected enum; the card picks which enum. | `GetEnum<T>` (or `GetInt`) |
| **Vector** | An `FVector3`, a position, direction, or offset. | `GetVector` |
| **Object** | A `CObject`, usually an asset reference. | `GetObject` / `GetObject<T>` |
| **Entity** | A live entity handle, a target, an owner, a waypoint. | `GetEntity` |

Float, Int, Bool, and Enum are **scalar** types: they share one numeric slot
internally, which is what lets an [animation graph](#driving-an-animation-graph)
read any of them as a parameter. Vector, Object, and Entity carry their own
storage and can't drive a graph parameter.

Entity keys have no authorable default, because an entity handle only means
something inside a live world, so they start unset and are written at runtime.

### Key flags

| Flag | Effect |
| --- | --- |
| **Read Only** | The key is an input/constant. The animation graph's preview panel won't let you edit it. |
| **Hidden** | The key is filtered out of the Get Parameter node dropdown and the transition parameter picker. For internal or scratch keys. |

Neither flag is enforced at runtime, both are authoring hints.

## The component

`SBlackboardComponent` has a single authored property, **Blackboard**, the
schema it initializes from. Everything else is runtime state.

- Values are **seeded from the schema defaults** the first time the component is
  used, and re-seeded if you point it at a different asset.
- Values are **never serialized**. A saved world stores which schema an entity
  uses, not what the values were, the same as `SSkeletalMeshComponent` not
  storing a pose.
- The component **reconciles with the schema** on every access. A key added to
  the asset later appears with its default; a key removed from the asset just
  stops being read. Nothing throws and nothing corrupts.
- Writing a key the schema doesn't declare is allowed and creates a **scratch
  value** that lives as long as the component. Handy, but it means a typo
  doesn't announce itself, so use [`HasKey`](#reading-the-schema) when you want to
  be sure.

Entities without a Blackboard Component simply have no blackboard; every
consumer treats that as "use the defaults".

## Scripting

Get the component from an `EntityScript`'s `Blackboard` property (null when the
entity has none), or anywhere else through the registry:

```csharp
SBlackboardComponent? Board = World.TryGet<SBlackboardComponent>(SomeEntity);
SBlackboardComponent Required = World.GetOrAdd<SBlackboardComponent>(SomeEntity)!;
```

### Reading and writing values

| Method | Effect |
| --- | --- |
| `SetFloat(key, value)` / `GetFloat(key)` / `GetFloat(key, default)` | Float keys. |
| `SetInt(key, value)` / `GetInt(key)` / `GetInt(key, default)` | Int keys. |
| `SetBool(key, value)` / `GetBool(key)` / `GetBool(key, default)` | Bool keys. |
| `SetVector(key, value)` / `GetVector(key)` / `GetVector(key, default)` | Vector keys. |
| `SetEnum<T>(key, value)` / `GetEnum<T>(key, default)` | Enum keys, as a C# enum. |
| `SetObject(key, value)` / `GetObject(key)` / `GetObject<T>(key)` | Object keys. `GetObject<T>` casts for you. |
| `SetEntity(key, entity)` / `GetEntity(key)` | Entity keys. Unset reads back as `Entity.Null`. |
| `ClearValue(key)` | Restore one key to its schema default. Returns false if the schema doesn't declare it. |
| `ResetToDefaults()` | Restore every key, and drop any scratch values. |

```csharp
Blackboard.SetEntity("TargetEntity", Threat);
Blackboard.SetVector("LastKnownPosition", World.GetEntityLocation(Threat));
Blackboard.SetEnum("Stance", EStance.Crouched);
Blackboard.SetObject("EquippedWeapon", WeaponMesh);

Entity Target = Blackboard.GetEntity("TargetEntity");
if (Target != Entity.Null)
{
    MoveTo(Blackboard.GetVector("LastKnownPosition"));
}
```

Getters are typed after the key's declared type. Reading a key with the wrong
getter isn't an error, you just read a slot nothing ever wrote, so match the
getter to the type, or branch on `GetKeyType`.

### Reading the schema

Sometimes you want to know what a blackboard *can* hold, not what it does. The
component answers the common questions itself; its `Blackboard` property is the
schema asset, for everything else:

| Member | Returns |
| --- | --- |
| `Component.HasKey(name)` | `true` if the schema declares that key. |
| `Component.GetKeyType(name)` | The key's `EBlackboardKeyType` (`Float` when there's no such key). |
| `Component.Blackboard` | The `CBlackboard` schema asset itself. |
| `Component.Blackboard.KeyCount` | Number of declared keys. |
| `Component.Blackboard.GetKeyNames()` | Every declared key name, in schema order. |
| `Component.Blackboard.FindKey(name)` | The `FBlackboardKey` declaration (name, type, flags, defaults), or null. |
| `Component.Blackboard.Keys` | The raw key list. |

```csharp
foreach (string Key in Blackboard.Blackboard.GetKeyNames())
{
    if (Blackboard.GetKeyType(Key) == EBlackboardKeyType.Entity)
    {
        Debug.Log($"{Key} = {Blackboard.GetEntity(Key)}");
    }
}
```

## Driving an animation graph

An [animation graph](/manual/scripting/animation/) doesn't own its parameters,
it borrows them from a blackboard. Assign a **Blackboard** to the graph asset and
the Get Parameter node's dropdown, and the parameter picker on a transition
condition, list that schema's keys.

At runtime the pairing is by key name:

- The entity needs both an `SAnimationGraphComponent` and an
  `SBlackboardComponent`.
- Before each evaluation the animation system resolves every parameter the graph
  references against the entity's blackboard and loads it into the graph's
  registers.
- An entity **without** a Blackboard Component runs the graph on its compiled
  default values.

Only [scalar](#key-types) keys can drive a parameter. The parameter picker shows
Vector, Object, and Entity keys greyed out, and compiling a graph that references
a missing or non-scalar key logs a **warning** (not an error) naming the node:
the graph still compiles and reads the default.

```csharp
// Locomotion: the graph's transitions read these the same tick.
Blackboard.SetFloat("Speed", Velocity.Length);
Blackboard.SetBool("Falling", Velocity.y < -0.1f);
```

`World.Animation.SetFloat` / `SetBool` reach the same place, on an entity with a
blackboard they write through to it, so both styles work and agree.

:::note
Setting a graph parameter directly on `SAnimationGraphComponent` is the one way
to get this wrong: those writes land in the VM's registers, which the animation
system refills from the blackboard before the next evaluation. Go through the
blackboard (or `World.Animation`) on entities that have one.
:::

### Previewing in the editor

The Animation Graph editor's **Parameters** panel lists the assigned
blackboard's scalar keys with live controls, so you can scrub a value and watch
the state machine react in the preview viewport. Read Only keys are shown
disabled; Vector, Object, and Entity keys are listed but not editable, since at
runtime those come from the entity's own component.

If the panel is empty, either the graph has no blackboard assigned or the
blackboard has no keys.

## Renaming, retyping, and deleting keys

Editing a schema never corrupts an asset, because of what is and isn't stored:

- The blackboard keeps a **separate default per type**, so switching a key from
  Float to Int and back doesn't lose either default.
- Animation graphs store parameter **names**, not indices or handles. Renaming a
  key leaves the graph pointing at a name that no longer exists, so it compiles
  with a warning and reads the default.
- At runtime, a value for a key that vanished from the schema is simply never
  read, and a key that appeared is seeded from its default on the next access.

So renames degrade gracefully rather than breaking, but they do silently
disconnect. After renaming a key, recompile any graph that used it and check the
compile log for the warnings.

## Where blackboards show up

- **Animation graphs** read parameters from them, as above.
- **[AI Perception](/manual/scripting/perception/)** pairs naturally with them:
  handle `OnTargetPerceived`, write the target into an Entity key, and let the
  rest of your logic read from the blackboard rather than from the perception
  events directly.
- **Scripts on the same entity** use them to share state without referencing each
  other's types.
