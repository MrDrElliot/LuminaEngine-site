---
title: Textures
description: Color space and compression for imported images.
---

When you import an image, the setting that matters most is its **color space**.
It tells the engine how to interpret and compress the pixels, and the wrong
choice gives washed-out color or broken normals. Set it on the Texture asset.

## Color space

| Color space | Use for | Stored as |
| --- | --- | --- |
| **sRGB** | Color maps, such as albedo, emissive, UI. The default. | BC7 (sRGB) |
| **Linear** | Non-color data, such as masks, single channels. | BC7 |
| **Normal Map** | Tangent-space normal maps. | BC5 (XY, with Z rebuilt in the shader) |
| **Packed Data** | Packed PBR maps, for example occlusion / roughness / metallic in one image. | BC7 |
| **Environment** | HDR panoramas for sky and image-based lighting. | RGBA16F, uncompressed |
| **Auto** | Chosen automatically from the filename. | (resolved on import) |

The rules that matter.

- **Color images are sRGB, everything else is Linear.** Tagging a mask or a
  roughness map as sRGB shifts its values; tagging albedo as Linear washes out
  the color.
- **Normal maps must be set to Normal Map.** They are stored in two channels and
  the shader rebuilds the third, so a normal map left on sRGB renders wrong.
- **HDR panoramas use Environment.** A `.hdr` is kept as uncompressed float so
  lighting reads true radiance, see [Rendering](/manual/rendering/).

Mip levels are always generated. Only the small ones stay resident by default,
see [Texture Streaming](/manual/assets/texture-streaming/).

## Auto detection

When color space is **Auto**, the engine guesses from the filename on import.

- `.hdr` files become **Environment**.
- `_n`, `_normal`, `_nrm` become **Normal Map**.
- `_orm`, `_arm`, `_mra`, and similar become **Packed Data**.
- `_rough`, `_metal`, `_ao`, `_height`, and similar become **Linear**.
- Anything else becomes **sRGB**.

## Changing color space later

The color space is baked in when the texture is compressed, so changing the
dropdown alone does not re-encode the image. Press **Recook** in the Texture
editor to re-read the source file with the new setting.

## Render targets

A **Render Target** is a separate texture type you draw into at runtime, for
mirrors, in-world screens, or paintable surfaces. It has editable **Width**,
**Height**, **Format** (RGBA8 or RGBA16F), and **Clear Color**.
