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

A capsule's total height is `2 × (Half Height + Radius)`; a cylinder's is
`2 × Half Height`, with **Cap Radius** rounding the rim (set it to a small value
to avoid sharp-edge stuck contacts).

Every collider also carries the following.

- **Translation Offset** places the shape relative to the entity. Box, capsule,
  cylinder, and mesh colliders add a **Rotation Offset** too (a 90° rotation lays
  a capsule on its side); sphere and terrain have no rotation.
- **Physics Material** is the surface's friction and bounce, see
  [Materials & Destruction](/manual/physics/materials-destruction/). When unset,
  the rigid body's `*Override` fields apply.
- **Is Trigger** makes it a non-solid trigger volume, see
  [Collisions & Triggers](/manual/physics/collisions/).
- **Affects Navigation** sets whether the shape is baked into navmeshes.

## Mesh colliders, convex or concave

A **Mesh** collider builds its shape one of two ways.

- **Convex** (Convex on) is a convex hull of the mesh. Valid on **dynamic** bodies.
  Use it for props. If **Mesh** is left empty, it falls back to the entity's
  Static Mesh component.
- **Concave** (Convex off) is the exact triangle mesh. Valid only on **static** or
  **kinematic** bodies. Use it for level geometry.

Prefer a primitive shape (box, sphere, capsule) over a mesh collider wherever you
can. They are far cheaper to simulate.
