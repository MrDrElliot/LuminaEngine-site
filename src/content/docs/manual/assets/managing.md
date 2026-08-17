---
title: Managing Assets
description: Saving, organizing, renaming, duplicating, and deleting content without breaking it.
---

Assets point at each other, so changing one can affect many. This page covers
the day to day operations and, for each one, what the engine does to keep
existing references intact.

All of these operations live in the
[Content Browser](/manual/editor/content-browser/).

## Saving

Editing an asset marks its package as having **unsaved changes**. Nothing is
written to disk until you save.

| Action | Shortcut |
| --- | --- |
| Save the asset in the focused editor | **Ctrl+S** |
| Save everything with unsaved changes | **Ctrl+Shift+S**, or **File > Save All** |

The title bar shows how many packages currently have unsaved changes. If you
close the editor with unsaved work, you get a prompt listing those packages so
you can choose what to keep.

:::caution
Several operations save assets for you as a side effect, because they have to
rewrite them. Replacing references and deleting a referenced asset both save
every asset that pointed at the target. If one of those had unsaved edits, those
edits are committed too. The dialog tells you when this is about to happen.
:::

## Organizing content

Your content lives under `Game/Content/`. Beyond that the layout is yours.

- **Group by what a thing is**, not by which level uses it. Content gets reused
  across levels far more often than you expect.
- **Keep a prefix convention.** The engine does not require one, but it makes a
  flat search list readable. Common choices are `SM_` static mesh, `SK_`
  skeletal mesh, `T_` texture, `M_` material, `MI_` material instance, `DT_`
  data table, `P_` particle system.
- **Do not fight the folder structure later.** Moving assets is safe, so
  reorganize whenever the current layout stops helping.

## Renaming and moving

Rename with **F2** or right-click **Rename**. Move by dragging onto a folder in
the tree.

Both are safe. Everything referencing the asset keeps working, because
references store the asset's id and not its path. See
[Identity](/manual/assets/#identity-assets-are-found-by-id-not-by-path).

You do not need to fix anything up afterward, and there is no redirector left
behind.

## Duplicating

Right-click, **Duplicate**. The copy lands beside the original as
`<Name>_Copy` with the name selected so you can type over it.

Duplicate copies the whole package, not just the asset's properties. A material
keeps its node graph, and references between objects inside the package are
rewritten to point at the copies. The result is self contained, so editing the
duplicate never affects the original.

The copy gets a **new id**, which is what makes it a genuinely separate asset.

:::danger
Do not duplicate an asset by copying its `.lasset` file in Explorer or Finder.
The copy keeps the original's id, and the editor treats an id as belonging to
exactly one asset. Whichever file the registry scans last wins, and the other
becomes invisible to the Content Browser while still sitting on disk. Always use
**Duplicate**.
:::

## Finding what uses an asset

Before you change or remove something, it is worth knowing what depends on it.

- Hovering an asset tile shows how many assets it references.
- Right-click, **Replace References...** opens a dialog listing every asset that
  points at the selected one, even assets that are not currently loaded.

Both are answered from the asset registry, so they are accurate for your whole
project and not just for what happens to be open.

## Replacing references

Right-click an asset, **Replace References...**. This retargets everything that
points at the asset onto a different one, without touching the asset itself.

It is the tool for swapping a placeholder for the real thing, consolidating two
near-identical materials, or pointing a hundred meshes at a new material without
opening any of them.

The dialog lists the referencing assets and gives you a picker. Choose a
replacement, or leave it as **Clear reference (null)** to blank the references
instead. Confirming rewrites and saves every referencing asset.

Replacements are limited to the original's own type or a subclass of it, so a
mesh slot can never end up holding a texture.

## Deleting

Select an asset and press **Delete**, or right-click **Delete**. Deletion is
immediate and cannot be undone.

**If nothing references the asset**, you get a plain confirmation and it is
removed.

**If something does reference it**, you get the same dialog as Replace
References, so a delete never silently breaks content. For each referenced asset
you choose one of:

- **A replacement.** Every reference is retargeted onto the asset you pick.
- **Clear reference (null).** Every reference is blanked, leaving an empty slot
  rather than a pointer to something that no longer exists.

The referencing assets are rewritten and saved first, and only then is the asset
deleted.

### What else happens on delete

- If it is a **prefab**, its placed instances are removed from every open level.
  Detached copies survive. See [Prefabs](/manual/prefabs/).
- The deleted asset does not appear in the unsaved-changes prompt afterward.

### What you cannot delete

| Blocked | Why |
| --- | --- |
| A **World** that is currently open | Close it first. |
| Anything while **playing or simulating** | Stop play first. |
| A **prefab with variants** | Its variants are defined by it. Delete or reparent them first. |
| **Protected** entries, such as core engine folders | These are not yours to remove. |

## Working outside the editor

Sometimes you need to touch content with other tools, for example version
control or a bulk file operation. What is safe:

| Operation | Safe? | Notes |
| --- | --- | --- |
| **Moving or renaming** a `.lasset` | Yes | The id lives inside the file, so references survive. The registry picks up the new path on its next scan. |
| **Copying** a `.lasset` | **No** | Produces two files with the same id. Use Duplicate instead. |
| **Deleting** a `.lasset` | Risky | Nothing fixes up the assets that referenced it, so they are left pointing at something that is gone. Delete through the editor. |
| **Editing** a `.lasset` | No | It is a binary package, not a text file. |

Moving a tracked text file (`.rml`, `.rcss`) outside the editor also moves its
hidden sidecar out of sync. Prefer moving those in the Content Browser.

## Safe practices

A short checklist that avoids nearly every content problem.

1. **Do content operations in the editor**, not in the file browser.
2. **Duplicate with Duplicate**, never by copying files.
3. **Rename and move freely.** These are safe by design.
4. **Read the delete dialog.** If it appeared at all, something depends on what
   you are removing.
5. **Prefer replacing over clearing** when you are removing an asset that is
   still in use. A null slot is a bug waiting to be found later, a replacement
   is not.
6. **Save before a bulk operation**, so that the automatic saves those
   operations perform only commit what you intended.
