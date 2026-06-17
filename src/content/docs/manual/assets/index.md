---
title: Asset Pipeline
description: How content is stored, addressed, referenced, and shipped.
---

Everything you build a game from, meshes, textures, materials, prefabs, levels,
is an **asset**. This section covers how assets are stored, how you bring content
in, how assets point at each other, and how they are packaged for a shipped game.

## What an asset is

An asset is a piece of saved content. On disk, each one is a single **`.lasset`**
file under your project's content folder. You never edit `.lasset` files by hand,
you create and edit assets through the editor.

## Content paths

Assets are addressed by **content path**, not by where they sit on your drive.
The first segment of a path is a **mount**.

| Mount | Points at |
| --- | --- |
| **`/Game`** | Your project's `Game/Content/` folder. |
| **`/Engine`** | The engine's built-in content. |
| **`/Config`** | Your project's config. |

So `/Game/Meshes/Cube` is the file `Game/Content/Meshes/Cube.lasset` in your
project. Plugins mount their own content as well. Because everything is addressed
by mount, paths keep working no matter where the project lives on disk.

## Asset types

The asset types you will work with.

| Asset | What it is |
| --- | --- |
| **Static Mesh** | A non-animated mesh, with material slots. |
| **Skeletal Mesh** / **Skeleton** | A rigged mesh and its bone hierarchy. |
| **Animation** | A skeletal animation clip. |
| **Animation Graph** | A graph that drives a character's pose. |
| **Texture** | A 2D image, see [Textures](/manual/assets/textures/). |
| **Material** / **Material Instance** / **Material Function** | Surface shading. |
| **Physics Material** | Friction, restitution, and density. |
| **Particle System** | A particle effect. |
| **Geometry Collection** | Pre-fractured pieces for destruction. |
| **Prefab** | A saved entity hierarchy. |
| **Data Asset** / **Schema** | Custom data and the shape that defines it. |
| **Entity Component Type** | A data-authored component. |
| **Blackboard** | Typed keys for AI and animation. |
| **Font** | A typeface. |
| **World** | A level. |

You create most of these from the [Content Browser](/manual/editor/content-browser/)
(right-click), and import meshes, textures, and fonts from source files.

## Deleting assets

Select an asset in the [Content Browser](/manual/editor/content-browser/) and press
**Delete** (or right-click, Delete). Deletion is immediate and cannot be undone.

When you delete an asset, the following happens.

- It is removed from disk and from memory right away.
- Every reference to it is cleared. Components, other assets, and open worlds that
  pointed at it are set back to nothing, so you get an empty slot rather than a
  dangling reference to a deleted asset.
- If it is a **prefab**, its placed instances are removed from every open level.
  Detached copies survive. See [Prefabs](/manual/prefabs/).
- It does not show up in the unsaved-changes prompt when you close the editor.

Two things you cannot delete.

- A **World** that is currently open. Close it first.
- Anything while the game is **playing or simulating**. Stop play first.

## In this section

- **[Importing](/manual/assets/importing/)**, bringing in models, textures, and fonts.
- **[Textures](/manual/assets/textures/)**, color space and compression.
- **[Referencing Assets](/manual/assets/references/)**, pointing at assets from components and scripts.
- **[Cooking & Packaging](/manual/assets/packaging/)**, building a shipped game.
