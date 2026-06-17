---
title: Materials
description: How surfaces look, and why instances matter for performance.
---

A **material** defines how a surface looks, its color, how shiny or rough it is,
whether it glows, and more. You author materials in a visual node graph, no
shader code required.

## The three asset types

| Asset | What it is |
| --- | --- |
| **Material** | A node graph that **compiles to a shader**. The real thing a surface is drawn with. |
| **Material Instance** | A lightweight variant of a Material that only changes its **parameters** (colors, numbers, textures). |
| **Material Function** | A reusable group of nodes you can drop into many materials. |

## A material is a compiled shader

This one idea shapes everything else. When you author a Material, the engine
compiles its graph into a **shader**. At render time the engine groups objects by
material into **draw buckets**, one bucket per unique Material, and draws each
bucket together.

So **every unique Material costs a shader to compile and a bucket to draw.** Two
hundred distinct Materials means two hundred shaders and two hundred buckets, that
is the budget you manage.

:::tip[The golden rule]
Make a handful of **Materials**, then create a **Material Instance** for each
variation. An instance reuses its parent's shader and draws in the **same
bucket**, it only swaps parameter values, so it adds neither a shader nor a
bucket. See [Material Instances](/manual/materials/instances/).
:::

## Assigning a material

A mesh has one or more **material slots**, one per surface. Assign a material to a
slot in the mesh's editor, or override it per entity with the mesh component's
**Material Overrides** in the Details panel. A slot accepts either a Material or a
Material Instance.

## In this section

- **[The Material Graph](/manual/materials/graph/)**, authoring a material with nodes.
- **[Material Instances](/manual/materials/instances/)**, cheap variations of a material.
- **[Best Practices](/manual/materials/best-practices/)**, keeping materials fast.
