---
title: Prefabs
description: Reusable entity hierarchies with per-instance overrides.
---

A **prefab** is a saved entity hierarchy, a root entity and its children with all
their components, stored as an asset. Place a prefab in a level and you get an
**instance**, a live copy that stays linked to the source. Edit the prefab once
and every instance picks up the change, while the edits you made to individual
instances are kept.

## Creating a prefab

In the world editor, build the hierarchy you want, then **right-click** it and
choose **Create Prefab from Entity...** (or **Create Prefab from Selected...**
from the viewport). Pick a name and location and the selection is saved as a
`.lasset` prefab.

Double-click the prefab in the [Content Browser](/manual/editor/content-browser/)
to open the **Prefab Editor**, a scene editor scoped to that one hierarchy.

## Placing instances

Drag a prefab from the Content Browser into the viewport or the outliner to spawn
an **instance**. Each instance is a full copy of the prefab's entities and
components, linked back to the source.

## Overrides and inheritance

An instance starts out identical to the prefab. The moment you change one of its
properties in the Details panel, that single property becomes an **override**. It
holds your value, and the engine stops syncing it from the prefab. Everything you
have not touched stays **inherited**.

This is what makes prefabs safe to keep editing after you have placed them.

- **Inherited properties follow the prefab.** Edit and save the prefab and the
  change flows into every instance, except where an instance has overridden that
  property.
- **Overrides are preserved.** Your per-instance edits survive prefab updates,
  world reloads, and re-saves.
- **Overrides are per property.** Changing one field of a component overrides only
  that field, including fields nested inside a struct. The rest keep inheriting.
  Arrays and optionals are treated as a single value, so overriding one element
  makes the whole list yours.

An overridden property shows the **modified** marker and a **reset arrow** in the
Details panel, the same as any value changed from its default.

### Reset to Prefab

Click the reset arrow (or right-click the property and choose **Reset to Default**)
on an overridden property to drop the override and restore the **prefab's** value,
not the original class default. For a prefab instance the chain of defaults runs
as follows.

**Class default, then Prefab value, then Instance override.**

Reset always steps one level back up that chain, to the prefab.

### Transforms are always per instance

An instance's transform, its position, rotation, and scale, along with the
transforms of its child entities, are **never** overwritten by prefab edits.
Placement is yours. Moving an instance, or nudging one of its children, will not be
undone when you save the prefab. Reset to Default still snaps a transform back to
the prefab's authored pose if you ask for it.

### Adding and removing components

You can diverge structurally as well.

- **Add a component** to an instance and it stays; a prefab update will not strip it.
- **Remove an inherited component** from an instance and it stays removed; a prefab
  update will not add it back.

The child *entity* structure of an instance follows the prefab. To add or remove
entities, edit the prefab, not the instance.

## Editing the source prefab

Open the prefab, change it, and **save**. Instances in any **open** level update
right away (the inherited parts only). Instances in levels that are currently
closed update the next time you open them. Overrides stay put either way.

## Detaching

Right-click an instance and choose **Detach from Prefab** to break the link. The
instance becomes plain entities. It keeps its current values but no longer inherits
from, or is affected by, the prefab. Detaching is one way.

## Deleting a prefab

Deleting a prefab asset removes its placed instances from every open level, the
same as deleting any other asset clears references to it. **Detached** copies are
no longer linked, so they survive. See [Deleting assets](/manual/assets/#deleting-assets).
