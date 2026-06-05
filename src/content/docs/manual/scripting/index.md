---
title: Lua Scripting
description: Gameplay in Luau against a typed, reflection-driven API.
---

Gameplay in Lumina is written in **Luau**, a fast, gradually typed dialect of
Lua. A script attaches to an entity and runs that entity's behavior. Scripts
hot-reload, so saving a file updates the running editor without a rebuild.

This page covers how a script is shaped and how it runs. The rest of the section
documents the API surface:

- **[Entities & Components](/manual/scripting/entities-components/)**, working with this entity and its components.
- **[The World API](/manual/scripting/world/)**, spawning, finding, and moving entities.
- **[Script Systems](/manual/scripting/systems/)**, world-level systems that run a rule across many entities.
- **[Physics & Collisions](/manual/scripting/physics/)**, forces, velocities, and contact callbacks.
- **[Input](/manual/scripting/input/)**, actions, keys, and the mouse.
- **[Events](/manual/scripting/events/)**, the entity message bus.
- **[Tasks & Yielding](/manual/scripting/tasks/)**, pausing a script with `Wait`, `Task.Spawn`, and awaitable loads.
- **[Networking](/manual/scripting/networking/)**, ownership, replication, and RPCs.
- **[Reference](/manual/scripting/reference/)**, types, math, and global tables.

## The Luau language

These docs cover Lumina's API, not the language itself. For Luau syntax, the
type system, and the standard library (`math`, `string`, `table`), see the
official [Luau documentation](https://luau.org/). Lumina runs Luau with its
[type checker](https://luau.org/typecheck) available in the editor, so type
annotations give you autocomplete and inline errors.

## Where scripts live

Scripts are `.luau` files in your project's `Game/Scripts/` folder. They are
referenced by content path, for example `/Game/Scripts/Player.luau`.

## Anatomy of a script

A script builds an `EntityScript`, defines functions on it, and returns it.
`EntityScript` is provided for you, there is no `require` to write. This complete
script orbits its entity around a point:

```lua
local Script: EntityScript = EntityScript.new()

local Radius = 4.0
local Speed  = 1.5

function Script:OnReady()
    self.Time   = 0.0
    self.Origin = self.Transform:GetLocation()
end

function Script:OnUpdate(DeltaTime: number)
    self.Time = self.Time + DeltaTime * Speed
    local x = self.Origin.x + math.sin(self.Time) * Radius
    local z = self.Origin.z + math.cos(self.Time) * Radius
    self.Transform:SetLocation(Vec3(x, self.Origin.y, z))
end

return Script
```

The engine injects a few fields onto `self` before your first function runs:
`self.Entity` (the entity id, a `number`), `self.World`, `self.Transform`, and
`self.Name`.

## A typed, reflection-driven API

Scripts are typed, and the editor knows your types. Through the
[reflection system](/manual/reflection/), **every component type you define in
C++ is exposed to Luau by its name**, with no binding code to write. You refer
to a component by its C++ name, for example `STextComponent` or
`SRigidBodyComponent`, both as a value you pass to component calls and as a type
you annotate with:

```lua
local body: SRigidBodyComponent = self:AddComponent(SRigidBodyComponent)
```

The editor also knows the `EntityScript` base, Luau's built-in `vector` type, and
event types like `SCollisionEvent`, so annotating a variable gives you
autocomplete and checking.

## `self` is this entity, `World` is everything else

The API has one rule that keeps it clean:

- **`self`** is *this* entity. Use it for this entity's components, transform, and identity.
- **`World`** is everything else: other entities, physics, networking, and global helpers.

:::note[Dot vs colon]
Methods are called with a colon: `self:Method()`, `component:Method()`,
`World.Physics:AddForce(...)`. Plain helpers and constructors are called with a
dot: `World.CreateEntity()`, `Vec3(...)`, `print(...)`. Mixing them up shifts
your arguments by one, so when something is off, check this first.
:::

## Lifecycle functions

Define only the ones you need. The tick functions cost nothing unless you define
them, an entity with no `OnUpdate` is never iterated.

| Function | When it runs |
| --- | --- |
| `Script:OnAttach()` | Once, before any `OnReady`. The earliest hook (see below). |
| `Script:OnReady()` | Once, after the scene graph is set up. Cache things and look up other entities here. |
| `Script:OnUpdate(DeltaTime: number)` | Every frame, in play mode. `DeltaTime` is seconds. |
| `Script:OnFixedUpdate(FixedDelta: number)` | At the physics rate, before each physics step. Apply forces here. |
| `Script:OnEditorUpdate(DeltaTime: number)` | Every frame while editing. Defining it is what makes a script run in the editor. |
| `Script:OnInput(Event: SInputEvent)` | A keyboard or mouse event happened, in play mode. See [Input](/manual/scripting/input/). |
| `Script:OnDetach()` | Once, when the entity is destroyed. |

`OnAttach` fires top-down (parents first); `OnReady` fires bottom-up (children
first) once the scene graph is set up. For the full picture, when each runs, what
is per-entity, how top-level code behaves, and hot reload, see
**[Script Lifecycle](/manual/scripting/lifecycle/)**.

Physics contact callbacks (`OnContactBegin`, `OnOverlapBegin`, and so on) are
covered in [Physics & Collisions](/manual/scripting/physics/).

## Attaching a script

In the editor, add a **Script** component to an entity and set its **Script
Path** to your `.luau` file. From code, call
`World.AddScript(entity, "/Game/Scripts/Player.luau")`. The live API reference is
always available in **Tools > Scripts Info**.
