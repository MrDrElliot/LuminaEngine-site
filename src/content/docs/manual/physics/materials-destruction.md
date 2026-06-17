---
title: Materials & Destruction
description: Surface properties and breakable objects.
---

## Physics materials

A **Physics Material** asset describes a surface. Assign it to a collider's
**Physics Material** slot to control how it behaves.

| Property | What it does |
| --- | --- |
| **Friction** | Grip, 0 = ice, 1 = rubber. |
| **Restitution** | Bounciness, 0 = inelastic, 1 = perfectly elastic. |
| **Density** | kg/m³, used to compute a body's mass from its shape's volume. |
| **Friction / Restitution Combine** | How this surface's value mixes with the other body's at a contact, one of Average, Min, Multiply, or Max. |

When two bodies touch, their combine modes are reconciled by precedence with
**Max** taking priority, so a grippier or bouncier surface gets its way. A
collider with no material falls back to the rigid body's friction and restitution
overrides.

Create one from the **Content Browser** and edit it in the
[Physics Material editor](/manual/editor/asset-editors/).

## Destruction

Make an object shatter by adding a **Destructible** component next to its static
mesh. When it breaks, the entity splits into physics-driven chunks.

The break parameters below are exposed to script, so a C# script can tune them at
runtime, for example raising the outward speed of the pieces.

```csharp
SDestructibleComponent Destruct = Registry.Get<SDestructibleComponent>(Entity);
Destruct.ExplosionStrength = 12.0f;
```

Triggering the fracture itself is driven natively today; a script-facing
fracture call is not yet exposed in C#. Tune the break on the component.

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
