---
title: Rendering
description: Materials, lights, environment, and post-processing.
---

You do not write rendering code. You drive the renderer with **materials**,
**lights**, an **environment**, and **post-process** settings, all authored as
assets and components. Every property below appears in the Details panel, so
this page is a map of what controls what, not an exhaustive list.

Under the hood it is a clustered forward Vulkan renderer with a Slang shader
pipeline, bindless resources, and GPU-driven culling. You never touch that
directly.

## Materials

A **material** decides how a surface looks. You author it in the **Material
editor** as a node graph that compiles to a shader, so you connect nodes rather
than write shader code.

- A **Material** is the graph and its compiled shader.
- A **Material Instance** overrides a base material's parameters (colors,
  numbers, textures) without recompiling. Use instances for variants.

Materials are physically based. The main outputs you connect are **Base Color**,
**Metallic**, **Roughness**, **Normal**, **Emissive**, **Ambient Occlusion**,
and **Opacity**. A material also has a **type** (lit surface, unlit,
post-process, decal, UI) and a **blend mode** (opaque, masked, translucent,
additive).

Assign a material through the mesh asset's slots, or override it per entity with
the mesh component's **Material Overrides**. See **[Materials](/manual/materials/)**
for the graph, instances, and performance best practices.

## Lights

| Light | Use for |
| --- | --- |
| **Directional** | The sun or moon. One main light for the whole scene, with cascaded shadows. |
| **Point** | An omnidirectional local light, like a bulb. |
| **Spot** | A cone, like a flashlight, with inner and outer angles. |

Lights are placed as components and oriented by the entity's transform. Common
properties are color, **intensity** (in lux), and attenuation. Directional and
spot lights can also be tinted by **color temperature** in Kelvin, and any light
can be made **volumetric** to scatter through fog.

## Shadows

Shadows come from the lights that cast them. The **directional light** drives
**cascaded shadow maps**, which keep nearby shadows crisp and distant shadows
cheap. You tune the shadowed distance, softness, and bias on the light itself.
Per mesh, the mesh component's **Cast Shadow** and **Receive Shadow** flags
control whether it participates.

## Environment and sky

The **Environment** component sets the sky and the image-based lighting that
fills your scene. Pick a sky mode:

- **Solid Color**, a flat background.
- **Gradient**, a sky gradient with a sun disc.
- **Dynamic**, a full atmosphere with time-of-day sun, stars, and a moon.
- **HDRI**, an imported panorama that also lights the scene.

The **Sky Light** component adds ambient fill so shadowed areas are not pure
black. With an HDRI or Dynamic sky, lighting and reflections are baked
automatically; the **IBL Quality** tier trades reflection sharpness against
memory.

## Post-processing

Post-process settings live on the **Camera** component and on **Post Process**
volumes, which blend their settings in when the camera enters them. Higher
priority volumes win, so you can set a base look and override it per area.

What you can grade and add:

- **Tone mapping** (ACES, AGX, and variants) and **exposure**, with optional
  auto-exposure.
- **Color grading**: white balance, contrast, saturation, and shadow / midtone /
  highlight tint.
- **Bloom**, **vignette**, **film grain**, and **chromatic aberration**.

Atmosphere is its own component: **Exponential Height Fog** adds distance and
height fog, and drives volumetric light shafts (god rays). **Decal** components
project materials onto surfaces, for things like bullet holes and signage.

## Quality settings

Per-world render settings live in **World Settings**:

- **Anti-aliasing**: **SMAA** (a sharp post-process method) or **MSAA**. There
  is no TAA, so the image stays crisp without temporal blur.
- **Variable Rate Shading** trades shading precision for performance on
  supported GPUs. It is off by default.
