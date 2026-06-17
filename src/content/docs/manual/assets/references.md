---
title: Referencing Assets
description: Pointing at assets from components and scripts.
---

Components and scripts point at assets so they can use them, a mesh component
points at a Static Mesh, a script spawns a prefab by path. There are two ways to
hold a reference.

## Hard vs soft references

- A **hard reference** loads its target right away, as soon as the owner loads.
  The asset fields on components (a mesh slot, a material slot) are hard
  references. Use them for content the owner always needs.
- A **soft reference** is just a path that resolves only when you ask for it. It
  does not force the asset to load. Use soft references for content you load on
  demand, a level you might travel to, an effect you spawn occasionally.

## In components

When a component has an asset field, the Details panel shows an **asset picker**.
Drag an asset onto it from the Content Browser, or click to choose one. The
picker only accepts assets of the right type, a mesh slot will not take a sound.

## In scripts

Reference and load assets from C# by content path.

```csharp
// Load now, typed.
CStaticMesh? Mesh = Asset.Load<CStaticMesh>("/Game/Content/Meshes/Crate");

// Load in the background; the callback runs on the game thread once.
Asset.LoadAsync<CStaticMesh>("/Game/Content/Meshes/Crate", Loaded =>
{
    // use Loaded here
});
```

For an editor-pickable, serializable reference, use a `FSoftObjectPath` or
`TSoftObjectPtr<T>` `[Property]` field and resolve it on demand, a path that
isn't loaded until you ask for it. See
[Scripting › Reference](/manual/scripting/reference/#asset-references).

## Renaming and moving

References survive renaming and moving assets. Scripts and UI files are tracked
by a stable id stored in a small `.lmeta` file beside them, so a reference keeps
working after you rename its target. For other assets, the asset registry keeps
the path-to-asset mapping current. You are free to reorganize your content
folders.
