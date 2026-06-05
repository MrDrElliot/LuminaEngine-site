---
title: Entities & Components
description: Working with this entity, its components, and its transform from a script.
---

`self` is the entity the script is attached to. This page covers what you can do
with it. To work with *other* entities, see [The World API](/manual/scripting/world/).

## Components

Component types come from C++ through [reflection](/manual/reflection/), so you
refer to them by name (`STextComponent`, `SRigidBodyComponent`, and so on). Pass
the type itself, not a string, and annotate the result to get its members:

```lua
local text: STextComponent = self:GetComponent(STextComponent)
if self:HasComponent(SRigidBodyComponent) then ... end
local mesh: SStaticMeshComponent = self:AddComponent(SStaticMeshComponent)
self:RemoveComponent(SBillboardComponent)
```

| Method | Returns |
| --- | --- |
| `self:GetComponent(Type)` | The component, or `nil` |
| `self:HasComponent(Type)` | `boolean` |
| `self:AddComponent(Type)` | The new component |
| `self:RemoveComponent(Type)` | nothing |

A component's own methods and fields depend on its type. See
[Entities & Components](/manual/ecs/) for the catalog of component types.

## Identity

| Member | What it is |
| --- | --- |
| `self.Entity` | This entity's id (a `number`) |
| `self.Name` | This entity's name |
| `self:IsValid()` | `false` once the entity is destroyed |
| `self:Destroy()` | Removes this entity |
| `self:Clone()` | Duplicates this entity, returns the new id |

## Transform

`self.Transform` is the live `STransformComponent`. Its getters return `vector`s.
Most methods work in **local** space (relative to the parent); use the `World`
variants to resolve through the parent chain.

```lua
local here: vector = self.Transform:GetLocation()   -- local-space position
self.Transform:SetLocation(Vec3(0, 2, 0))           -- local-space
self.Transform:GetWorldLocation()                   -- resolved world position
self.Transform:Translate(Vec3(0, 0, 1))
self.Transform:AddYaw(90)                            -- degrees; also AddPitch, AddRoll
self.Transform:SetLocalRotationFromEuler(Vec3(0, 90, 0))
```

| Method | Space | Returns |
| --- | --- | --- |
| `GetLocation()` / `SetLocation(v)` | local | `vector` |
| `GetRotation()` / `SetRotation(q)` | local | quat |
| `GetScale()` / `SetScale(v)` | local | `vector` |
| `GetWorldLocation()` / `GetWorldRotation()` / `GetWorldScale()` | world | |
| `GetLocalRotationAsEuler()` / `SetLocalRotationFromEuler(e)` | local | degrees |
| `Translate(delta)` | local | `vector` |
| `AddYaw(deg)` / `AddPitch(deg)` / `AddRoll(deg)` | local | |
| `GetForward()` / `GetRight()` / `GetUp()` | | `vector` |

:::note
Lumina is left-handed and Y-up (`+Z` is forward), in meters, and rotations are
in degrees. See [Worlds & Coordinates](/manual/worlds-and-coordinates/).
:::

## Hierarchy

`self.Tree` walks the parent and child graph. Single-entity getters return `nil`
when there is no result, so they read cleanly in `if` chains; list getters return
arrays of entity ids.

```lua
local parent = self.Tree:GetParent()        -- id or nil
for _, child in self.Tree:GetChildren() do ... end
self.Tree:SetParent(otherEntity)            -- nil detaches to the root
```

Common methods: `GetParent`, `GetChildren`, `GetRoot`, `GetAncestors`,
`GetDescendants`, `SetParent`, `AddChild`, `FindChild`, `FindDescendant`,
`IsChildOf`, `GetSiblings`.

## Camera

If this entity has a camera, make it the active view:

```lua
self:SetActiveCamera()           -- snap to this camera
self:SetActiveCamera(0.5)        -- blend over half a second
```

`self:SetCameraTarget(target)` points an attached follow or spring-arm rig at
another entity.

## Editable properties

Expose a value to the editor with an `--@export` comment on the line above a
top-level field. It appears in the entity's Script section in the Details panel,
and you read or write it as `self.<Name>`:

```lua
--@export(ClampMin = 0, Units = "m/s", Category = "Movement")
Script.Speed = 5.0

--@export(Tooltip = "Mesh to spawn", AssetType = "StaticMesh")
Script.Mesh = ""
```

The default value's type picks the widget. Supported keys include `ClampMin`,
`ClampMax`, `Delta`, `Units`, `Category`, `Tooltip`, `Color`, `ReadOnly`, and
`AssetType` (a loose-asset kind like `"luau"`, or a reflected class like
`"StaticMesh"` for an asset picker).
