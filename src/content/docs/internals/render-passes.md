---
title: Render Passes
description: A pass-by-pass walk of the default scene renderer.
---

`FForwardRenderScene`
(`World/Scene/RenderScene/Forward/ForwardRenderScene.cpp`) is the engine's
default `IRenderScene`. Despite the name it is not a classic forward renderer.
Opaque meshes go through a **visibility buffer** and are shaded in a
**tile-binned deferred material pass**; terrain renders forward with an early-Z
pre-pass; translucency is forward with weighted-blended OIT; and light
assignment is **clustered**.

The whole thing is recorded by hand in `RenderView`. There is no render graph, so
the order below **is** the dependency description.

## Named images

Render targets are addressed through `ENamedImage`, indexed per view:

`HDR`, `LDR`, `PostProcessScratch`, `SMAAEdges`, `SMAABlend`, `SMAAArea`,
`SMAASearch`, `SSAO`, `SSAODenoise`, `SSAOBlur`, `Cascade`, `DepthAttachment`,
`DepthPyramid`, `Picker`, `VisBuffer`, `Accum`, `Revealage`, `WaterRefraction`,
`DBufferA` / `DBufferB` / `DBufferC`, `AdaptedLuminance`, `FroxelScatter`,
`FroxelIntegrated`, `HDR_MS`, `Depth_MS`, `Picker_MS`, `BRDFLut`, `SkyCube`,
`SkyIrradiance`, `SkyPrefilter`, plus editor billboard icons.

Each `FSceneView` owns its own set, which is what lets scene capture views render
the same world from another camera.

## Frame setup

`RenderView(FrameIndex)` starts by:

1. Selecting the frame slot and releasing that slot's deferred buffer frees and
   image releases. Safe because `RHI::Core::BeginFrame` already waited the frame
   timeline for this slot.
2. `SyncMSAAState()`, then bailing out if the slot was never extracted.
3. Publishing the depth pyramid dimensions and heap slot into the frame's cull
   constants, and copying frame stats out for the editor.
4. Opening a command list, binding the global texture heap, and setting
   `EFrontFace::CW` (the projection bakes the Vulkan Y flip, so CCW-wound
   geometry lands clockwise in framebuffer space).
5. An `AllCommands -> AllCommands` barrier, ordering last frame's reads of these
   targets (the editor viewport sampling the output) before this frame's writes.

## Pass order

### Geometry and visibility

| Pass | What it does |
| --- | --- |
| RmlUi world widgets | Rasterizes world-space UI documents into their own render targets before anything samples them. |
| `ResetPass_RenderThread` | Clears per-frame counters and indirect args. |
| `CompileDrawCommands_RenderThread` | Buffer resizes and uploads for the draw commands the game thread compiled. |
| `TexturePaintPass` | Applies queued render-target painting (terrain and texture painting tools). |
| `CullPassEarly` | Frustum and cone culling for every view, plus Hi-Z occlusion for the camera against **last frame's** depth pyramid. Meshlets the stale pyramid hides are **deferred, not dropped**. Writes the mesh-task `GroupCountX` straight into `{0,1,1}`-seeded indirect args. |
| `SkinningPass` | Compute skinning for skeletal meshes into pre-skinned vertex buffers. |
| `VisBufferPass` (phase 1) | Rasterizes the early, non-occluded camera meshlets into triangle IDs plus depth, clearing both. |
| `TerrainUpdatePass` | Terrain chunk streaming and meshlet updates. |
| `TerrainCullPass` | Terrain chunk culling against last frame's end pyramid. Chunks are large, so the one-frame lag is a conservative trade. |
| `TerrainDepthPrePass` | Terrain depth plus a VisBuffer "empty" stamp. Runs **before** the mid pyramid so terrain occludes the late meshlet re-test, SSAO and decals see full opaque depth, and the deferred pass skips mesh pixels terrain covers. |
| `DepthPyramidPass` (mid) | Rebuilds the pyramid from this frame's partial depth (meshes plus terrain) using single-pass downsample. |
| `CullPassLate` | Re-tests the deferred meshlets against the rebuilt pyramid and emits the disoccluded ones to the camera-late view. |
| `VisBufferPass` (phase 2) | Rasterizes the disoccluded meshlets, loading and accumulating into the same VisBuffer and depth without clearing. Removes the one-frame disocclusion lag. |

This two-phase occlusion scheme is the standard "test against last frame, then
re-test the survivors against this frame" approach, with the important detail
that phase 0 **defers** rather than discards, so nothing pops in a frame late.

### Lighting setup

| Pass | What it does |
| --- | --- |
| `ClusterBuildPass` | Builds the view's froxel cluster grid. Rebuilt when the projection, near/far, or screen size changes. |
| `LightCullPass` | Assigns lights to clusters. |
| `PointShadowPass` | Cube shadow maps for point lights, into the shadow atlas. |
| `SpotShadowPass` | Spot light shadow maps. |
| `CascadedShowPass` | Cascaded shadow maps for the directional light (four cascades). |

### Environment and IBL

| Pass | What it does |
| --- | --- |
| `SkyCubeCapturePass` | Captures the sky into a cubemap. Placed here so the IBL cube stays in lockstep with the rendered background. |
| `IrradianceConvolutionPass` | Convolves the diffuse irradiance cubemap from that capture. |
| `PrefilterEnvMapPass` | Convolves the GGX specular prefilter chain. |
| `EnvironmentPass` | Draws the sky or background into HDR. |

IBL cube reconciliation at a new resolution happens in `PrepareRender`, not here,
because it issues `WaitDeviceIdle`.

### Opaque shading

| Pass | What it does |
| --- | --- |
| `DecalPass` | DBuffer decals projected onto the full opaque depth. |
| `SSAOPass` plus `SSAOBlurPass` | Ambient occlusion from full opaque depth. |
| `DeferredMaterialPass` | Shades the visibility buffer. See below. |
| `TerrainRenderPass` | Forward terrain shading, early-Z against the pre-pass depth so the heavy terrain pixel shader runs once per visible pixel. |
| `DepthPyramidPass` (end) | Final pyramid, consumed by next frame's early cull. |

#### The deferred material pass

This is the most unusual pass in the renderer, and the reason the VisBuffer
exists.

Each distinct **master deferred shader** gets one dense slot, `0..N-1`. Every
opaque material *instance* sharing that shader maps its own GPU `MaterialIndex`
to the same slot.

1. `ClassifyMaterialTiles.slang` (compute) walks covered pixels, writes each
   pixel's owning slot, and sets that slot's bit in the pixel's tile bitmask.
2. One shading draw per slot rasterizes **only the tiles whose bit is set**
   (`DeferredMaterialTileVS.slang` self-culls the rest), keeps the pixels whose
   recorded slot matches, and shades each with its own per-instance
   `MaterialIndex`.

The result is `O(distinct visible master shaders)` tile-binned draws: not one per
instance, and not a fullscreen pass per material. Instances of one master share
both the geometry batch and the shading draw.

Texture sampling in this pass uses analytic UV gradients
(`SampleTexture2DGrad`), because a deferred lane has no automatic derivatives and
naive sampling produces mip seams across triangle, meshlet, and instance
boundaries.

### Water, translucency, and fog

| Pass | What it does |
| --- | --- |
| `WaterPass` | After the opaque scene, so HDR holds the lit scene to refract and screen-space reflect, and before translucency. |
| `TransparentPass` | Weighted-blended OIT accumulation into `Accum` and `Revealage`. |
| `OITResolvePass` | Resolves those into HDR. |
| `AdditiveTranslucentPass` | Additive blended translucency. |
| `FroxelInjectPass` / `FroxelIntegratePass` / `FroxelApplyPass` | Volumetric fog: inject scattering into the froxel volume, integrate along view rays, apply to the scene. |

### Debug, particles, and world overlays

| Pass | What it does |
| --- | --- |
| `BatchedTriangleDraw` / `BatchedLineDraw` | Debug primitive batches from `IPrimitiveDrawInterface`. |
| `ParticleSimulatePass` / `ParticleRenderPass` | GPU particle simulation and rendering. |
| `BillboardPass` | Editor icons and billboards, pre-tone-map, writing both HDR and the picker buffer. |
| `TextPass` | World-space MSDF text, same MRT arrangement as billboards. |
| `WidgetPickerPass` (editor) | World-space widgets stamp their entity ID into the picker buffer so they stay click-selectable; their color is drawn later, post-tone-map. |
| `IssuePickerReadback` (editor) | Issued after the last picker write; the readback is consumed lazily by `GetEntityAtPixel`. |

### Post-processing

| Pass | What it does |
| --- | --- |
| `UnderwaterPass` | Absorption and distortion over the fully composited HDR, computed per-ray path length so a half-submerged waterline falls out naturally and above-water pixels are untouched. Before bloom and exposure. |
| `BloomPass` | Downsample and upsample chain. |
| `AutoExposurePass` | Adapts luminance into `AdaptedLuminance`. |
| `ToneMappingPass` | HDR to LDR, including color grading. |
| `PostProcessMaterialPass` | User post-process materials, in the order the world resolved them from the camera and post-process volumes. |
| `SMAAEdgeDetectionPass` / `SMAABlendWeightPass` / `SMAANeighborhoodBlendPass` | Only when `SMAAQuality != Off`. |
| `WidgetPass` | World-space widget color, post-tone-map. |
| `DebugTextPass` | Non-Shipping only. |

### Capture views and composite

Every enabled capture view then re-renders a reduced pass list
(`RenderCaptureView`): the gather is shared, the shading is per view. Capture
views are **frustum only**, a single cull phase with no late re-test.

Finally, `RmlUi::RenderWorldUI` composites screen-space world UI onto the primary
output, and a `Barriers::RasterToRead` makes the final writes visible to the
ImGui submit that samples them in the editor viewport.

## Draw command compilation

Two halves, run before the passes:

- `CompileDrawCommands_GameThread` does the ECS reads and the parallel `Process*`
  tasks, plus cull and shadow setup.
- `CompileDrawCommands_RenderThread` resizes buffers and records the uploads.

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

1. Declare the method in `ForwardRenderScene.h` in the pass block.
2. Add any new render target to `ENamedImage` and its allocation.
3. Insert the call into `RenderView` at the correct point, wrapped in a
   `SCENE_GPU_SCOPE`.
4. Add the barrier that orders it against the passes it reads from. There is no
   automatic dependency tracking.
5. If it writes depth, use reverse-Z (`EOp::Greater` / `GreaterEqual`, clear to
   0.0).
6. If the pass has a shader, note that changing the pipeline's key layout may
   need a [shader cache version](/internals/shaders/) bump.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| A pass reads stale data | Missing barrier. The renderer relies entirely on explicit `RHI::Barriers` calls. |
| Geometry pops one frame late | Something disabled the late cull re-test, or a new view was added to the early phase only. |
| Mip seams in deferred shading | Sampling without analytic gradients in the deferred material lane. |
| Z-fighting in a new pass | Standard depth comparison instead of reverse-Z. |
| Wrong material on an instance | A `MaterialIndex` of -1 collapsed to 0 instead of staying `SIZE_MAX`. |
| Corrupted GPU marker names | An unbalanced `SCENE_GPU_SCOPE` on an early-return path. |
