---
title: Colliders
description: The shapes an entity collides with.
---

A **collider** gives a body its shape. Add one (or several) alongside a
[Rigid Body](/manual/physics/rigid-bodies/). Several colliders on one entity
combine into a compound shape.

## Shapes

| Collider | Shape | Key fields |
| --- | --- | --- |
| **Box** | A box | Half Extent (half-size per axis) |
| **Sphere** | A ball | Radius |
| **Capsule** | A pill, along local Y | Radius, Half Height |
| **Cylinder** | A flat-ended cylinder | Radius, Half Height, Cap Radius |
| **Mesh** | A mesh's geometry | Mesh, Convex |
| **Terrain** | A terrain heightmap | (needs a Terrain on the same entity) |

Every collider also has:

- **Translation Offset** and **Rotation Offset**, to place the shape relative to
  the entity, for example a 90° rotation lays a capsule on its side.
- **Physics Material**, the surface's friction and bounce, see
  [Materials & Destruction](/manual/physics/materials-destruction/).
- **Is Trigger**, makes it a non-solid trigger volume, see
  [Collisions & Triggers](/manual/physics/collisions/).
- **Affects Navigation**, whether the shape is baked into navmeshes.

## Mesh colliders: convex or concave

A **Mesh** collider builds its shape one of two ways:

- **Convex** (Convex on), a convex hull of the mesh. Valid on **dynamic** bodies.
  Use it for props.
- **Concave** (Convex off), the exact triangle mesh. Valid only on **static** or
  **kinematic** bodies. Use it for level geometry.

Prefer a primitive shape (box, sphere, capsule) over a mesh collider wherever you
can, they are far cheaper to simulate.
