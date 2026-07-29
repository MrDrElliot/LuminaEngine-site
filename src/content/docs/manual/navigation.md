---
title: Navigation
description: Baking a navmesh with Recast, and driving agents along paths.
---

Navigation is built on **Recast and Detour**. You place a **NavMesh** component
to define a bake volume, bake it, and then give entities a **Path Follow**
component to move along paths.

## The NavMesh component

Add a NavMesh component to an entity to define a bake volume.

| Property | Meaning |
| --- | --- |
| **Center** | World-space center of the bake volume. |
| **Extents** | Half-extents of the bake volume. Default 64 by 16 by 64. |
| **Auto Bake** | Re-bake automatically when the bounds or settings change, for example when the volume is placed or moved in the editor. |
| **Settings** | The Recast build parameters, below. |

The baked result is stored as **tile blobs** on the component and serialized with
the world, so a shipped game does not bake at load. An empty tile means nothing
walkable was found there.

The world editor also has a **NavMesh** edit mode for visualizing and rebuilding
the mesh.

## Build settings

These map onto Recast's parameters. The defaults suit a roughly human-sized
agent in meters.

**Voxel**

| Setting | Default | Effect |
| --- | --- | --- |
| Cell Size | 0.30 | Horizontal voxel size. Smaller gives sharper edges at a **cubic** increase in bake cost. |
| Cell Height | 0.20 | Vertical voxel size. Drives stair and climb resolution. |

**Agent**

| Setting | Default | Effect |
| --- | --- | --- |
| Agent Radius | 0.40 | Erodes the walkable surface by this amount. |
| Agent Height | 1.80 | Surfaces with less clearance are excluded. |
| Agent Max Climb | 0.40 | Tallest step, stair, or ledge the agent can climb. |
| Agent Max Slope | 45 degrees | Steepest walkable slope. |

**Polygonization**

| Setting | Default | Effect |
| --- | --- | --- |
| Edge Max Length | 12.0 | Longer contour edges are split. |
| Edge Max Error | 1.3 | How far a simplified edge may deviate from the raw contour. |
| Verts Per Poly | 6 | Maximum vertices per nav polygon. Three to six is the useful range. |

**Region**

| Setting | Default | Effect |
| --- | --- | --- |
| Region Min Size | 8 | Regions with less floor area than this (in voxels) are dropped. |
| Region Merge Size | 20 | Adjacent regions smaller than this are merged. |

**Detail mesh**

| Setting | Default | Effect |
| --- | --- | --- |
| Detail Sample Dist | 6.0 | Detail mesh sample spacing. |
| Detail Sample Max Error | 1.0 | Detail mesh error tolerance. |

Tiles are the unit of both parallel baking and runtime streaming, so tile size
affects bake parallelism as well as memory.

The single most common mistake is lowering cell size to fix a small navigation
gap. Cost scales cubically. Adjust the agent parameters first.

## Path following

Add a **Path Follow** component to an entity that also has a character
controller. The system plans a path and writes movement input into the
controller each tick, so you do not move the entity yourself.

Set a goal one of two ways:

- **A world location.** A static goal. Triggers a fresh path request next tick.
- **A target entity.** The system re-projects the entity's current location every
  tick and replans when it moves far enough.

| Property | Default | Meaning |
| --- | --- | --- |
| **Acceptance Radius** | 0.5 | Distance below which a corner counts as reached and the agent advances to the next. |
| **Speed** | 1.0 | A throttle from 0 to 1 applied to the controller's move speed. Lower it for a walk; the movement system supplies the absolute speed. |
| **Repath Distance** | 1.5 | Replan when a tracked target moves more than this from the cached path's source point. Ignored for a static goal. |
| **Repath Interval** | 1.0 | Hard replan interval in seconds, as a backstop. |
| **Drive Character Controller** | true | When false the system stops writing movement input, so gameplay can take over. |
| **Draw Debug Path** | false | Emits debug lines along the cached path each tick. |

The component exposes status to scripts, so a typical AI is three calls: set a
target, check whether it is still following, check whether it has arrived.

Paths are capped at 64 corners and stored in a fixed array on the component to
avoid per-tick heap allocation. A path longer than that is truncated, which in
practice means very long routes need intermediate goals.

## Scripting

Setting targets, reading path status, and combining navigation with perception
are covered in the scripting section. See
[AI Perception](/manual/scripting/perception/) for the sensing side and
[Blackboards](/manual/scripting/blackboard/) for storing AI state.

## Current limitations

- Nav volumes are baked, not dynamically regenerated at runtime. Moving geometry
  does not update the mesh; auto-bake applies to editor-time changes.
- Off-mesh links (jump or ladder connections) are read and visualized if the
  Detour data contains them, but there is no authoring path for placing them.
- Local avoidance between agents is not implemented; agents follow their own
  paths independently.
