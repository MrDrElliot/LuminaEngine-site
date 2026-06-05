---
title: The Material Graph
description: Authoring a material with nodes.
---

Open a Material to edit it in the **material graph**: a canvas of **nodes** you
wire together. Values flow left to right into the **Material Output** node, which
defines the final surface.

## The output node

Every material ends at the **Material Output**. For a standard (PBR) material,
connect what you need; anything left unconnected uses a sensible default.

| Input | Type | Controls |
| --- | --- | --- |
| **Base Color** | color | The surface color (albedo). |
| **Metallic** | scalar | 0 = non-metal, 1 = metal. |
| **Roughness** | scalar | 0 = mirror smooth, 1 = fully rough. |
| **Specular** | scalar | Reflectance for non-metals. Usually left at its default. |
| **Emissive** | color | Light the surface gives off. HDR, so it feeds bloom. |
| **Ambient Occlusion** | scalar | Darkens indirect light in crevices. |
| **Normal** | vector | A tangent-space normal map for surface detail. |
| **Opacity** | scalar | Transparency, used by the Masked and Translucent blend modes. |
| **World Position Offset** | vector | Moves vertices in the vertex stage, for wind or water. |

## Adding nodes

Right-click the canvas to add a node, or use the **quick-place** shortcuts: hold a
key and click the canvas.

| Key | Node |
| --- | --- |
| **1** to **4** | Constant Float / Float2 / Float3 / Float4 |
| **5** | Time |
| **6** | World Position |
| **7** | Texture Coordinates |
| **8** | Vertex Normal |
| **9** | Multiply |
| **0** | Add |

Drag from one node's output pin to another node's input pin to connect them.

## The node palette

The graph has a deep set of nodes, grouped by category:

| Category | What's in it |
| --- | --- |
| **Constants** | Fixed numbers and colors, plus built-ins like Pi. |
| **Inputs** | Per-pixel data: texture coordinates, world position, vertex normal, time, camera position. |
| **Textures** | Sample a texture, the most common node. |
| **Math** | Add, multiply, lerp, clamp, power, sin, and dozens more. |
| **Vector** | Build, split, mask, normalize, dot, cross. |
| **Color** | Desaturate, tint, contrast, gamma, HSV conversions. |
| **Shading** | Fresnel, depth fade, normal-from-height, blend normals. |
| **UV** | Rotate, tile, panner, flipbook, polar coordinates. |
| **Noise** | Perlin, Voronoi, value, gradient, checkerboard. |
| **Conditional** | Compare and branch on values. |
| **Scene** | Screen position, scene color and depth, for post-process materials. |
| **Function** | Call a Material Function, or define its inputs and outputs. |

## Parameters

A **parameter** is a value you can change later from a
[Material Instance](/manual/materials/instances/) without touching the graph.
Right-click a constant or texture node and choose **Make Parameter**, then give it
a name. That name is how instances refer to it.

Expose anything a designer might want to tweak, a color tint, a roughness value, a
detail texture, as a parameter.

## Material settings

Beyond the graph, a material has a few settings:

- **Type**: usually **PBR**, a lit surface. Other types target specific passes:
  **Post Process**, **Decal**, and **UI**.
- **Shading Model**: **Lit** (default) or **Unlit** (emissive only, ignores lighting).
- **Blend Mode**: **Opaque** (default), **Masked** (alpha-tested cutouts, with an
  **Opacity Mask Clip Value** threshold), **Translucent** (alpha blended), or
  **Additive**.
- **Two Sided**: render both faces, for foliage and thin surfaces.
- **Cast Shadows**: whether the surface casts shadows.

## Compiling

Press **Compile** in the toolbar to build the shader from the graph and save the
material. Compilation happens in the editor only; the shipped game loads the
compiled result.
