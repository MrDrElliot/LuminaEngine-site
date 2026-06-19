---
title: Entity Systems
description: How a script attaches to an entity, when its code runs, the physics phase it runs in, and what is per-entity.
---

An entity's behavior is a C# script (an `EntityScript`) attached to it: its
**per-entity system**. Where a [world system](/manual/scripting/world-systems/)
is created once per world and iterates many entities, an entity system is one
instance per entity that runs *that* entity's logic.

This page is the whole picture of how that script attaches, *when* each part
runs, the physics phase it runs in, and what is per-entity versus shared. Read it
before you write much script code, the timing is the difference between code that
works and subtle bugs.

## An entity and its script

An entity on its own is just an id with components. Adding a **C# Script**
component, with a **Script Class**, is what gives it behavior. That component
holds the running instance and the editor-set property values.

```cpp
struct SCSharpScriptComponent
{
    FString ScriptClass;                          // e.g. "Game.Player", the class to run
    FScriptPropertyOverrides PropertyOverrides;   // [Property] values set in the editor

    void* Instance;                               // this entity's managed instance (a GCHandle)
    ECSharpBindState BindState;                    // Unbound -> Attached -> Ready
    // ...
};
```

## One instance per entity

Your script is a class. When it attaches to an entity, the engine creates **one
instance of that class for that entity**. That instance is what you write code
against, namely `this`. Two consequences, and both trip people up.

:::caution[Instance fields are per-entity; `static` is shared]
- **Each entity gets its own instance.** Two entities using the same script share
  nothing through ordinary (instance) fields, each has its own copy. To share
  state across *every* entity of a script, use a `static` field; statics live on
  the type, not the instance.
- **`Entity`, `World`, and `Transform` are not set in the constructor.** The
  engine injects them *after* constructing the instance, just before `OnAttach`.
  A field initializer or constructor runs too early to use them, so do per-entity
  setup that needs the entity in `OnReady`.
:::

```csharp
public sealed class Turret : EntityScript
{
    private static int Count;          // shared across every Turret in the world

    private FVector3 _Start;           // per-entity

    public override void OnReady()
    {
        Count++;                       // safe here: the instance is fully set up
        _Start = Transform.GetWorldLocation();
    }
}
```

## The order things run

For a single entity, top to bottom.

1. The engine **constructs the instance** and fills in `Entity`, `World`, and the
   cached `Transform`. Editor `[Property]` values are applied here too.
2. **`OnAttach`** runs, **top-down** (a parent before its children). The earliest hook.
3. **`OnReady`** runs, **bottom-up** (a child before its parent, so it runs up the
   tree with the root last), once the scene graph is set up. By now every child
   is ready, so it is safe to look up children and other entities here.
4. **`OnUpdate`** runs every frame while playing, in its update phase (below).
5. **`OnDetach`** runs once, when the entity is destroyed.

### At map load vs at runtime

- When a **map loads**, all of its entities run this together. Every script's
  `OnAttach` first, then every `OnReady`.
- When you **spawn an entity (or prefab) while the game is running**, its
  `OnAttach` runs immediately and `OnReady` right after. Either way, `OnReady`
  always runs once the entity is fully set up.

### In the editor

Scripts run only in **play mode** (a Game or Simulation world). In the plain
editor they stay dormant. Press **Play** or **Simulate** to run gameplay.

## Update phases

Like a [world system](/manual/scripting/world-systems/), an entity system runs in
a physics phase, and you choose which one. There are two update hooks plus a
fixed-step hook, and they run at different points relative to the physics step.

| Hook | When |
| --- | --- |
| `OnUpdate(float DeltaTime)` | Once per frame, in the entity's update phase (pre- or post-physics). |
| `OnFixedUpdate(float FixedDeltaTime)` | At the fixed physics rate, 0..N times per frame, *before* the physics step. |

### Pre-physics and post-physics

By default `OnUpdate` runs in the **pre-physics** phase, before the physics step,
which is where you read input and apply movement intent. Add
`[UpdatePhase(EScriptPhase.PostPhysics)]` to the class to run its `OnUpdate`
**after** physics resolves instead, which is where you read settled results, for
example a follow camera or syncing visuals to a body.

```csharp
[UpdatePhase(EScriptPhase.PostPhysics)]
public sealed class FollowCamera : EntityScript
{
    public override void OnUpdate(float DeltaTime)
    {
        // Bodies have already moved this frame, read their final transforms.
    }
}
```

`EScriptPhase` has `PrePhysics` (the default) and `PostPhysics`. The phase applies
to the whole script's `OnUpdate`.

### Fixed update for physics

`OnFixedUpdate(float FixedDeltaTime)` runs at the **fixed physics timestep**
(`1 / physics Hz`), zero or more times per frame, *before* each physics step. Its
delta is the fixed step, not the frame delta, so it is framerate-independent. Use
it for anything that drives the simulation: applying forces or impulses, and
character movement.

```csharp
public override void OnFixedUpdate(float FixedDeltaTime)
{
    Registry.Get<SRigidBodyComponent>(Entity).AddForce(_Move * 1000.0f);
}
```

Use `OnUpdate` for per-frame logic and visuals; use `OnFixedUpdate` for
physics-affecting forces and movement. They are independent: a script can
override either, both, or neither.

## Where to put what

| Put it here | For |
| --- | --- |
| **Fields + `[Property]`** | Constants, tuning values, and editor-exposed values. Initialized before the entity exists. |
| **`OnReady`** | Per-entity setup that needs the entity, such as caching components, reading the world, finding other entities. |
| **`OnUpdate`** | Per-frame behavior and visuals. |
| **`OnFixedUpdate`** | Forces, impulses, and movement that drive physics. |
| **`OnDetach`** | Cleanup, disposing subscriptions and timers you created (see [Events](/manual/scripting/events/)). |
| **A `static` member** | State or helpers shared across every entity of the script. |

```csharp
public sealed class Spinner : EntityScript
{
    [Property(Units = "deg/s")]
    public float TurnRate = 90.0f;     // editor-exposed, applied before OnReady

    public override void OnUpdate(float DeltaTime)
    {
        Transform.AddYaw(TurnRate * DeltaTime);
    }
}
```

## Hot reload

When you save a script while the editor is running, it **recompiles in place**.
The engine tears down the old managed instances, loads the new assembly,
and rebinds each entity (running `OnAttach` and `OnReady` again on the new
version). Your `[Property]` values set in the editor survive. They are stored on
the component and reconciled against the script's current fields, so they hold up
even as you add, remove, or rename fields. Ordinary runtime state held in instance
fields is reset. Hot reload is ideal for tuning; it just does not preserve a
script's accumulated state.
