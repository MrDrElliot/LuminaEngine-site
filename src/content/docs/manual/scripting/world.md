---
title: The World API
description: Spawning, finding, and moving entities through the global World.
---

`World` is how a script reaches everything beyond its own entity. It has two
parts: **flat helpers** called with a dot, and **subsystems** called with a
colon.

```lua
local e = World.CreateEntity("Pickup")          -- flat helper, dot
World.Physics:AddImpulse(e, Vec3(0, 500, 0))    -- subsystem, colon
```

## Flat helpers

These are called with a dot and take an entity id where one is needed.

### Entities

| Call | Result |
| --- | --- |
| `World.CreateEntity([name])` | A new entity id |
| `World.Destroy(entity)` | Removes the entity |
| `World.Duplicate(entity)` | Copies it, returns the new id |
| `World.IsValid(entity)` | `boolean` |
| `World.FindByName(name)` | First entity with that name |
| `World.FindByTag(tag)` | First entity with that tag |
| `World.GetNumEntities()` | Count |

### Components and scripts

| Call | Result |
| --- | --- |
| `World.AddComponent(entity, Type)` | The new component |
| `World.RemoveComponent(entity, Type)` | nothing |
| `World.GetComponent(entity, Type)` | The component or `nil` |
| `World.HasComponent(entity, Type)` | `boolean` |
| `World.AddScript(entity, "/Game/Scripts/X.luau")` | Attaches a script |
| `World.GetScript(entity)` | The script table or `nil` |

### Transform (world space)

| Call | Result |
| --- | --- |
| `World.GetLocation(entity)` / `World.SetLocation(entity, v)` | `vector` |
| `World.GetRotation(entity)` / `World.SetRotation(entity, q)` | quat |
| `World.GetScale(entity)` / `World.SetScale(entity, v)` | `vector` |
| `World.Translate(entity, delta)` | New location |
| `World.SetLocalLocation(entity, v)` | Parent-relative move |
| `World.AttachEntity(child, parent)` | Parents `child` under `parent` |

### Spawning and time

| Call | Result |
| --- | --- |
| `World.SpawnPrefab(path)` | Instantiates a prefab, returns its root |
| `World.SpawnPrefabAt(path, location)` | Same, at a location |
| `World.GetDeltaTime()` | Seconds since last frame |
| `World.GetTimeSinceCreation()` | Seconds since the world started |

### Bulk spawning

When you spawn many physics bodies in a loop, wrap it so body creation is
batched. The two calls must be paired:

```lua
World.BeginPhysicsBatch()
for i = 1, 500 do
    local c = World.CreateEntity()
    World.AddComponent(c, SStaticMeshComponent):SetStaticMesh(Engine.GetCubeMesh())
    World.SetLocation(c, Vec3(i, 3, 0))
end
World.EndPhysicsBatch()
```

### Destruction

`World.Fracture(entity)` shatters a destructible entity into physics chunks;
`World.FractureAt(entity, x, y, z [, strength])` fractures from a point.

## Subsystems

Subsystems are typed userdata reached with a colon:

- **`World.Physics`**, forces, velocities, and bodies. See [Physics & Collisions](/manual/scripting/physics/).
- **`World.Net`**, roles, ownership, hosting. See [Networking](/manual/scripting/networking/).
- **`World.Debug`**, debug drawing. Available in Development and Debug builds only.

```lua
-- World.Debug, Development and Debug builds only:
World.Debug:DrawSphere(self.Transform:GetWorldLocation(), 0.5, Vec3(1, 0, 0))
World.Debug:DrawLine(a, b, Vec3(0, 1, 0))
```

`World.Debug` draws: `DrawText`, `DrawLine`, `DrawBox`, `DrawSphere`,
`DrawCapsule`, `DrawCone`, `DrawArrow`. Each takes optional trailing arguments
for thickness, depth test, and duration.
