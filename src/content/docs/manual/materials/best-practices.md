---
title: Best Practices
description: Keeping materials fast and your scene cheap to draw.
---

Materials are one of the easiest places to spend or save performance. These
guidelines all follow from one fact: **a unique Material is a compiled shader and
a draw bucket.**

## Prefer instances over new materials

If two surfaces differ only in their values, a color, a roughness, a texture, make
them **[Material Instances](/manual/materials/instances/)** of one Material, not
two separate Materials.

- **Two Materials** = two shaders, two buckets.
- **One Material + two Instances** = one shader, one bucket, two parameter rows.

Design your Material with **parameters** for everything that varies, then express
the variations as instances.

## Keep the number of unique materials low

Every unique Material in a scene is another shader to compile and another bucket
to draw. A few well-parameterized Materials covering many instances will always
beat a pile of one-off Materials.

## Choose the cheapest blend mode

| Blend mode | Cost |
| --- | --- |
| **Opaque** | Cheapest. Writes depth and culls well. Use it whenever you can. |
| **Masked** | A little more than opaque (an alpha test). Good for foliage and fences. |
| **Translucent** | Most expensive. It overdraws and writes no depth. Use sparingly. |

Transparency is **order-independent**, so you never sort translucent objects
yourself, but it still overdraws. Reach for **Masked** before **Translucent**
when hard-edged transparency is all you need.

## Other tips

- **World Position Offset** compiles extra vertex shaders for the depth and shadow
  passes, so enable it only on materials that actually move.
- **Two Sided** draws every triangle twice, use it only where you need it.
- Turn off **Cast Shadows** on materials that never need them (decals, tiny props,
  emissive-only surfaces) to skip them in the shadow passes.
- Sample fewer textures where you can; each one is a fetch per pixel.
