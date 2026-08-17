---
title: Prefab Variants
description: Prefabs that inherit from another prefab and store only what they change.
---

A **variant** is a prefab whose contents come from another prefab, the **parent**,
plus the changes you make on top. It is the same relationship an
[instance](/manual/prefabs/#overrides-and-inheritance) has with its prefab, moved
up one level so it holds between two assets.

A variant stores no copy of the parent. It stores a link plus a delta, so the
parent stays the single source of truth. Edit the parent and every variant picks
up the change, except where the variant diverges.

Use a variant when several prefabs are the same thing with differences: an enemy
and its elite version, a crate and a reinforced crate, a door and a locked door.

## Creating a variant

Right-click a prefab in the [Content Browser](/manual/editor/content-browser/) and
choose **Create Variant**. A new prefab named `<Name>_Variant` is created next to
the parent, ready to rename.

The new asset is not a duplicate. It starts out empty apart from the parent link,
and everything you see when you open it is resolved from the parent.

## Editing a variant

Double-click a variant to open it in the **Prefab Editor**, the same editor a
plain prefab uses. A variant is marked with a branch icon in the title bar, and
the outliner shows a read-only **Parent Prefab** slot at the top.

Inside a variant you can do everything you can do in a prefab.

- **Change property values** on any inherited component.
- **Add or remove components** on any inherited entity.
- **Add new entities**, including children of inherited ones.
- **Remove inherited entities.** Children that you keep are re-parented rather
  than deleted with them.
- **Reparent entities**, inherited or new.

Anything you do not touch keeps following the parent. This is wider than what an
instance can do: an instance follows the prefab's entity structure, while a
variant is free to change it.

## What is saved

Saving a variant compares it against the freshly resolved parent and writes only
the differences: the changed properties, the added and removed components, the
added and removed entities, and the re-parented nodes. Nothing that matched is
written.

That has a useful consequence. **To drop an override, set the value back to the
parent's value and save.** The comparison no longer sees a difference, so the
property goes back to following the parent.

## Transforms

Unlike an instance, a variant treats transforms as ordinary properties. Move a
node in a variant and that becomes an override on that node, so later transform
edits in the parent will not reach it. Instance transforms are still always per
instance, on a variant instance as on any other.

## Editing the parent

Save a parent prefab and every loaded variant re-resolves against the new data,
then pushes the result onto its own live instances, down the whole chain.
Instances in open levels update right away. A variant that is not loaded resolves
the next time it is loaded.

If a variant is open in an editor window when its parent is saved, that window
reloads its preview so it is not left showing pre-edit data.

## Nesting

A variant can itself be the parent of another variant, to any depth. Resolving
walks up to the root prefab first, so a change at the top reaches the whole tree.

Cycles are refused. A prefab cannot be parented onto itself or onto one of its own
descendants, and a variant caught in a cycle is left unresolved with an error in
the log.

## Instancing a variant

Place a variant in a level exactly like any other prefab. It presents a complete
hierarchy, so instances, per-instance overrides, and **Detach from Prefab** all
behave the same way.

The chain of defaults gains one step for each variant in the chain.

**Class default, then parent prefab, then variant, then instance override.**

## Deleting

Deleting a prefab that has loaded variants is **refused**, with a notification
naming them. A variant is defined by its parent, so a cascade would silently empty
every descendant. Delete or re-parent the variants first.

A variant whose parent cannot be loaded resolves to nothing, because there is no
baked copy to fall back on.

## Limitations

- There are no per-property override markers or a revert-to-parent action inside a
  variant. Editing a variant works, but seeing what you overrode means comparing
  against the parent by eye. Setting a value back by hand is the way to revert.
- The parent link is read-only in the editor. To re-parent a variant, create a new
  one under the parent you want.
