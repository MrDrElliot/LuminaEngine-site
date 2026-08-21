---
title: Shaders
description: Slang compilation, the SPIR-V cache, the shader library, and shader conventions.
---

Every shader in Lumina is written in **Slang** and compiled to SPIR-V. Engine
sources live in `Engine/Resources/Shaders`, with shared code under `Includes/`
and material stage templates under `MaterialShader/`.

There is no HLSL or GLSL path, and no runtime GLSL compiler.

## Where shaders come from

Shaders are not engine-only. `Shaders::GetSearchRoots` returns the ordered VFS
directories that hold compilable `.slang` and that Slang resolves `#include`
against:

1. the engine tree,
2. every enabled plugin's `/Shaders`,
3. the loaded project's `/Game/Shaders`,
4. anything a module registered through `Shaders::RegisterSearchRoot`.

Engine comes first so a plugin or game shipping a file of the same name can never
shadow it. A shadowed name is reported, and the collider has to be requested by
its full virtual path. Roots that do not exist on disk are skipped, which is why
a packaged build (source stripped, only the compiled cache shipped) reports none.

`Shaders::PrecompileNewRoots()` compiles everything directly under each root not
yet enumerated. It runs from the compiler's `Initialize`, when only the engine
tree and engine plugins are mounted, and again after a project loads, when
`/Game` and the project's own plugins appear. Roots are remembered, so the second
pass only picks up what is new. `RegisterSearchRoot` is safe after startup:
on-demand lookups see it immediately, and the next precompile batch covers it.

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
| `bGenerateReflectionData` | Emit reflection alongside the bytecode. Defaults on. |
| `MacroDefinitions` | Preprocessor defines. These are part of the cache key. |
| `DebugName` | Used as the Slang source path, so crash dumps and Aftermath resolve to `<DebugName>.slang:line` rather than the default `RawShader`. Also the registered debug name. |

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

Two different hashes are in play, and confusing them is how a stale-bytecode bug
gets misdiagnosed:

- **The file name** is `hash(shader virtual path + sorted defines)`, so one
  shader plus one define set always maps to the same `.lsc`.
- **The validity check** is `ComputeSourceSetHash`, which walks the shader *and
  every file it includes, recursively*, mixing in the sorted defines and the
  cache version. A hit is only served when that hash matches what the `.lsc`
  recorded.

Because the include graph is part of the hash, editing a struct in `Includes/`
invalidates every shader that pulls it in, automatically. There is no version
constant to remember for that case. `kShaderCacheVersion` (currently **1**)
exists for changes the source hash cannot see: the `.lsc` binary layout itself,
or a compiler configuration change that alters output from identical source.

Misses are queued to the parallel compile swarm; hits are served inline.

## The shader library

`FShaderLibrary` (`Renderer/ShaderLibrary.h`) is the runtime registry, and it
hands out **weak generational handles**, not pointers:

```cpp
static const FShaderH CountCS = FShaderLibrary::Get("VisBufferMaterialCount.slang");
const FShaderEntry* Entry = FShaderLibrary::Resolve(CountCS);
```

`FShaderH` is a `THandle<FShaderEntry>` declared in its own header
(`ShaderHandle.h`), so the many places that only need to *store* one (material
assets, draw commands, the resolve cache, pipeline keys) do not pull in the
library, the RHI, and the compiler with them.

The semantics that matter:

- **`Get(NameOrNamePath, Defines)`** fetches by bare name (`"TexturePaint.slang"`,
  resolved against the search roots) or by full virtual path
  (`"/Game/Shaders/GameOfLife.slang"`). Use the path when two roots ship the same
  file name. It compiles on demand if the startup batch has not delivered it yet.
- **`Resolve(Handle)`** is the only legal way to dereference. It returns null once
  the entry has been freed, which is the signal that whatever cached the handle
  must re-resolve. Never dereference any other way.
- **`Commit(Key, Type, Spirv)`** interns bytecode **by content** and returns a
  handle with one strong reference. Identical bytecode returns the same handle,
  which is what collapses material instances into one draw batch key and
  therefore one draw.
- **Reference counting is deliberately partial.** Only owning `CMaterial` stages
  hold strong references. Caches hold weak handles and are not counted, because
  an entry is content-keyed and shared, so freeing it when one owner recompiles
  would break every other owner.
- **`Release` never frees inline.** At zero the entry is queued, and
  `FlushPendingReleases` frees it at a frame boundary where no lookup is in
  flight. `RHI::Core::BeginFrame` calls it.
- **`Generation`** starts at 0 (not compiled yet) and bumps on every recommit.
  `IsValid()` is `Generation != 0`, and `PipelineHash()` is `(ID << 32) |
  Generation`, so a recompile changes every pipeline key that names the shader
  and the new bytecode is picked up without invalidating unrelated pipelines.

Externally produced bytecode (graph-compiled materials, particle systems) is
registered through the same library, so the same content produces the same entry.

`GShaderLibrary` and `GShaderCompiler` are the globals, both owned by
`FRenderManager`.

## Shader organization

| Path | Contents |
| --- | --- |
| `Shaders/*.slang` | Standalone passes: instance and meshlet culling, cluster build, light cull, depth pyramid, GTAO, VisBuffer classification, deferred lighting, bloom, SMAA, tone mapping, volumetric fog and clouds, aerial perspective, particles, terrain, water, text, ImGui, RmlUi, environment and IBL convolution. |
| `Shaders/Includes/*.slang` | Shared code. |
| `Shaders/MaterialShader/*.slang` | The stage templates a material graph compiles into. |
| `Shaders/Particles/*.slang` | Particle simulation template. |

Notable includes:

| Include | Provides |
| --- | --- |
| `GlobalRHI.slang` / `GlobalRHIStorage.slang` | The bindless access layer: heap indexing helpers, `SAMPLER_*` stock sampler constants, `SampleTexture2DGrad`. |
| `SceneGlobals.slang` | The per-view and per-scene constant layout. |
| `Common.slang` | Math and utility helpers. |
| `Culling.slang` | Frustum, cone, and Hi-Z occlusion tests. |
| `MeshletGeometry.slang` | Meshlet decode, shared by every geometry pass's mesh stage. |
| `MeshletCullCore.slang` | The per-meshlet cull body, shared by the cull dispatches. |
| `AppendBuffer.slang` | The GPU append protocol used by every producer that reserves into a bounded region. |
| `VisBufferSurface.slang` | Reconstructing a surface from a VisBuffer pixel, used by the material lane. |
| `GBuffer.slang` | GBuffer encode and decode. |
| `SurfaceShading.slang` | The PBR shading model. |
| `IBL.slang` / `IBLRuntime.slang` / `ReflectionProbe.slang` | Image-based lighting, bake side and runtime side, plus local probes. |
| `ShadowSampling.slang` | Cascade and cube shadow lookups. |
| `Froxel.slang` / `Fog.slang` / `Sky.slang` | Atmosphere and volumetrics. |
| `MomentOIT.slang` | Moment-based order-independent transparency. |
| `Tonemap.slang`, `ParallaxOcclusion.slang`, `DistanceField.slang`, `Spline.slang`, `Wind.slang` | Shared feature code. |
| `Water.slang`, `TerrainCommon.slang`, `TerrainData.slang`, `DBuffer.slang`, `DecalCommon.slang`, `SMAA.slang`, `TextCommon.slang`, `RmlUiCommon.slang`, `ImGuiCommon.slang`, `UIMaterialGlobals.slang` | Feature-specific shared code. |

**`SAMPLER_*` in `GlobalRHI.slang` must stay in lockstep with `EStockSampler`**
in `RHICore.h`. The stock samplers are registered by index at startup and the
enum value *is* the slot, so a mismatch silently samples with the wrong filter or
address mode. New stock samplers go on the end of both.

## Conventions

- **Bindless everywhere.** A shader never declares a descriptor binding for a
  texture. It receives a `uint` heap slot in a constant struct and indexes the
  global heap.
- **Buffers are pointers.** Structured data arrives as a device address in the
  push constant block, dereferenced directly. There are no `StructuredBuffer`
  bindings.
- **One push-constant struct per pass**, uploaded through
  `RHI::Core::CopyTransient` and passed as the `GPUPtr DrawArgs` argument to the
  draw or dispatch. Where the struct is mirrored in C++, it carries a
  `static_assert` on its size against the Slang side.
- **Reverse-Z**: depth clears to 0, comparisons are greater-than. Any shader that
  reconstructs depth must account for it.
- **Column-major matrices**, matching the Slang target configuration.
- Entry points are named `main`; `FShaderEntry::Source()` hands that to the
  pipeline through `FShaderSource::EntryPoint`.

## Specialization constants

`FSpecializationConstant` carries an ID, a value, and a type (`UInt8` through
`Float32`, plus `Boolean`). They are passed at pipeline creation and are part of
the pipeline key.

The renderer uses them to collapse permutations. The geometry pipeline takes
seven, all `UInt32`:

| ID | Selects |
| --- | --- |
| 1 | Debug view modes compiled in |
| 2 | Decals |
| 3 | GTAO |
| 4 | VisBuffer masked |
| 5 | Skinning mode: static, skinned, or dynamic |
| 6 | Shadow mask |
| 7 | Per-triangle cull mode in the mesh shader |

Prefer a specialization constant over a macro define when the variants share
almost all of their code, because macro defines create separate cache entries
while specialization constants share one compile. Masked geometry is the case
where both are used: `VISBUFFER_MASKED_GEOM` is a define, because the masked mesh
shader genuinely needs different interpolants, and the resulting pipeline still
takes constant 4 so the pixel side stays one shader.

## Material shaders

A material graph compiles to a stage template in `MaterialShader/`. Which
template depends on the material's domain and the pass:

| Template | Used by |
| --- | --- |
| `MeshletMesh.slang`, `MeshletVisBuffer.slang` | Geometry. Mesh stage only; the vertex-emulation templates were removed when mesh shaders became a requirement. `MeshletVisBuffer.slang` compiles twice, opaque and masked. |
| `VisBufferMaskedPixel.slang` | Masked materials during the VisBuffer pass. |
| `DeferredMaterial.slang` | The per-material compute lane that writes the GBuffer. |
| `BasePixelPass.slang` | Forward-shaded surfaces. |
| `TerrainBaseVertexPass.slang` / `TerrainBasePixelPass.slang` | Terrain. |
| `DecalVertexPass.slang` / `DecalPixelPass.slang` | Decals. |
| `PostProcessPixelPass.slang` | Post-process materials. |
| `UIPixelPass.slang` | UI material brushes. |

The editor's material compiler emits the graph body into the template and submits
it as raw source with a stable `DebugName`, which is why a material error message
points at a readable name. Changing a material triggers a recompile that commits
new bytecode and bumps the entry's generation, so the change is visible without a
restart.

## Register pressure

Pixel shader register pressure is the dominant GPU bottleneck in this renderer.
When adding to `SurfaceShading.slang` or any material pixel template, check
occupancy before and after. A few extra live values across the shading loop cost
more than the arithmetic they save. In the editor, `GetPipelineStatistics` backs
the material editor's numbers, through
`VK_KHR_pipeline_executable_properties`.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Garbage output that a cache wipe fixes | Something the source-set hash cannot see changed: the `.lsc` layout or the compiler configuration. Bump `kShaderCacheVersion`. |
| Shader compiles but samples the wrong way | `SAMPLER_*` constants out of sync with `EStockSampler`. |
| Crash or corruption compiling many shaders at once | Slang session reuse across threads. Go through the session pool. |
| SPIR-V validation failure on buffer pointers | Optimization level dropped below `HIGH`. |
| A cached `FShaderH` stops working after a recompile | Expected. `Resolve` returned null; re-resolve rather than holding the pointer. |
| A material change does not take effect | The recompile failed. Check `IsValid()` on the resolved entry and the compile log. |
| A plugin shader resolves to the engine's file | Name collision across search roots. Request it by full virtual path. |
| `<DebugName>.slang:line` shows as `RawShader` | The compile options did not set `DebugName`. |
