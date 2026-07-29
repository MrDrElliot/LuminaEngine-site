---
title: Shaders
description: Slang compilation, the SPIR-V cache, the shader library, and shader conventions.
---

Every shader in Lumina is written in **Slang** and compiled to SPIR-V. Sources
live in `Engine/Resources/Shaders`, with shared code under `Includes/` and
material stage templates under `MaterialShader/`.

There is no HLSL or GLSL path, and no runtime GLSL compiler.

## The compiler

`FSpirVShaderCompiler` (`Renderer/ShaderCompiler.cpp`) implements
`IShaderCompiler`:

```cpp
bool CompilerShaderRaw (FString Source, const FShaderCompileOptions&, CompletedFunc);
bool CompileShaderPath (FString Path,   const FShaderCompileOptions&, CompletedFunc);
bool CompileShaderPaths(TSpan<FString>, TSpan<FShaderCompileOptions>, CompletedFunc);
bool HasPendingRequests() const;
void Flush() const;
```

Compilation is asynchronous: the completion callback receives an `FShaderHeader`
with the bytecode and reflection data.

`FShaderCompileOptions`:

| Field | Purpose |
| --- | --- |
| `bGenerateReflectionData` | Emit reflection alongside the bytecode. |
| `MacroDefinitions` | Preprocessor defines. These are part of the cache key. |
| `DebugName` | Used as the Slang source path, so crash dumps and Aftermath resolve to `<DebugName>.slang:line` rather than a generic `RawShader`. Also the registered debug name. |

Slang target settings: SPIR-V, column-major matrix layout,
`GENERATE_SPIRV_DIRECTLY`, and `GENERATE_WHOLE_PROGRAM`.

### Parallel compilation

Slang's `IGlobalSession` is **not thread safe**: objects created from one may
only be touched by a single thread at a time. Creating a session per shader is
also expensive, because each one loads the Slang core module.

The compiler therefore keeps a **pool of global sessions**. A compile job
acquires one, creates a per-compile `Session` from it, and releases it when done.
Slang explicitly supports reusing one global session for many sessions, so the
pool grows only to the number of concurrent compiles. A file system shim
(`FShaderFS`) routes Slang's includes through the engine VFS.

Compilation runs on the job pool, so a cold shader build saturates the machine.

### Optimization and debug info

- Optimization is forced to `SLANG_OPTIMIZATION_LEVEL_HIGH`. The default (`-O1`)
  emitted SPIR-V that failed validation on buffer-device-address pointer locals.
- Debug info level is build and vendor gated. It is raised to `STANDARD` for
  Nsight source-level debugging on non-AMD, non-Shipping builds, and left minimal
  otherwise because the extra debug info triggered AMD driver problems.

## The SPIR-V cache

`FShaderCache` (`Renderer/ShaderCache.h`) stores compiled SPIR-V as `.lsc` files
under `/Intermediates/ShaderCache` (a VFS path, editor-writable). The cooker
bundles the cache into the `.pak`, so **packaged builds never invoke Slang**.

The cache key covers the source, its includes, the macro definitions, and the
compiler configuration. A hit is served inline; misses are queued to the parallel
compile swarm.

### Cache version

`FShaderCache` carries an explicit version constant that must be bumped whenever
the `.lsc` binary layout or the compile pipeline changes in a way that
invalidates older entries. Its history doubles as a changelog of renderer
rewrites, for example:

- v2, `ERHIShaderType` renumbered when the old RHI's resource-type enum was
  trimmed.
- v3, debug info raised to `STANDARD` on non-AMD non-Shipping.
- v4, optimization forced to `HIGH`.
- v5, deferred material binning re-keyed per pixel on the owning slot.
- v6, `SampleTexture2DGrad` added for analytic-gradient deferred texturing.
- v7, VisBuffer geometry unified across opaque and masked with the
  `VISBUFFER_MASKED` specialization constant.
- v10, the cull pass writes the mesh-task `GroupCountX` directly, changing the
  cull push-constant layout.
- v13, meshlet positions became full mesh-local `float3` with no quantization.

If you change a push-constant layout, a shared struct in `Includes/`, or the
meaning of an existing one, **bump the version**. The symptom of forgetting is
stale bytecode producing garbage that disappears after deleting the cache
directory.

## The shader library

`FShaderLibrary` (`Renderer/ShaderLibrary.h`) is the runtime registry.

```cpp
static const FShaderEntry* const VS = FShaderLibrary::Get("MeshletVertex.slang");
```

`FShaderEntry` semantics matter:

- Entries are created on first request and **never move or die**. Caching the
  pointer for the life of the process is the intended usage.
- `Get` never returns null for a valid name; it compiles synchronously if the
  startup batch has not delivered that shader yet. Check `IsValid()` per use;
  false means compilation failed.
- `ID` is process-unique and never reused. `Generation` starts at 0 (not compiled
  yet) and bumps on every recommit.
- A recompile swaps the bytecode **in place** and bumps `Generation`, so cached
  entry pointers stay valid and pipeline caches keyed on `(ID, Generation)` pick
  up the new code automatically. This is what makes live shader editing work
  without invalidating every cached pipeline pointer in the renderer.

Externally produced bytecode (graph-compiled materials, particle systems) is
registered through the same library, so the same key produces the same entry.

`GShaderLibrary` and `GShaderCompiler` are the globals, both owned by
`FRenderManager`.

## Shader organization

| Path | Contents |
| --- | --- |
| `Shaders/*.slang` | Standalone passes: culling, cluster build, light cull, SSAO, bloom, SMAA, tone mapping, particles, ImGui, RmlUi, environment, IBL convolution. |
| `Shaders/Includes/*.slang` | Shared code. |
| `Shaders/MaterialShader/*.slang` | The stage templates a material graph compiles into. |
| `Shaders/Particles/*.slang` | Particle simulation template. |

Notable includes:

| Include | Provides |
| --- | --- |
| `GlobalRHI.slang` | The bindless access layer: heap indexing helpers, `SAMPLER_*` stock sampler constants, `SampleTexture2DGrad`. |
| `SceneGlobals.slang` | The per-view and per-scene constant layout. |
| `Common.slang` | Math and utility helpers. |
| `Culling.slang` | Frustum, cone, and Hi-Z occlusion tests. |
| `MeshletGeometry.slang` | Meshlet decode shared by the vertex and mesh shader paths. |
| `SurfaceShading.slang` | The PBR shading model. |
| `IBL.slang` / `IBLRuntime.slang` | Image-based lighting, bake side and runtime side. |
| `ShadowSampling.slang` | Cascade and cube shadow lookups. |
| `Froxel.slang` / `Fog.slang` | Volumetric fog. |
| `Water.slang`, `TerrainCommon.slang`, `TerrainData.slang`, `DBuffer.slang`, `DecalCommon.slang`, `SMAA.slang`, `TextCommon.slang`, `RmlUiCommon.slang`, `ImGuiCommon.slang`, `UIMaterialGlobals.slang` | Feature-specific shared code. |

**`SAMPLER_*` in `GlobalRHI.slang` must stay in lockstep with `EStockSampler`**
in `RHICore.h`. The stock samplers are registered by index at startup; a mismatch
silently samples with the wrong filter or address mode.

## Conventions

- **Bindless everywhere.** A shader never declares a descriptor binding for a
  texture. It receives a `uint` heap slot in a constant struct and indexes the
  global heap.
- **Buffers are pointers.** Structured data arrives as a device address in the
  push constant block, dereferenced directly. There are no `StructuredBuffer`
  bindings.
- **One push-constant struct per pass**, uploaded through
  `RHI::Core::CopyTransient` and passed as the `GPUPtr DrawArgs` argument to the
  draw or dispatch.
- **Reverse-Z**: depth clears to 0, comparisons are greater-than. Any shader that
  reconstructs depth must account for it.
- **Column-major matrices**, matching the Slang target configuration.
- Entry point names are conventional per stage; the pipeline creation call names
  them explicitly through `FShaderSource::EntryPoint`.

## Specialization constants

`FSpecializationConstant` carries an ID, a value, and a type (`UInt8` through
`Float32`, plus `Boolean`). They are passed at pipeline creation and are part of
the pipeline key.

The renderer uses them to collapse permutations. `VISBUFFER_MASKED` is the
clearest example: one geometry shader serves both opaque and masked materials,
with the extra interpolants gated and dead-stripped by the constant, instead of
maintaining separate masked geometry shaders.

Prefer a specialization constant over a macro define when the variants share
almost all of their code, because macro defines create separate cache entries
while specialization constants share one compile.

## Material shaders

A material graph compiles to a stage template in `MaterialShader/`. Which
template depends on the material's domain and the pass:

| Template | Used by |
| --- | --- |
| `MeshletVertex.slang`, `MeshletMesh.slang`, `MeshletVisBuffer.slang`, `MeshletVisBufferVS.slang` | Geometry, vertex and mesh shader paths. |
| `VisBufferMaskedPixel.slang` | Masked materials during the VisBuffer pass. |
| `DeferredMaterial.slang` | The tile-binned deferred shading lane. |
| `BasePixelPass.slang` | Forward-shaded surfaces. |
| `TerrainBaseVertexPass.slang` / `TerrainBasePixelPass.slang` | Terrain. |
| `DecalVertexPass.slang` / `DecalPixelPass.slang` | Decals. |
| `PostProcessPixelPass.slang` | Post-process materials. |
| `UIPixelPass.slang` | UI material brushes. |

The editor's material compiler emits the graph body into the template and submits
it as raw source with a stable `DebugName`, which is why a material error message
points at a readable name. Changing a material triggers a recompile that swaps
bytecode into the existing `FShaderEntry`, so the change is visible without a
restart.

## Register pressure

Pixel shader register pressure is the dominant GPU bottleneck in this renderer.
When adding to `SurfaceShading.slang` or any material pixel template, check
occupancy before and after. A few extra live values across the shading loop cost
more than the arithmetic they save.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Garbage output that a cache wipe fixes | A push-constant or shared struct layout changed without a `FShaderCache` version bump. |
| Shader compiles but samples the wrong way | `SAMPLER_*` constants out of sync with `EStockSampler`. |
| Crash or corruption compiling many shaders at once | Slang session reuse across threads. Go through the session pool. |
| SPIR-V validation failure on buffer pointers | Optimization level dropped below `HIGH`. |
| A material change does not take effect | The recompile failed. Check `FShaderEntry::IsValid()` and the compile log. |
| `<DebugName>.slang:line` shows as `RawShader` | The compile options did not set `DebugName`. |
