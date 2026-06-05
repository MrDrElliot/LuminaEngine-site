---
title: Content Browser
description: Browsing, creating, and importing your project's assets.
---

The Content Browser shows everything under your project's `Game/Content/`
folder, mounted as **`/Game`**. Toggle it with **Ctrl+Space**.

## Browsing

Folders on one side, assets on the other. Double-click an asset to open it in its
[editor](/manual/editor/asset-editors/), or double-click a folder to enter it.

## Creating assets

**Right-click** in the browser to create a new asset, a material, a physics
material, a data asset, an entity component type, and so on. It lands in the
current folder.

## Importing

Drop a source file into the browser (or onto the viewport) to import it: models
(`.gltf`, `.glb`, `.fbx`, `.obj`), textures (`.png`, `.jpg`, `.jpeg`, `.hdr`),
and fonts (`.ttf`, `.otf`). The file is converted into an engine asset and
appears right away. For import options and texture color space, see the
[Asset Pipeline](/manual/assets/).

## Using assets

- **Drag a mesh or prefab** into the viewport or outliner to spawn an entity from it.
- **Drag an asset onto a property** in the Details panel to assign it, for example a mesh onto a Static Mesh slot, or a material onto a material slot.
