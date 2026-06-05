---
title: Script Lifecycle
description: How a script attaches to an entity, when its code runs, and what is per-entity.
---

Understanding *when* each part of a script runs, and what is per-entity versus
shared, is the difference between code that works and subtle bugs. This page is
the whole picture. Read it before you write much script code.

## An entity and its script

An entity on its own is just an id with components. Adding a **Script** component
with a `.luau` path is what gives it behavior. That component holds the running
script and a slot for each lifecycle function:

```cpp
struct SScriptComponent
{
    FAssetRef ScriptPath;                         // the .luau to run
    FScriptPropertyOverrides PropertyOverrides;   // --@export values set in the editor

    TSharedPtr<Lua::FScript> Script;              // this entity's running instance
    Lua::FRef AttachFunc, ReadyFunc, UpdateFunc, DetachFunc;   // cached lifecycle hooks
    // also: FixedUpdateFunc, EditorUpdateFunc, InputFunc, and the contact hooks
};
```

## A script is a module, run once per entity

A `.luau` file is a **module**: it builds a `Script` table, defines functions on
it, and returns it.

```lua
local Script: EntityScript = EntityScript.new()   -- top level

Script.Speed = 5.0                                -- top level

function Script:OnReady() end                     -- top level: defines, does not run

return Script                                     -- top level
```

When the script attaches to an entity, the engine runs the file's **top-level
code, once, for that entity**, on its own sandboxed Lua thread, and keeps the
table you `return`. That table is the `self` you see inside every function. Two
things follow, and both trip people up:

:::caution[Top-level code is per-entity, and `self` is not set yet]
- **Each entity gets its own run and its own `self`.** Two entities using the
  same script share nothing. A `local Counter = 0` (or `Script.Counter = 0`) at
  the top level is **per entity**, not shared, each entity reran the file and got
  its own. For state shared across *every* entity of a script, put it in a module
  you `require`, those are loaded once and shared.
- **`self` is not populated yet at the top level.** The engine fills in
  `self.Entity`, `self.World`, `self.Transform`, and `self.Name` *just after* the
  file runs, so at the top level they are `nil`. Anything that needs the entity
  goes in `OnReady`, never at the top level.
:::

Under the hood, each entity's script lives on its own Lua thread with its own
global environment, which is what keeps one entity's script fully isolated from
another's.

## The order things run

For a single entity, top to bottom:

1. **Top-level code** runs, building the `Script` table. The engine then fills in `self.Entity`, `self.World`, `self.Transform`, `self.Name`.
2. **`OnAttach`** fires, **top-down** (a parent before its children). The earliest hook.
3. **`OnReady`** fires, **bottom-up** (a child before its parent, so it runs up the tree with the root last), once the scene graph is set up. By now every child is ready, so it is safe to look up children and other entities here.
4. **`OnUpdate`** and **`OnFixedUpdate`** run every frame while playing.
5. **`OnDetach`** fires once, when the entity is destroyed.

`OnAttach`, `OnReady`, and the event hooks can **pause and resume** — call `Wait`
or an awaitable load right inside them. `OnUpdate`/`OnFixedUpdate`/`OnDetach`
can't; spawn a task from them instead. See [Tasks & Yielding](/manual/scripting/tasks/).

### At map load vs at runtime

- When a **map loads**, all of its entities run this together: every script's
  top-level code and `OnAttach` first, then every `OnReady`.
- When you **spawn an entity or attach a script while the game is running**,
  `OnAttach` fires immediately and `OnReady` fires right after. Either way,
  `OnReady` always runs once the entity is fully set up.

### In the editor

In the plain editor (not playing), scripts stay dormant, their hooks do not run
unless the script defines `OnEditorUpdate`. Press **Play** or **Simulate** to run
gameplay scripts.

## Where to put what

| Put it here | For |
| --- | --- |
| **Top level** | Constants, tuning values, `--@export` fields, and function definitions. Runs once per entity, before `self` exists. |
| **`OnReady`** | Per-entity setup that needs the entity: caching components, reading the world, finding other entities. |
| **`OnUpdate`** | Per-frame behavior. |
| **`OnDetach`** | Cleanup. (Event subscriptions and timers are released for you.) |
| **A `require`d module** | Helpers or state shared across every entity of the script. |

```lua
-- top level: per-entity, runs once, no self yet
local TurnRate = 90.0

function Script:OnReady()
    -- self is ready here, cache and initialize
    self.StartLocation = self.Transform:GetLocation()
end

function Script:OnUpdate(DeltaTime: number)
    self.Transform:AddYaw(TurnRate * DeltaTime)
end

function Script:OnDetach()
    -- release anything you grabbed that the engine does not clean up
end

return Script
```

## Hot reload

When you save a script while the game is running, the engine reloads it live: it
calls `OnDetach` on the old version, discards the old per-entity state, runs the
new file, and fires `OnAttach` and `OnReady` again. Your `--@export` values set in
the editor survive, but ordinary runtime state held in `self` is reset. Hot
reload is ideal for tuning, it just does not preserve a script's accumulated
state.
