---
title: Asset Editors
description: The dedicated editor for each asset type.
---

Double-click an asset in the [Content Browser](/manual/editor/content-browser/)
to open it. Each asset type has its own editor.

| Asset | Editor |
| --- | --- |
| **Material** | A node graph that compiles to a shader, with a live preview. |
| **Material Instance** | Override a base material's parameters without recompiling. |
| **Material Function** | Reusable node groups for use inside materials. |
| **Static Mesh** | Inspect geometry, LODs, and material slots. |
| **Skeletal Mesh** / **Skeleton** | Preview a rigged mesh, inspect the bone hierarchy. |
| **Animation** | A timeline for clips, keyframes, and notifies. |
| **Animation Montage** | Assemble clips into a playable montage. |
| **Blend Space** | Blend clips across one or two input axes. |
| **Animation Graph** | A state and blend graph that drives a character's pose. |
| **Particle System** | Node-graph particle effects with a preview. |
| **Geometry Collection** | Fracture a mesh into chunks for [destruction](/manual/physics/materials-destruction/). |
| **Physics Material** | Friction, restitution, and density, see [Physics](/manual/physics/materials-destruction/). |
| **Physics Asset** | Bodies and joints for ragdolls. |
| **Collision Shape** | An authored collision primitive set. |
| **Data Asset** | Author a data asset's fields. |
| **Data Table** | Rows of a structured type. |
| **Curve** | An editable value curve. |
| **Audio Stream** | Preview and configure an imported sound. |
| **Prefab** | Edit a saved entity hierarchy. |
| **Texture** / **Font** | Preview images and typefaces. |

Two file types open in an editor without being assets:

| File | Editor |
| --- | --- |
| **UI** (`.rml` / `.rcss`) | A markup and stylesheet editor with a live preview, see [User Interface](/manual/ui/). |
| **Script** (`.cs`) | Opens in your IDE. Scripts compile and hot-reload on save, see [Scripting](/manual/scripting/). |
