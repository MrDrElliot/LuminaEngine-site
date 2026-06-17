---
title: Importing
description: Bringing models, textures, and fonts into your project.
---

To import a source file, **drag it from your file explorer into the
[Content Browser](/manual/editor/content-browser/)**, or onto the viewport. The
engine converts it into an asset in the current folder, and it appears right
away.

## Supported formats

| Kind | Source formats | Becomes |
| --- | --- | --- |
| **Models** | `.gltf`, `.glb`, `.fbx`, `.obj` | Static Mesh, or Skeletal Mesh + Skeleton + Animations |
| **Textures** | `.png`, `.jpg`, `.jpeg`, `.hdr` | Texture |
| **Fonts** | `.ttf`, `.otf` | Font |

:::note
Importing audio files is not available yet.
:::

## Importing a model

Models open an **import dialog** so you can choose what to pull in. It previews
the meshes, materials, textures, skeleton, and animations found in the file, and
lets you set the following.

| Option | What it does |
| --- | --- |
| **Import Meshes** | Bring in the geometry. |
| **Import Skeletons** | Bring in the bone hierarchy, for rigged models. |
| **Import Animations** | Bring in animation clips. |
| **Import Materials** | Create material assets from the file's materials. |
| **Import Textures** | Bring in embedded textures (shown when not importing materials). |
| **Scale** | A uniform scale applied on import. |
| **Flip UVs** / **Flip Normals** | Fix models authored with a different convention. |
| **Optimize Mesh** | Reorder vertices for better GPU cache use. |
| **Merge Meshes** | Combine all meshes in the file into one asset. |

A model with skinning becomes a **Skeletal Mesh** wired to its **Skeleton**; a
plain model becomes a **Static Mesh**. Material slots are created from the file's
materials, you reassign them later in the mesh's editor, or per entity with the
mesh component's Material Overrides.

## Reimporting

- **Textures** can be reimported in place. The Texture editor has a **Recook**
  button that re-reads the source file, useful after you change the color space.
- **Models** do not reimport in place yet. Dragging the source file in again
  creates a new, separate asset rather than updating the existing one.
