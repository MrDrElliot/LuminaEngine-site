---
title: Entities & Components
description: "The world model: entities, components, and prefabs."
---

A Lumina world is a flat set of **entities**. An entity is just an id, it holds
no data of its own. Everything about it, its position, its mesh, its behavior,
lives in **components** attached to it. There is no "game object" base class;
you compose an entity from the components it needs.

## Entities

Create an entity from the **Scene Outliner** (the **+** button) or by
right-clicking in the viewport. You can:

- Create an **empty** entity,
- Create one with a single component already on it,
- Create a primitive (cube, sphere, and so on), which is an entity with a mesh,
- Drag an asset (mesh or prefab) from the Content Browser into the scene.

Every entity is created with two components you do not manage by hand:

- **Transform**, its position, rotation, and scale.
- **Name**, the label shown in the Outliner (rename from the right-click menu).

### Transform and hierarchy

The Transform's **Location**, **Rotation**, and **Scale** are edited in the
Details panel or with the viewport gizmo. These values are **local**, relative
to the entity's parent (or to the world if it has no parent). Lumina is
left-handed and Y-up, in meters, see
[Worlds & Coordinates](/manual/worlds-and-coordinates/).

To parent one entity to another, drag its row onto another row in the Outliner.
A child's transform is then relative to its parent, so moving the parent moves
the child.

## Components

Select an entity, then click the **+** button in the **Details** panel header to
add a component. Components are grouped by category and searchable. Once added,
a component's properties appear in Details, generated from reflection, and you
edit them there. Property metadata drives the widgets: color pickers, value
ranges and units, asset pickers, and an entity-reference picker for fields that
point at another entity.

### Common components

You will not need most of these at first. Browse the full list in the Add
Component menu.

**Rendering**

| Component | Does |
| --- | --- |
| Static Mesh | Renders a static mesh asset. |
| Skeletal Mesh | Renders and animates a rigged mesh. |
| Text | Draws a world-space text string. |
| Billboard | A camera-facing textured quad. |
| Decal | Projects a material onto surfaces. |
| Post Process | A volume that blends post-process settings. |

**Lights & environment**

| Component | Does |
| --- | --- |
| Directional / Point / Spot Light | The three light types. |
| Sky Light | Ambient and image-based fill light. |
| Environment | Sky background and image-based lighting. |
| Exponential Height Fog | Height fog and volumetric light shafts. |

**Camera**

| Component | Does |
| --- | --- |
| Camera | A camera with field of view and post-process settings. |
| Camera Follow | Eases a camera toward and faces a target. |
| Spring Arm | A third-person camera boom with collision. |

**Physics**

| Component | Does |
| --- | --- |
| Rigid Body | Makes the entity a physics body. |
| Box / Sphere / Capsule / Cylinder Collider | A collision shape. |
| Mesh Collider | Collision from mesh geometry. |

**Gameplay**

| Component | Does |
| --- | --- |
| C# Script | Attaches a C# script. |
| Input | Per-entity gameplay input (see [Scripting](/manual/scripting/)). |
| Audio Source / Listener | A positional sound, and the listener. |
| Rigid Body, characters, AI, particles | Movement, navigation, effects, and more. |

## Data-driven assets

To author structured data without writing C++, use a **Data Asset**: define its
fields with a **Schema**, then create assets against that schema and reference
them from components or scripts. See the
[Data Asset editor](/manual/editor/asset-editors/). For per-entity behavior and
state, write a [C# script](/manual/scripting/).

## Prefabs

A **prefab** is a saved entity, with its children, that you can stamp into a
world.

- **Create one** by selecting entities, right-clicking, and choosing **Create
  Prefab from Selected**. Children are captured automatically.
- **Place one** by dragging the prefab asset from the Content Browser into the
  viewport or onto an Outliner row.

Placed instances re-sync when you save the prefab, so editing the asset updates
every instance, while each instance keeps its own placement. To turn an instance
back into plain entities, right-click it and choose **Detach from Prefab**.
