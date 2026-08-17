---
title: Referencing Assets
description: Hard and soft references, asset pickers, and loading assets from script.
---

Components, assets, and scripts point at assets so they can use them. A mesh
component points at a Static Mesh, a material points at its textures, a script
spawns a prefab. How you hold that pointer decides when the target loads.

## Hard vs soft references

| | Hard reference | Soft reference |
| --- | --- | --- |
| Stores | The asset itself | A path to the asset |
| When the target loads | With its owner, always | Only when you ask |
| Cost of an unused one | The asset is loaded anyway | Nothing |
| Use for | Content the owner always needs | Content you load on demand |

A **hard reference** pulls its target in as soon as the owner loads, and
transitively: loading a level loads its prefabs, which load their meshes, which
load their materials and textures. The asset fields on components are hard
references.

A **soft reference** is just a path. It does not force a load, so it is what you
want for the level you might travel to, the boss you might spawn, or the effect
that plays once an hour.

The distinction also decides what ships. The cooker follows both, but only hard
references force the target into the same chunk as its referrer. See
[Cooking & Packaging](/manual/assets/packaging/).

:::tip
If a level takes a long time to load, hard references are usually why. Something
small at the top of the graph is dragging in content that is rarely used. Making
that one reference soft can cut a large branch off the load.
:::

## In the editor

When a component or asset has an asset field, the Details panel shows an **asset
picker**. Drag an asset onto it from the Content Browser, or click it to search.

The picker only offers assets of the right type, so a mesh slot will not accept
a sound. The button beside it takes the current Content Browser selection, which
is quicker than searching when the slot is empty.

## In scripts

Load by content path. Paths are the same ones the Content Browser shows, without
the `.lasset` extension.

```csharp
// Blocking load, typed. Null if the path does not resolve.
CStaticMesh? Mesh = Asset.Load<CStaticMesh>("/Game/Content/Meshes/Crate");

// Background load. The callback runs on the game thread, exactly once.
Asset.LoadAsync<CStaticMesh>("/Game/Content/Meshes/Crate", Loaded =>
{
    // use Loaded here
});

// Registry probe. Does not load anything.
if (Asset.Exists("/Game/Content/Meshes/Crate")) { }
```

:::caution
A loaded asset stays alive because something references it. Assign it to a
component property or another field that the engine tracks:

```csharp
Mesh.StaticMesh = Asset.Load<CStaticMesh>(Path);
```

An asset you load and then drop on the floor has nothing keeping it alive.
:::

For a reference you want to author in the editor and resolve later, declare a
`FSoftObjectPath` or `TSoftObjectPtr<T>` `[Property]` field. It shows the same
picker, serializes with your component, and does not load until you ask. See
[Scripting > Reference](/manual/scripting/reference/#asset-references).

## References survive renaming

References store an asset's id, not its path, so renaming or moving a target
does not break anything pointing at it. There is nothing to fix up afterward.
See [Managing Assets](/manual/assets/managing/#renaming-and-moving).

Tracked text files (`.rml`, `.rcss`) get the same guarantee through a hidden
sidecar that carries their id.

## Changing what a reference points at

To retarget every reference to an asset at once, right-click it in the Content
Browser and choose **Replace References...**. This is also what the editor
offers when you delete an asset that is still in use, so a delete cannot
silently leave a broken slot behind.

See [Replacing references](/manual/assets/managing/#replacing-references).

## Empty and broken references

An asset slot that shows `<None>` is simply empty, which is legal. Systems skip
what they cannot resolve: a mesh component with no mesh draws nothing rather
than erroring.

A slot goes empty on its own only if its target was removed outside the editor,
or if you chose **Clear reference** when deleting the target. If you find
unexpected empty slots, that is usually the cause.
