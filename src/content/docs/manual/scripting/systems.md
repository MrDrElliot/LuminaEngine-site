---
title: Script Systems
description: Author world-level ECS systems in Luau that run in the same pipeline as native systems.
---

A **script system** is a Luau system that runs over the *whole world*, not a
single entity. Where an [entity script](/manual/scripting/) is attached to one
entity and runs that entity's behavior, a script system is assigned to the
**world** and iterates entities itself, once per frame, just like an engine
(C++) system. The two are different tools:

| | Entity script | Script system |
| --- | --- | --- |
| Attached to | one entity (Script component) | the world (Systems panel) |
| `self` | this entity | *(none, a system is stateless)* |
| Iterates | nothing, it *is* the entity | entities you query through `ctx` |
| Good for | one actor's behavior | a rule applied across many entities |

Reach for a script system when a behavior is really a *rule over a set of
entities*, spin everything tagged `Rotator`, drain every `Health` below zero,
rather than logic that belongs to one actor.

## Anatomy of a system

A system is a module that returns a **descriptor table**: some metadata fields
and an `Update` function. There is no base class and no `require`.

```lua
local System = {}

System.Name     = "Spin"          -- display name in the editor (optional)
System.Stage    = "PrePhysics"    -- which update stage to tick in
System.Priority = "Medium"        -- order within the stage (optional)

function System.Update(ctx, dt)
    ctx:Each({ STransformComponent }, function(entity)
        local t = ctx:Get(entity, STransformComponent)
        if t then
            t:AddRotationFromEuler(Vec3(0.0, 90.0 * dt, 0.0))
        end
    end)
end

return System
```

:::note[Hooks take `ctx`, not `self`]
A system is **stateless**, so its functions are plain table functions (dot, not
colon) and receive the system context `ctx` as their first argument:
`function System.Update(ctx, dt)`. Writing `function System:Update(...)` (colon)
adds a hidden `self` and shifts your arguments by one.
:::

### Hooks

Define only what you need. `Update` is required; the others are optional.

| Function | When it runs |
| --- | --- |
| `System.Startup(ctx)` | Once, when the system is added to the world (or the world loads). |
| `System.Update(ctx, dt)` | Every frame, in its stage. `dt` is seconds. |
| `System.Teardown(ctx)` | Once, when the system is removed (or the world tears down). |

## Stages and priority

A system runs in one **update stage**, and systems within a stage run in
**priority** order. These mirror the engine's own pipeline.

| `Stage` | Runs |
| --- | --- |
| `"FrameStart"` | Start of frame, before anything else. |
| `"PrePhysics"` | Before the physics step (input, movement intent). |
| `"DuringPhysics"` | Alongside the physics step (queries, raycasts). |
| `"PostPhysics"` | After physics resolves (react to results). |
| `"FrameEnd"` | End of frame. |
| `"Paused"` | While the editor is idle, the only stage that ticks when not in play. |

`Priority` is one of `"Highest"`, `"High"`, `"Medium"` (the default), or
`"Low"`; higher priority ticks first within the stage.

To run in several stages, use a `Stages` map instead of `Stage`/`Priority`:

```lua
System.Stages = {
    PrePhysics = "High",
    FrameEnd   = "Low",
}
```

## The system context (`ctx`)

`ctx` mirrors the C++ system context: time, and entity/component access over the
live world. Components are referred to by their reflected struct global (for
example `STransformComponent`), exactly as in entity scripts.

| Call | Does |
| --- | --- |
| `ctx:DeltaTime()` / `ctx:Time()` | Seconds this frame / total world time. |
| `ctx:Each({A, B}, fn)` | Run `fn(entity)` for every entity that has all listed components. |
| `ctx:Get(entity, Comp)` | The component on `entity`, or `nil`. |
| `ctx:Has(entity, Comp)` | Whether `entity` has the component. |
| `ctx:Emplace(entity, Comp)` | Add the component and return it. |
| `ctx:Remove(entity, Comp)` | Remove the component. |
| `ctx:Create()` / `ctx:Destroy(entity)` | Make or destroy an entity. |
| `ctx:View(A, B, ...)` | A runtime view of entities with all listed components. |
| `ctx:Registry()` | The raw entity registry, for the full [World API](/manual/scripting/world/). |

Everything outside the entity set, physics, networking, debug drawing, is
reached through the global `World` table just like in entity scripts:
`World.Physics`, `World.Net`, `World.Debug`. See [The World
API](/manual/scripting/world/).

## Assigning a system to a world

Systems are assigned per world, not per entity. Open the **Systems** panel (see
[Panels](/manual/editor/panels/)):

- **Native Systems** lists the engine's C++ systems; the checkbox enables or
  disables one for this world.
- **Script Systems** is where you add yours. Use **Add script system…** to pick a
  `.luau` file, and the trash icon to remove one.

The assignment is saved with the world. Like everything else in Luau, a system
**hot-reloads**, save the file and the running world picks up the change without
a rebuild.

:::note[Stateless and single-threaded]
Keep systems stateless, hold no per-frame state on the module table. Native
systems with non-overlapping component access run in parallel; script systems
always run on the script thread (the Luau VM is single-threaded), so they tick
one at a time.
:::
