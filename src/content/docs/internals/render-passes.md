---
title: Render Passes
description: A pass-by-pass walk of the default scene renderer.
---

`FDefaultSceneRenderer`
(`World/Scene/RenderScene/Default/DefaultSceneRenderer.cpp`) is the engine's
default `IRenderScene`. Opaque meshes go through a **visibility buffer**, are
classified per material into pixel runs, and are shaded by **indirect compute
dispatches** into a GBuffer that a single lighting pass consumes. Terrain renders
forward with an early-Z pre-pass, translucency is moment-based OIT, and light
assignment is clustered.

The whole thing is recorded by hand in `RenderView`. There is no render graph, so
the order below **is** the dependency description.

Pass names in the tables are the `SCENE_GPU_SCOPE` labels, which is what a Tracy
GPU zone, a RenderDoc capture, and a crash dump all show.

## Named images

Render targets are addressed through `ENamedImage`, indexed per view:

`HDR`, `LDR`, `PostProcessScratch`, `SMAAEdges`, `SMAABlend`, `SMAAArea`,
`SMAASearch`, `GTAO`, `GTAODenoise`, `GTAOBlur`, `ShadowMask`, `Cascade`,
`CascadePyramid`, `DepthAttachment`, `DepthPyramid`, `Picker`, `VisBuffer`,
`GBufferA` through `GBufferD`, `Accum`, `MomentZeroth`, `Moments`,
`WaterRefraction`, `DBufferA` / `DBufferB` / `DBufferC`, `AdaptedLuminance`,
`FroxelScatter`, `FroxelIntegrated`, `AerialInScatter`, `AerialTransmittance`,
`CloudNoise`, `CloudScatter`, `BRDFLut`, `SkyCube`, `SkyIrradiance`,
`SkyPrefilter`, `ProbeCaptureCube`, `ProbePrefiltered`, plus editor billboard
icons.

Each `FSceneView` owns its own set, which is what lets scene capture views render
the same world from another camera.

## Frame setup

`RenderView(FrameIndex)` starts by:

1. Taking the frame slot, and returning immediately if the slot was never
   extracted.
2. Pointing at the primary view and publishing the depth pyramid and cascade
   pyramid dimensions and heap slots into the frame's cull constants.
3. Copying frame stats out for the editor, and marking this frame's pyramid
   usable by the next frame.
4. Opening a command list, binding the global texture heap, and setting
   `EFrontFace::CW` (the projection bakes the Vulkan Y flip, so CCW-wound
   geometry lands clockwise in framebuffer space).

Everything then records under two markers, `RenderView Geometry` and
`RenderView Shading`, and the frame ends with one `RHI::Core::Submit`.

## Pass order

### Geometry and visibility

| Pass | What it does |
| --- | --- |
| `RmlUi Widgets` | Rasterizes world-space UI documents into their own render targets before anything samples them. |
| `Reset Pass` | Clears per-frame counters and indirect arguments. |
| `Compile Draw Commands` | Buffer resizes and uploads for what extract compiled, then `GPU Scene Cull`: retained instance upload, instance cull, meshlet block build, draw prefix, and the **early** meshlet cull. |
| `Sky Cube Capture` | Captures the sky into a cubemap, early so the IBL chain below stays in lockstep with the background that gets drawn. |
| `Texture Paint` | Applies queued render-target painting (terrain and texture painting tools). |
| `Terrain Update` | Terrain chunk streaming and meshlet updates. |
| `Terrain Cull` | Terrain chunk culling against last frame's end pyramid. Chunks are large, so the one-frame lag is a conservative trade. |
| `Skinning` | Compute skinning for skeletal meshes into pre-skinned vertex buffers. |
| `VisBuffer Early` | Rasterizes the replay set (see below) into triangle IDs plus depth, clearing both. |
| `Terrain Depth` | Terrain depth plus a VisBuffer "empty" stamp. Runs **before** the mid pyramid so terrain occludes the late test, GTAO and decals see full opaque depth, and shading skips mesh pixels terrain covers. |
| `Depth Pyramid (Mid)` | Rebuilds the pyramid from this frame's partial depth (replayed meshes plus terrain), single-pass downsample. |
| `Meshlet Cull` (late slice) | Tests every instance against the rebuilt pyramid and emits what the early phase did not draw. |
| `VisBuffer Late` | Rasterizes those, loading and accumulating into the same VisBuffer and depth without clearing. |
| `Depth Pyramid (End)` | Pyramid over the full mesh depth. |
| `Cluster Build` | Builds the view's froxel cluster grid. Rebuilt when the projection, near/far, or screen size changes. |
| `Light Cull` | Assigns lights to clusters. |
| `Point Shadows` / `Spot Shadows` | Cube and spot shadow maps into the shadow atlas. |
| `Cascaded Shadows` | Cascaded shadow maps for the directional light. |

Every `Depth Pyramid` build is skipped when `bFreezeCulling` is set, which is what
lets a frozen-culling debug view keep drawing the set it froze with.

#### Two-phase occlusion

The scheme is the classic one, driven by a **persistent instance visibility
set**, not by deferring meshlets within a frame:

- **Early** replays the instances that were visible last frame, with no Hi-Z
  test, purely to lay down depth.
- The **mid pyramid** is built from that depth plus terrain.
- **Late** tests every instance against that pyramid and draws whatever Early did
  not, so a disocclusion resolves in the same frame it happens.

The visibility buffer is double buffered and the write index flips each frame, so
last frame's set stays readable for the whole frame while this frame's
accumulates. A view without `ECullViewFlags::MeshletHiZ` is single-phase and
drawn entirely by Early.

### Environment, occlusion, and shading

| Pass | What it does |
| --- | --- |
| `Cascade Pyramid` | Hi-Z over the cascade atlas, for culling into the shadow views. |
| `Sky Irradiance` | Convolves the diffuse irradiance cube from the sky capture. |
| `Sky Prefilter` | Convolves the GGX specular prefilter chain. |
| `Decals` | DBuffer decals projected onto the full opaque depth. |
| `GTAO` plus its blur | Ground-truth ambient occlusion from full opaque depth. |
| `Shadow Mask` | Screen-space shadow mask, so shading samples one texture instead of every cascade. |
| `Environment` | Draws the sky or background into HDR. |
| `VisBuffer Classify` | Counts pixels per material, prefix-sums the counts, scatters each pixel into its material's run, and writes the indirect arguments. |
| `Material GBuffer` | One indirect compute dispatch per material over its own pixel run, writing the GBuffer. |
| `Deferred Lighting` | One indirect dispatch over every classified pixel, writing lit HDR. |
| `Picker Resolve` (editor) | Resolves entity IDs out of the VisBuffer into the picker target. |
| `Scene Debug View` (non-Shipping) | Debug visualization modes. |
| `Terrain Render` | Forward terrain shading, early-Z against the pre-pass depth so the heavy terrain pixel shader runs once per visible pixel. |
| `Depth Pyramid (End)` | Final pyramid, now including terrain, consumed by next frame's early phase and terrain cull. |

IBL cube reconciliation at a new resolution happens in `PrepareRender`, not here,
because it issues `WaitDeviceIdle`.

#### The classified deferred chain

This is the most unusual part of the renderer, and the reason the VisBuffer
exists. It is six steps, three of which are passes:

1. The VisBuffer holds a triangle and instance ID per pixel. Nothing is shaded
   yet.
2. **Count.** A compute pass tallies how many pixels each material owns.
3. **Prefix sum.** Those counts become start offsets into one flat pixel list.
4. **Scatter.** Every classified pixel writes its position into its material's
   run, and the pass emits the indirect argument triples. The CPU never learns
   the counts.
5. **Material GBuffer.** One indirect dispatch per material, over exactly the
   pixels it owns, running that material's graph and writing the GBuffer.
   Compute rather than a rasterized quad on purpose: a pixel shader launches in
   2x2 quads, so a one-pixel triangle would run the graph four times.
6. **Deferred Lighting.** One dispatch lights every classified pixel exactly
   once from the GBuffer.

CPU-side, `BuildDeferredMaterialBinning` assigns each distinct **master deferred
shader** a dense slot, and every material instance sharing that shader maps to
the same slot. The cost is therefore `O(distinct visible master shaders)`
dispatches, not one per instance and not a fullscreen pass per material.

Two things that will bite:

- Background, terrain, and any material without a deferred shader are **never
  classified**, so they keep whatever the environment pass wrote. That is the
  intent, not a gap.
- The pixel list packs coordinates in 16 bits, so a render extent beyond that
  disables deferred shading for the view, with a warning. Past
  `GMaterialMaxSlots` distinct deferred shaders, the excess does not shade.

Texture sampling in the material lane uses analytic UV gradients
(`SampleTexture2DGrad`), because a deferred lane has no automatic derivatives and
naive sampling produces mip seams across triangle, meshlet, and instance
boundaries.

### Water, translucency, and atmosphere

| Pass | What it does |
| --- | --- |
| `Screen Space Reflections` | Traces against the depth buffer, falling back to the prefiltered cube off screen. |
| `Water` | After the opaque scene, so HDR holds the lit scene to refract, and before translucency. |
| `Moment Generation` | Builds the moment-based OIT moments for this frame's translucency. |
| `Transparent` | Translucent accumulation against those moments. |
| `OIT Resolve` | Resolves the accumulation into HDR. |
| `Additive Translucent` | Additive blended translucency. |
| `Aerial Perspective` | Applies the atmosphere LUT to the scene. Sky pixels are skipped; the sky already has it baked in. |
| `Volumetric Clouds` | Cloud raymarch and composite. |
| `Froxel Fog Inject` / `Integrate` / `Apply` | Volumetric fog: inject scattering into the froxel volume, integrate along view rays, apply to the scene. |

### Debug, particles, and world overlays

| Pass | What it does |
| --- | --- |
| `Batched Solid Tris` / `Batched Lines` | Debug primitive batches from `IPrimitiveDrawInterface`. |
| `Particles Simulate` / `Particles Render` | GPU particle simulation and rendering. |
| `Billboards` | Editor icons and billboards, pre-tone-map, writing both HDR and the picker buffer. |
| `Text` | World-space MSDF text, same MRT arrangement as billboards. |
| `Widget Picker` (editor) | World-space widgets stamp their entity ID into the picker buffer so they stay click-selectable; their color is drawn later, post-tone-map. |
| `Picker Readback` (editor) | Issued after the last picker write; the readback is consumed lazily by `GetEntityAtPixel`. |

### Post-processing

| Pass | What it does |
| --- | --- |
| `Underwater` | Absorption and distortion over the composited HDR, computed per-ray path length so a half-submerged waterline falls out naturally and above-water pixels are untouched. |
| `Bloom` | Downsample and upsample chain. |
| `Auto Exposure` | Histogram adaptation into `AdaptedLuminance`. |
| `Tone Mapping` | HDR to LDR, including color grading. |
| `Post Process Materials` | User post-process materials, in the order the world resolved them from the camera and post-process volumes. |
| `SMAA` | Edge detection, blend weights, neighborhood blend. Only when `SMAAQuality != Off`. |
| `Selection Outline` (editor) | Edge-detects the picker target, so billboards, widgets and world text outline as well as meshes. |
| `Widgets` | World-space widget color, post-tone-map. |
| `Debug Text` (non-Shipping) | On-screen debug text. |

### Capture views and composite

Every enabled capture view then re-renders a reduced pass list
(`RenderCaptureView`): the gather is shared, the shading is per view. Capture
views are **frustum only**, a single phase with no late re-test.

`ReflectionProbeBakePass` runs after them, then `RmlUi::RenderWorldUI` composites
screen-space world UI onto the primary output, and a `Barriers::RasterToRead`
makes the final writes visible to the ImGui submit that samples them in the
editor viewport.

## Draw command compilation

Two halves, run before the passes:

- `CompileDrawCommands_GameThread` does the ECS reads and the parallel `Process*`
  tasks, plus cull and shadow setup.
- `CompileDrawCommands_Render` resizes buffers, records the uploads, and
  dispatches the GPU scene cull.

`ResolveDirtyMeshComponents` is a serial pre-pass so the parallel gather stays
pure reads, and it is skipped entirely when nothing changed.

Mesh resolution goes through `FMeshResolveCache`, an interned table keyed on
`(mesh, materials)` plus a hot header on the component. The cache is shared
across every world, but each world resolves only its own components, so each
scene tracks the last pending generation it resolved against. A `MaterialIndex`
of -1 must stay `SIZE_MAX` through that path; collapsing it to 0 silently binds
the wrong material.

## Profiling a pass

Every pass is wrapped in `SCENE_GPU_SCOPE(CL, "Name")`, which emits both a Tracy
GPU zone and an RHI debug marker. That means:

- Tracy's GPU timeline names each pass.
- A GPU crash dump or a RenderDoc capture shows the same names.
- **Every `Begin` needs its `End` on every path.** An early return between them
  corrupts the marker stack for the rest of the frame.

## Adding a pass

1. Declare the method in `DefaultSceneRenderer.h` in the pass block.
2. Add any new render target to `ENamedImage` and its allocation.
3. Insert the call into `RenderView` at the correct point, wrapped in a
   `SCENE_GPU_SCOPE`.
4. Add the barrier that orders it against the passes it reads from. There is no
   automatic dependency tracking.
5. If it writes depth, use reverse-Z (`EOp::Greater` / `GreaterEqual`, clear to
   0.0).
6. If it needs per-slot buffers, size them by `RHI::kFramesInFlight` and index
   with `CurrentFrameSlot`, like the rings around it.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| A pass reads stale data | Missing barrier. The renderer relies entirely on explicit `RHI::Barriers` calls. |
| Geometry pops one frame late | The late phase was skipped, or a new view was added without `ECullViewFlags::MeshletHiZ` handling. |
| A material renders unlit | It has no deferred shader, so its pixels were never classified. |
| Deferred shading silently stops at high resolution | The render extent exceeded the 16-bit pixel-list packing. Check the log for the warning. |
| Mip seams in deferred shading | Sampling without analytic gradients in the material lane. |
| Z-fighting in a new pass | Standard depth comparison instead of reverse-Z. |
| Wrong material on an instance | A `MaterialIndex` of -1 collapsed to 0 instead of staying `SIZE_MAX`. |
| Corrupted GPU marker names | An unbalanced `SCENE_GPU_SCOPE` on an early-return path. |
