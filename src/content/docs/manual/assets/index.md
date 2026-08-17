---
title: Assets
description: What an asset is, how it is identified, and how content is addressed.
---

Everything you build a game from, meshes, textures, materials, prefabs, levels,
is an **asset**. This section covers what assets are, how to organize and change
them safely, how they point at each other, and how they are packaged for a
shipped game.

## What an asset is

An asset is a piece of saved content. On disk it is a single **`.lasset`** file
under your project's content folder. You never edit a `.lasset` by hand, you
create and edit assets through the editor.

A `.lasset` file is a **package**. Most packages hold exactly one asset, which is
why "asset" and "file" usually mean the same thing in practice. Some hold more:
a material also stores its node graph inside its own package, a skeletal mesh
import can bring a skeleton along. Those extra objects belong to the package and
travel with it, they are not separate files you manage.

## Identity: assets are found by id, not by path

This is the single most important thing to understand about managing content.

Every asset carries a **GUID**, a stable id assigned when it is created and
stored inside the file. When one asset references another, it stores that id, not
the path. The path is a label for humans and for the Content Browser.

Two consequences follow, and they drive almost every rule on the
[Managing Assets](/manual/assets/managing/) page.

- **Renaming and moving an asset is safe.** Everything pointing at it keeps
  working, because nothing was pointing at the old path in the first place.
- **Copying a `.lasset` file outside the editor is not safe.** The copy carries
  the same id as the original, and the engine treats an id as belonging to one
  asset. Use **Duplicate** in the Content Browser instead, which mints a new id.

## Content paths

Assets are addressed by **content path**, not by where the project sits on your
drive. The first segment of a path is a **mount**.

| Mount | Points at |
| --- | --- |
| **`/Game`** | Your project's `Game/` folder. |
| **`/Engine`** | The engine's built-in content. |
| **`/Config`** | Your project's config. |
| **`/Intermediates`** | Generated intermediate files. |
| **`/<PluginName>`** | Content shipped by an enabled plugin. |

Your own content lives under `Game/Content/`, so its paths start with
`/Game/Content/`. The asset at `Game/Content/Meshes/Cube.lasset` is addressed as:

```
/Game/Content/Meshes/Cube
```

Note that the content path has no `.lasset` extension. The extension is part of
the file name, not part of the asset's address.

Because everything is addressed through a mount, paths keep working no matter
where the project lives on disk, and a packaged game resolves the same paths it
used in the editor.

## Asset types

The asset types you will work with.

Right-clicking in the [Content Browser](/manual/editor/content-browser/) offers a
**New Asset** menu grouped by category. These are the types it can create.

| Category | Assets |
| --- | --- |
| **World** | **World**, a level. **Texture**. |
| **Mesh** | **Geometry Collection**, pre-fractured pieces for destruction. |
| **Material** | **Material**, **Material Instance**, **Material Function**. See [Materials](/manual/materials/). |
| **Textures** | **Texture Array**. |
| **Render Target** | **Render Target**, a texture the renderer draws into. |
| **Animation** | **Animation Graph**, **Animation Montage**, **Blend Space**, **Sequence**. |
| **Physics** | **Physics Material** (friction, restitution, density), **Physics Asset** (bodies and joints for ragdolls), **Collision Shape**. |
| **Effects** | **Particle System**. |
| **Audio** | **Audio Stream**. |
| **Data** | **Data Asset**, **Data Table**, **Curve**. |
| **Gameplay** | **Prefab**, a saved entity hierarchy. |
| **UI** | **Font**. |

Some asset types are not created from scratch but come in through
[importing](/manual/assets/importing/):

| Asset | Comes from |
| --- | --- |
| **Static Mesh** | A model with no skinning. |
| **Skeletal Mesh** and **Skeleton** | A rigged model. |
| **Animation** | One clip per animation in the source file. |

Textures, fonts, and audio can be either created empty or imported.

### Files that are tracked but are not assets

Some loose text files are tracked so that references to them survive a rename:
RmlUi documents (`.rml`) and stylesheets (`.rcss`). They are not packages, so
they get their id from a hidden sidecar file stored beside your content. Treat
them like assets when moving things around, and let the editor do the moving.

C# scripts are **not** tracked this way. They are compiled by the scripting host
rather than referenced as assets. See [Scripting](/manual/scripting/).

## The life of an asset

1. **Created** by a factory in the Content Browser, or **imported** from a source
   file. See [Importing](/manual/assets/importing/).
2. **Edited** in its asset editor, which marks it as having unsaved changes.
3. **Saved** to its `.lasset`. See [Managing Assets](/manual/assets/managing/).
4. **Referenced** by other assets, by components, and by scripts. See
   [Referencing Assets](/manual/assets/references/).
5. **Cooked** into a shipped build, following those references to decide what
   gets included. See [Cooking & Packaging](/manual/assets/packaging/).

## The asset registry

The editor keeps an index of every asset in your project, built by reading file
headers **without loading the assets themselves**. That index is what makes the
Content Browser instant on a large project, and it is what knows which assets
reference which.

You do not interact with the registry directly, but it is the reason the editor
can answer "what uses this?" before anything is loaded, which is what makes safe
deletes and reference replacement possible.

For the implementation, see [Assets](/internals/assets/) in Engine Internals.

## In this section

- **[Importing](/manual/assets/importing/)**, bringing in models, textures, and fonts.
- **[Managing Assets](/manual/assets/managing/)**, saving, renaming, deleting, and doing it safely.
- **[Textures](/manual/assets/textures/)**, color space and compression.
- **[Referencing Assets](/manual/assets/references/)**, pointing at assets from components and scripts.
- **[Cooking & Packaging](/manual/assets/packaging/)**, building a shipped game.
