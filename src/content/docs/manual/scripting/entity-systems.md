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

An entity on its own is just an id with components. Adding an **Entity Script**
component and picking a class under **Add Script...** is what gives it behavior.
That component holds the running instances.

```cpp
struct SEntityScriptComponent
{
    TVector<TObjectPtr<CEntityScript>> Scripts;   // one entry per attached script
};
```

A script instance is an ordinary engine object. A C# script class is minted at
load time as a real `CClass` deriving `CEntityScript`, the same base a C++ script
derives, so the driver ticks both through one loop of virtual calls with no
language-specific path. Your `[Property]` values live on that object, which is
why they save, undo, and replicate with no extra code.

## One instance per entity

Your script is a class. When it attaches to an entity, the engine creates **one
instance of that class for that entity**. That instance is what you write code
against, namely `this`. Two consequences, and both trip people up.

:::caution[Instance fields are per-entity; `static` is shared]
- **Each entity gets its own instance.** Two entities using the same script share
  nothing through ordinary (instance) fields, each has its own copy. To share
  state across *every* entity of a script, use a `static` field; statics live on
  the type, not the instance.
- **`Entity` and `World` are not set in the constructor.** The engine sets the
  owner *after* constructing the instance, just before `OnAttach`. A field
  initializer or constructor runs too early to use them, so do per-entity setup
  that needs the entity in `OnReady`.
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

1. The engine **constructs the instance** and sets its owning entity and world.
   Editor `[Property]` values are applied here too.
2. **`OnAttach`** runs. The earliest hook.
3. **`OnReady`** runs on the first tick after attaching, so every script added the
   same frame exists by then. Cache things and look up other entities here.
4. **`OnUpdate`** runs every frame while playing, in its update phase (below).
5. **`OnDetach`** runs once, when the entity is destroyed or the script is removed.

:::caution[Order across entities is unspecified]
The driver walks the entities carrying an Entity Script component in storage
order, not in scene-graph order. A parent's `OnReady` may run before or after its
children's. If one script has to run after another, do not lean on hook order:
read the other script with `GetScript<T>()` when you need it, or use an
[event](/manual/scripting/events/).
:::

### At map load vs at runtime

- A script **loaded with a map** gets `OnAttach`, `OnReady`, and its first
  `OnUpdate` back to back on the first tick.
- A script **attached while the game is running** gets `OnAttach` immediately, in
  the `AddScript` call itself. `OnReady` is held until the next tick, so every
  sibling script added the same frame exists by the time it runs.

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
| `OnFixedUpdate(float FixedDeltaTime)` | At the fixed physics rate, 0..N times per frame, after the physics step. |

The frame runs its stages in this order, and the physics step sits between the
two script passes.

```
FrameStart -> PrePhysics -> DuringPhysics -> physics step -> PostPhysics -> FrameEnd
```

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
(`1 / PhysicsHz`), zero or more times per frame, in the post-physics stage. Its
delta is the fixed step, not the frame delta, so it is framerate-independent, and
the accumulator is clamped to `MaxPhysicsSteps` so a long hitch cannot queue a
hundred steps. Both knobs live on the world's settings. Use it for anything that
drives the simulation: applying forces or impulses, and character movement.

```csharp
public override void OnFixedUpdate(float FixedDeltaTime)
{
    Registry.Get<SRigidBodyComponent>(Entity).AddForce(_Move * 1000.0f);
}
```

Use `OnUpdate` for per-frame logic and visuals; use `OnFixedUpdate` for
physics-affecting forces and movement. They are independent: a script can
override either, both, or neither.

## Threading

Scripts run on the game thread, one after another, in an unspecified order. That
is always safe: a script can freely touch other entities, spawn or destroy
entities, and add or remove components.

There is no per-script parallel opt-in. When you have a rule that applies to many
entities and want it spread across worker threads, write it as a
[world system](/manual/scripting/world-systems/) and declare its component access
with `[Reads]` / `[Writes]`; the scheduler then runs it beside any system that
does not conflict. For self-contained compute, hand the work to the
[task system](/manual/scripting/tasks/) and apply the results on the game thread.

## Disabling a script

An entity carrying `SDisabledTag` or `SScriptDisabledTag` is skipped by the
driver entirely, so none of its scripts tick. Adding and removing the tag is the
cheap way to park behavior without detaching anything.

```csharp
Registry.Emplace<SScriptDisabledTag>(Entity);   // stop ticking
Registry.Remove<SScriptDisabledTag>(Entity);    // resume
```

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
The engine tears down the old managed instances, loads the new assembly, and
rebinds each entity, running `OnAttach` and `OnReady` again on the new version.

Your `[Property]` values set in the editor survive, including as you add, remove,
and retype fields. Renaming a field keeps its value only if you give it
`[Alias("OldName")]`, because values are matched by name. Ordinary runtime state
held in instance fields is reset.

Full details, including renaming the script class itself, are in
**[Hot Reload](/manual/scripting/hot-reload/)**.
