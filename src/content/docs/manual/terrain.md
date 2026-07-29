---
title: Terrain
description: Heightmap terrain, sculpting, layer painting, and foliage.
---

Terrain is a heightmap-driven surface with painted material layers. You do not
add a Terrain component from the component list; you create terrain from the
world editor's **Terrain** edit mode, which sets up the component for you.

## Layout

Terrain layout properties define the grid, and changing them is a structural
change that rebuilds the surface.

| Property | Meaning |
| --- | --- |
| **Resolution** | Heightmap sample count per side. Must be a power of two plus one (513, 1025) so chunking divides cleanly. |
| **Chunk size** | The cull and draw dispatch unit. Smaller chunks cull more precisely and cost more draws. |
| **Scale** | World size of the terrain. |
| **Max height** | World displacement at a heightmap sample value of 1.0. |

The heightmap is stored row-major and normalized to the range 0 to 1, scaled by
max height on the GPU.

## Sculpting

The Terrain edit mode drives a brush. Its modes:

| Mode | Effect |
| --- | --- |
| **Sculpt** | Raises or lowers based on the stroke sign. Hold the modifier key to invert mid-stroke. |
| **Flatten** | Drives heights toward a locked reference height. |
| **Smooth** | Blurs heights within the brush footprint. |
| **Noise** | Adds fbm noise within the footprint. |
| **Ramp** | Drag a line; heights ramp linearly between the endpoints. |
| **Paint** | Applies weights for the active layer. |

Brush properties are radius (world units), strength (applied per second while the
stroke is held), and falloff (0 gives a hard disk, 1 a full cosine taper), plus
the flatten height and the active layer index for the modes that use them.

Strokes run as an async sculpt task. Edits are applied to the heightmap and
uploaded as **dirty rectangles**, so sculpting a small area does not re-upload the
whole terrain. Chunk and meshlet metadata are rebuilt before the next cull when
the edit changes the surface structurally.

## Layers and painting

Terrain surfaces are built from **layers**. Layer 0 is the base and always
covers the surface; additional layers are painted on top with per-sample weights.

Each layer has:

- A tiling value, applied to the layer's albedo and normal sampling in world
  space.
- An optional label shown in the paint tool.

Weights are stored per layer as an 8-bit row-major weight map. The paint brush
adds weight to the selected layer and normalizes the rest.

A terrain material can be assigned; leaving it empty uses the engine's default
terrain material at draw time.

## Shadows

Terrain has its own shadow casting and receiving properties, separate from mesh
components, because terrain participates in the depth pre-pass differently from
regular geometry.

## Foliage

The **Foliage** edit mode scatters instanced meshes across the terrain. Foliage
tracks the terrain's height revision, so sculpting after placement re-projects
the affected instances onto the new surface rather than leaving them floating.

## How it renders

Terrain does not go through the visibility buffer path that meshes use. It is
culled per chunk, rendered into a depth pre-pass, and then shaded forward with
early-Z so the heavy terrain pixel shader runs once per visible pixel.

Terrain chunk culling tests against the **previous** frame's depth pyramid.
Chunks are large, so the one-frame lag is a conservative trade rather than a
visible artifact.

For the pass-level detail see [Render Passes](/internals/render-passes/).

## Performance notes

- Resolution and chunk size are the two properties that matter. A high resolution
  with small chunks produces a large number of draws.
- Terrain materials are among the most expensive pixel shaders in a scene because
  they sample every active layer. Keep the layer count as low as the look allows.
- Painting and sculpting upload only the dirty rectangle, so brush work is cheap
  regardless of terrain size.
