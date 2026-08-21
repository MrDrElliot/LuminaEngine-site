---
title: Rendering
description: Materials, lights, environment, and post-processing.
---

You do not write rendering code. You drive the renderer with **materials**,
**lights**, an **environment**, and **post-process** settings, all authored as
assets and components. Every property below appears in the Details panel, so
this page is a map of what controls what, not an exhaustive list.

Under the hood it is a bindless Vulkan renderer with a Slang shader pipeline and
GPU-driven culling: opaque meshes go through a visibility buffer and are shaded
in a deferred material pass, terrain renders forward with a depth pre-pass, and
lights are assigned to clusters. You never touch that directly. If you do need to
run your own GPU work, a custom compute pass or a procedural texture, the
renderer's Vulkan abstraction is exposed to C# scripts. See
[Low-Level Rendering (RHI)](/manual/scripting/rhi/).

If you are working on the renderer itself rather than driving it, see
[Render Passes](/internals/render-passes/) and [RHI](/internals/rhi/).

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
fills your scene. Pick a sky mode.

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

What you can grade and add.

- **Tone mapping** (ACES, AGX, and variants) and **exposure**, with optional
  auto-exposure.
- **Color grading**, with white balance, contrast, saturation, and shadow / midtone /
  highlight tint.
- **Bloom**, **vignette**, **film grain**, and **chromatic aberration**.

Atmosphere is its own component. **Exponential Height Fog** adds distance and
height fog, and drives volumetric light shafts (god rays). **Decal** components
project materials onto surfaces, for things like bullet holes and signage.

## Quality settings

Per-world render settings live in **World Settings**.

- **Anti-aliasing**, either **SMAA** (a sharp post-process method) or **MSAA**. There
  is no TAA, so the image stays crisp without temporal blur.
- **Variable Rate Shading** trades shading precision for performance on
  supported GPUs. It is off by default.

## Present mode

A finished frame does not go straight to the screen. Your monitor redraws itself
at a fixed rate, 60 or 144 or 240 times a second, while the GPU finishes frames
on its own schedule. **Present mode** decides what happens to a frame that is
ready while the monitor is halfway through drawing the previous one.

It lives in **Project Settings, Rendering, Display**, stored in
`Config/RendererSettings.json`, and takes effect as soon as you change it.

| Mode | What it does | What it costs |
| --- | --- | --- |
| **FIFO** (default) | Queues the frame and waits for the next refresh. This is what most games call V-Sync on. | No tearing. Frame rate capped to the refresh rate, plus a frame of input lag. |
| **Mailbox** | Keeps rendering, and the newest finished frame replaces whichever one was waiting. | No tearing, less input lag than FIFO. The GPU runs flat out for frames that may never be shown, so more heat, fan noise, and power. |
| **Immediate** | Hands the frame to the display the moment it is ready, mid refresh. This is V-Sync off. | Lowest input lag. **Tearing**: a horizontal seam where the top of the screen is showing one frame and the bottom is showing the next. |

Which one to use.

- **Editor work, and most shipped games**: FIFO. Nothing tears, and the GPU
  idles instead of drawing frames nobody will see.
- **Input lag matters** (an action game where the mouse has to feel immediate):
  Mailbox, since it buys you latency without introducing tearing. Immediate only
  if you can live with the seam.
- **Profiling**: Immediate or Mailbox. FIFO pins the frame rate to the refresh
  rate, which hides the difference between a frame that took 6 ms and one that
  took 16 ms.

One FIFO behavior worth knowing: because a late frame has to wait for the *next*
refresh, missing the deadline steps the rate down rather than shaving it. On a
60 Hz display a scene that cannot quite hold 60 fps plays at 30, not 55. Mailbox
and Immediate do not do this, which is often why a scene feels smoother in them
even though it is doing the same work.

Present mode is not a frame rate limiter. `Core.MaxFPS` still caps how many
frames the engine produces, in every mode.

Not every GPU and driver offers every mode. If the one you pick is unavailable
the engine falls back to the other uncapped mode, and finally to FIFO, which is
always supported. So asking for Mailbox on a driver that lacks it gets you
Immediate, and tearing along with it.
