---
title: Material Instances
description: Cheap variations of a material.
---

A **Material Instance** is a variation of a Material that changes only its
**parameters**, the values you exposed in the graph. It is the cheapest way to
make variants, and what you should reach for most of the time.

## Why instances are cheap

An instance does **not** compile its own shader. It points at a parent Material
and reuses that material's compiled shader exactly. At render time, the engine
groups draws by the **base material**, so an instance draws in the **same bucket**
as its parent and every sibling instance. All it carries of its own is a single
row of parameter values.

So a red, a green, and a blue instance of one "Painted Metal" material are
**one shader, one bucket, three parameter rows**, not three materials.

## Creating an instance

1. In the Content Browser, right-click a Material and create an instance from it. The instance is bound to that Material as its parent.
2. Open the instance. It lists every parameter the parent exposes.
3. Tick a parameter to override it, then set your value. Parameters you leave unticked fall through to the parent's value.

Assign the instance to a mesh slot or a Material Override exactly like a material,
both accept a Material or a Material Instance.

## When to use a Material instead

Make a new **Material** only when a variation needs something the parent's graph
cannot express through parameters, a different set of connected nodes, a different
blend mode, or a different shading model. Everything else should be an instance.
See [Best Practices](/manual/materials/best-practices/).
