---
title: C# Scripting
description: Gameplay in C# against a typed, reflection-driven API.
---

Gameplay in Lumina is written in **C#**. A script is a C# class that attaches to
an entity and runs that entity's behavior. Scripts compile **inside the editor**
on save, so changing a file updates the running editor with no rebuild and no
restart.

This page covers how a script is shaped and how it runs. The rest of the section
documents the API surface.

- **[Entities & Components](/manual/scripting/entities-components/)**, working with this entity and its components.
- **[The World API](/manual/scripting/world/)**, spawning, finding, and moving entities.
- **[World Systems](/manual/scripting/world-systems/)**, world-level systems that run a rule across many entities.
- **[Physics & Collisions](/manual/scripting/physics/)**, forces, velocities, queries, and collision events.
- **[Input](/manual/scripting/input/)**, actions, keys, and the mouse.
- **[User Interface](/manual/scripting/ui/)**, screen-space RmlUi documents driven from C#.
- **[Low-Level Rendering (RHI)](/manual/scripting/rhi/)**, custom GPU work: compute dispatch, textures, and the bindless heap.
- **[Events](/manual/scripting/events/)**, the gameplay message bus and component signals.
- **[Parallel Work](/manual/scripting/tasks/)**, running heavy compute across worker threads.
- **[Networking](/manual/scripting/networking/)**, roles and replication.
- **[Reference](/manual/scripting/reference/)**, types, math, and the global API.

## The C# language

These docs cover Lumina's API, not the language itself. For C# syntax, the type
system, and the standard library, see the official
[C# documentation](https://learn.microsoft.com/dotnet/csharp/). Lumina hosts
.NET 10 / CoreCLR, so the full base class library (`System.*`, LINQ, collections,
`MathF`) is available to a script, though for hot per-frame code you'll lean on
the engine's value types and avoid per-frame allocation.

## Where scripts live

Scripts are `.cs` files in your project's `Game/Scripts/` folder. The editor
compiles every script in the project into one assembly; you attach a script to an
entity by its **class name** (for example `Game.Player`), not by file path.

## Anatomy of a script

A script is a class that derives from `EntityScript` and overrides the lifecycle
hooks it needs. This complete script orbits its entity around its starting point.

```csharp
using System;
using LuminaSharp;
using Lumina;

namespace Game;

public sealed class Orbit : EntityScript
{
    [Property(Tooltip = "Orbit radius in meters.")]
    public float Radius = 4.0f;

    [Property(Tooltip = "Revolutions per second.")]
    public float Speed = 0.25f;

    private float _Time;
    private FVector3 _Origin;

    public override void OnReady()
    {
        _Origin = Transform.GetLocalLocation();
    }

    public override void OnUpdate(float DeltaTime)
    {
        _Time += DeltaTime * Speed * MathF.Tau;
        float X = _Origin.X + MathF.Sin(_Time) * Radius;
        float Z = _Origin.Z + MathF.Cos(_Time) * Radius;
        Transform.SetLocalLocation(new FVector3(X, _Origin.Y, Z));
    }
}
```

`EntityScript` gives every script a few members, ready to use before the first
hook runs.

| Member | What it is |
| --- | --- |
| `Entity` | This entity's handle (an `Entity`, wrapping its id). |
| `World` | The world this entity lives in. |
| `Registry` | The world's component store (`World.Registry`). |
| `Transform` | This entity's `STransformComponent`, resolved once and cached. |

## A typed, reflection-driven API

Through the [reflection system](/manual/reflection/), **every component type you
define in C++ is exposed to C# by its name**, with no binding code to write. You
refer to a component by its C++ name (`STransformComponent`,
`SRigidBodyComponent`, `SStaticMeshComponent`) as a generic type argument, and
read or write its members directly.

```csharp
SRigidBodyComponent Body = Registry.Get<SRigidBodyComponent>(Entity);
Body.Mass = 5.0f;
```

The component types, the math types (`FVector3`, `FQuat`), and the event types
(`SCollisionEvent`, `InputEvent`) all live in the `Lumina` namespace; the
scripting surface (`EntityScript`, `Entity`, `Registry`, attributes, `Physics`,
`Net`) lives in `LuminaSharp`. Most scripts open both.

```csharp
using LuminaSharp;
using Lumina;
```

## `Entity` is this entity, `World` is everything else

The API has one rule that keeps it clean.

- **`Entity` / `Transform`** are *this* entity. Use them for this entity's
  transform, components, and identity.
- **`World`** is everything else, including other entities, physics, navigation,
  networking, and global helpers.

`World` exposes its subsystems as properties (`World.Physics`, `World.Draw`,
`World.Net`, `World.Navigation`, `World.Messages`) covered on the pages that
follow.

## Lifecycle hooks

Override only the ones you need. A hook you don't override costs nothing. An
entity with no `OnUpdate` is never ticked.

| Method | When it runs |
| --- | --- |
| `OnAttach()` | Once, when the instance is attached to its entity. The earliest hook. |
| `OnReady()` | Once, after `OnAttach`, before the first `OnUpdate` (all siblings are attached). Cache things and look up other entities here. |
| `OnUpdate(float DeltaTime)` | Every frame, while the entity is enabled. `DeltaTime` is seconds. |
| `OnInput(InputEvent Event)` | A keyboard or mouse event happened, while the entity is receiving input. See [Input](/manual/scripting/input/). |
| `OnDetach()` | Once, when the entity is destroyed or the script is removed. |

For the full picture (when each runs, the physics phase it runs in, what is
per-entity, how to run scripts in parallel, and how hot reload behaves) see
**[Entity Systems](/manual/scripting/entity-systems/)**.

## Attaching a script

In the editor, add a **C# Script** component to an entity, then click **Add
Script** and pick your script's type (for example `Game.Player`). An entity can
carry **several scripts** at once, each with its own properties; they run
independently. Press **Play** or **Simulate** to run them.

Attach, read, and remove scripts at runtime too. From inside a script these act
on its own entity:

```csharp
Weapon weapon = AddScript<Weapon>();   // attach a new script, returns the instance
Weapon? w     = GetScript<Weapon>();   // the first Weapon on this entity, or null
List<Weapon> all = GetScripts<Weapon>(); // every Weapon on this entity
RemoveScript<Weapon>();                // remove the first Weapon
```

The same calls exist on the registry for any entity, e.g.
`World.Registry.AddScript<Weapon>(entity)` or
`World.Registry.GetScript<Weapon>(entity)`.
