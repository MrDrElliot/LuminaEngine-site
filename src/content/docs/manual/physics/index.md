---
title: Physics
description: Rigid bodies, collisions, and characters, powered by Jolt.
---

Lumina's physics runs on **Jolt**, a fast, multi-threaded physics engine. You
set physics up by adding components to entities, the same way you add a mesh or a
light, see [Entities & Components](/manual/ecs/).

## The model

Two pieces make an entity physical.

- A **Rigid Body** decides how the entity moves, whether static, kinematic, or dynamic.
- One or more **Colliders** give it a shape to collide with.

A rigid body with no collider has nothing to hit, and a collider with no rigid
body is inert. A solid object needs both.

```
Crate (entity)
├── Static Mesh     what you see
├── Rigid Body      Dynamic
└── Box Collider    what it collides with
```

## Where physics runs

Physics only simulates in **Game** and **Simulation** worlds, that is, while you
**Play** or **Simulate**. The editor world does not tick physics, so bodies sit
still until you press Play. See [Worlds & Coordinates](/manual/worlds-and-coordinates/).

## This section

- **[Rigid Bodies](/manual/physics/rigid-bodies/)**, how an entity moves, plus forces and velocities.
- **[Colliders](/manual/physics/colliders/)**, the shapes it collides with.
- **[Collisions & Triggers](/manual/physics/collisions/)**, layers, masks, trigger volumes, and contact events.
- **[Queries](/manual/physics/queries/)**, raycasts, sphere casts, and overlaps.
- **[Projectiles](/manual/physics/projectiles/)**, lightweight swept projectiles.
- **[Character Controller](/manual/physics/characters/)**, walking, jumping, and player movement.
- **[Materials & Destruction](/manual/physics/materials-destruction/)**, surface properties and breakable objects.

Every page shows the same operation in **C++** and **C#**. Pick a language with
the tabs on any code sample and the whole site follows your choice.
