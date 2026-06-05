---
title: Materials & Destruction
description: Surface properties and breakable objects.
---

## Physics materials

A **Physics Material** asset describes a surface. Assign it to a collider's
**Physics Material** slot to control how it behaves:

| Property | What it does |
| --- | --- |
| **Friction** | Grip, 0 = ice, 1 = rubber. |
| **Restitution** | Bounciness, 0 = inelastic, 1 = perfectly elastic. |
| **Density** | kg/m³, used to compute a body's mass from its shape's volume. |
| **Friction / Restitution Combine** | How this surface's value mixes with the other body's at a contact: Average, Min, Multiply, or Max. |

When two bodies touch, the higher-precedence combine mode wins
(Max beats Min beats Multiply beats Average), so a "sticky" surface gets its way.
A collider with no material falls back to the rigid body's friction and
restitution overrides.

Create one from the **Content Browser** and edit it in the
[Physics Material editor](/manual/editor/asset-editors/).

## Destruction

Make an object shatter by adding a **Destructible** component next to its static
mesh. At runtime, break it from a script:

```lua
World.Fracture(self.Entity)                  -- shatter in place
World.FractureAt(self.Entity, x, y, z, 12)   -- shatter from a point, with force
```

The entity breaks into physics-driven chunks. Tune the break on the component:

| Property | What it does |
| --- | --- |
| **Fragment Count** | Roughly how many pieces, 2 to 512. |
| **Explosion Strength** | Default outward speed of the pieces. |
| **Spin Strength** | Random tumble added to each piece. |
| **Fragment Lifetime** | Seconds before pieces clean up (0 = forever). |
| **Destroy Original** | Remove the source entity when it breaks. |
| **Collection** | A pre-authored fracture pattern. Leave empty for automatic Voronoi fracturing. |

For pre-authored break patterns, fracture a mesh into a **Geometry Collection**
asset in its [editor](/manual/editor/asset-editors/).
