---
title: Manual Overview
description: A map of the engine's major systems.
---

The manual covers the systems you actually use to build a game. Each page is
practical, covering what the system is, how you drive it from the editor or a
script, and where its edges are.

Lumina is editor-first and data-driven. You build scenes from entities and
components, author looks with materials and lights, and write gameplay in C#. The
editor and the game run on the same runtime, so what you see while editing is
what ships.

## Systems

| Section | Covers |
| --- | --- |
| **[Editor](/manual/editor/)** | The workspace, viewport, panels, content browser, asset editors, and profiling tools. |
| **[Entities & Components](/manual/ecs/)** | The world model: entities, components, and how they compose. |
| **[Worlds & Coordinates](/manual/worlds-and-coordinates/)** | Worlds, the coordinate system, and transforms. |
| **[Prefabs](/manual/prefabs/)** | Reusable entity templates, instances, and per-property overrides. |
| **[Terrain](/manual/terrain/)** | Heightmap terrain, sculpting, layer painting, and foliage. |
| **[C# Scripting](/manual/scripting/)** | Gameplay in C# against a typed API, with in-editor hot reload. |
| **[Rendering](/manual/rendering/)** | Materials, lights, environment, shadows, and post-processing. |
| **[Materials](/manual/materials/)** | The material graph, instances, and best practices. |
| **[Cameras](/manual/cameras/)** | Camera components, rigs, and shakes. |
| **[Water](/manual/water/)** | The water component and buoyancy. |
| **[Particles](/manual/particles/)** | GPU particle systems and the module stack. |
| **[Physics](/manual/physics/)** | Rigid bodies, colliders, collisions, characters, and destruction. |
| **[Gameplay Tags](/manual/gameplay-tags/)** | Hierarchical tags for classifying entities, filtering, and message channels. |
| **[Animation](/manual/animation/)** | Skeletal meshes, animation graphs, notifies, root motion, and ragdolls. |
| **[Navigation](/manual/navigation/)** | Baking a navmesh and driving agents along paths. |
| **[Networking](/manual/networking/)** | Net modes, roles, replication, and hosting a session. |
| **[Audio](/manual/audio/)** | Sources, buses, mixing, and audio settings. |
| **[Asset Pipeline](/manual/assets/)** | Importing, textures, references, cooking, and packaging. |
| **[Reflection](/manual/reflection/)** | Making your own types visible to the editor, serialization, and scripts. |
| **[Logging](/manual/logging/)** | Log levels, the console, and where log output goes. |

## Where to start

New to the engine? Read [Installation](/getting-started/installation/), then
[Your First Project](/getting-started/first-project/), then the
[First-Person Tutorial](/getting-started/first-person-tutorial/).

Already comfortable in another engine? Start with
[Entities & Components](/manual/ecs/) and [C# Scripting](/manual/scripting/);
those two differ most from what you are used to.

## Working on the engine itself

The manual stops at the API surface. If you are modifying the engine rather than
building a game with it, the [Engine Internals](/internals/) section covers the
C++ subsystems: the application lifecycle, the threading model, the object and
reflection systems, the RHI and render pipeline, the editor's architecture, and
the build system.
