---
title: RHI
description: "The graphics abstraction: handles, GPU pointers, bindless heaps, and command lists."
---

Lumina's RHI is not a class hierarchy. It is a **flat set of free functions in
the `Lumina::RHI` namespace** over opaque handles, declared in
`Engine/Source/Runtime/Renderer/RHI.h` and implemented per backend. There is one
backend today, Vulkan (`Renderer/API/Vulkan/VulkanRHI.cpp`). The enum reserves
`Metal` and `DX12` slots, both unimplemented.

There is **no OpenGL backend**, and there is no render graph. Passes are recorded
by hand into command lists, in an explicit order, with explicit barriers.

## Present and future

Most graphics abstractions are shaped by hardware that no longer exists. Binding
slots, vertex input layouts, and per-draw descriptor sets are concessions to
fixed-function stages that a modern GPU emulates rather than implements. Lumina
targets the hardware as it is now, and as it is clearly heading, instead of a
lowest common denominator.

Everything below is core Vulkan or an extension that has shipped on every vendor
for years. None of it is a fast path with a fallback beside it. There is one way
to draw geometry, one way to reach a texture, and one way to reach a buffer.

- **Bindless everywhere.** Descriptor indexing replaced descriptor sets. A
  texture is an integer.
- **Buffer device address everywhere.** A shader chases pointers the way C++
  does, so a GPU struct can point at another buffer. This is what lets the cull
  pipeline stay GPU-resident: the CPU never has to learn what the GPU decided.
- **Mesh and task shaders are the only geometry path.** Not an optimization, the
  pipeline. See [Mesh shaders are required](#mesh-shaders-are-required).
- **Dynamic state over permutations.** Cull mode, front face, and depth state
  are set on the command list, so one pipeline covers what would otherwise be
  four.
- **Timeline semaphores only.** A binary semaphore models the frame as a chain
  of handoffs. A timeline models it as a value anyone can wait on, which is what
  a job system actually needs.

The direction that points is GPU-driven work: the GPU decides what to draw, sizes
its own dispatches, and writes its own indirect arguments. Lumina's scene cull
already works this way, and the API shape is what makes that unremarkable instead
of a special case. Every per-draw payload is already a device address, so moving
a decision from the CPU to the GPU does not change a signature.

## Mesh shaders are required

`VK_EXT_mesh_shader` is a hard requirement. Device selection rejects a GPU that
lacks the extension, lacks the `meshShader` feature, or reports limits below what
the geometry path needs, and it says so in a dialog instead of failing later in a
confusing way. There is no vertex and index path to fall back to.

The limits checked at startup:

| Limit | Minimum |
| --- | --- |
| `maxMeshWorkGroupSize[0]`, `maxMeshWorkGroupInvocations` | 32 |
| `maxMeshOutputVertices` | 64 |
| `maxMeshOutputPrimitives` | 64 |
| `maxTaskWorkGroupSize[0]`, `maxTaskWorkGroupInvocations` | 32 |
| `maxTaskPayloadSize`, `maxTaskPayloadAndSharedMemorySize` | 4096 |

In practice that means NVIDIA Turing (GTX 16 series, RTX 20 series) or newer, AMD
RDNA2 (RX 6000) or newer, or Intel Arc.

How the renderer uses them is covered in [Meshlet Pipeline](/internals/meshlet-pipeline/).

Requiring them removes a class of problem rather than adding one. There is a
single meshlet format, a single cull, and a single set of entry points, so a bug
cannot be present on one path and absent on the other, and no pass gets written
twice.

## Shape of the API

```cpp
RHI::FCmdListH CL = RHI::OpenCommandList();
RHI::CmdSetTextureHeap(CL, RHI::Core::GetGlobalHeap());
RHI::CmdBeginRenderPass(CL, PassDesc);
RHI::CmdSetPipeline(CL, Pipeline);
RHI::CmdDrawIndexed(CL, IndexBuffer, 0, Args, IndexCount, 1, 0, 0, 0);
RHI::CmdEndRenderPass(CL);
RHI::Core::Submit(CL);
```

Four design decisions explain most of what you will read:

1. **Handles, not objects.** `THandle<T>` wraps an integer. `RHI::IsValid(H)`
   tests it. There is no vtable, no reference counting, and no `IRHITexture`
   interface to implement.
2. **Buffers are raw GPU addresses.** There is no buffer object at all.
   `RHI::Malloc` returns a `GPUPtr` (a `uint64` device address), and shaders
   dereference it directly through buffer device address. `RHI::ToHost(GPUPtr)`
   gives you the mapped CPU pointer for host-visible memory.
3. **Everything a shader reads is bindless.** There are no descriptor sets in the
   API. Textures, storage images, and samplers live in a **texture heap** and are
   addressed by an integer slot. One heap is bound per command list.
4. **Draw arguments are a pointer.** Every `Cmd*Draw` / `CmdDispatch` takes a
   `GPUPtr DrawArgs` that becomes the shader's push-constant payload. Passing
   per-draw data means writing a struct into transient memory and handing over
   its address.

## Handles

```cpp
using FPipelineH     = THandle<FPipeline>;
using FTextureH      = THandle<FTexture>;
using FTextureHeapH  = THandle<FTextureHeap>;
using FSemaphoreH    = THandle<FSemaphore>;
using FDepthStencilH = THandle<FDepthStencilState>;
using FCmdListH      = THandle<FCommandList>;
using FSwapchainH    = THandle<FSwapchain>;
using FSurfaceH      = THandle<FSurface>;
```

Every handle type has a `FreeH` overload. RAII wrappers exist and should be
preferred for anything with a lifetime longer than a function:

- `RHI::TUniqueH<T>` (aliased as `FPipelineUH`, `FTextureUH`, `FTextureHeapUH`,
  `FSemaphoreUH`, `FDepthStencilUH`) frees the handle on destruction.
- `RHI::FUniqueGPUPtr` does the same for a `GPUPtr`.

## Memory

```cpp
GPUPtr Malloc(uint64 Size, uint64 Alignment = 16, EMemoryType Type = EMemoryType::Default);
void*  ToHost(GPUPtr GPU);
void   Free(GPUPtr GPU);
```

`EMemoryType` is `CPUWrite` (the default), `CPURead`, or `GPUOnly`. Allocations
above `kDedicatedMemoryThreshold` (32 MB) get a dedicated allocation.

`RHI::New<T>(Count)` allocates and value-constructs an array, returning both the
host pointer and the GPU address:

```cpp
auto [Host, Gpu] = RHI::New<FMyStruct>(Count);
Host[0].Value = 1.0f;
// pass Gpu to a shader
```

Freeing memory the GPU may still be reading is the classic bug here. Use
`RHI::Core::DeferredFree(Ptr, ExtraFrames)` instead of `RHI::Free` for anything
referenced by submitted work. It retires the allocation once every in-flight
frame has completed. `ExtraFrames` extends that window for memory whose address
can still be handed out **after** the free was queued, for instance a game-thread
cache that will return the old address for one more tick.

### Transient memory

`RHI::Core::AllocTransient(Size, Alignment)` is a per-frame bump allocator over
CPU-write, device-addressable memory. It is thread safe (atomic bump) and valid
until its frame slot is reused.

```cpp
GPUPtr Args = RHI::Core::CopyTransient(MyPushConstants);
GPUPtr Data = RHI::Core::CopyTransientArray(Items.data(), Items.size());
```

This is the intended way to pass per-draw and per-pass data. **It is not for
geometry.** Vertex and index data belong in a persistent allocation; the
transient ring is sized for small per-frame payloads and cycling megabytes of
mesh data through it will exhaust it.

## Textures

```cpp
FTextureDesc Desc
{
    .Type       = ETextureType::Tex2D,
    .Dimension  = { Width, Height, 1 },
    .MipCount   = Mips,
    .LayerCount = 1,
    .Format     = EFormat::RGBA8_UNORM,
    .Usage      = EImageUsageFlags::Sampled | EImageUsageFlags::TransferDst,
};
RHI::FTextureH Texture = RHI::CreateTexture(Desc);
```

Types cover 1D, 2D, 3D, cube, 2D array, and cube array. Usage flags are
`Sampled`, `Storage`, `ColorAttachment`, `DepthAttachment`, `TransferSrc`,
`TransferDst`.

`CreateTexture` takes an optional `GPUPtr Location` to place the image in memory
you already own. `GetTextureDesc(Texture)` reads a description back.

Copies and blits operate on `FTextureSlice` (mip, layer, layer count, offset,
extent; an extent of 0 means the full mip):

```cpp
CmdCopyTexture, CmdCopyMemoryToTexture, CmdCopyTextureToMemory,
CmdBlitTexture, CmdResolveTexture, CmdClearTexture, CmdClearTextureUInt
```

## The texture heap

```cpp
FTextureHeapH CreateTextureHeap(uint32 TextureCount, uint32 RWTextureCount, uint32 SamplerCount);

uint32 HeapWriteTexture(FTextureHeapH Heap, FTextureH Texture);
uint32 HeapWriteRWTexture(FTextureHeapH Heap, FTextureH Texture, uint32 Mip = 0);
uint32 HeapWriteSampler(FTextureHeapH Heap, const FSamplerDesc& Desc);
void   HeapFreeTexture / HeapFreeRWTexture / HeapFreeSampler(Heap, uint32 Slot);
```

Each `HeapWrite*` returns a slot index. That integer is what you put in a shader
struct; the shader indexes the heap with it. `kInvalidHeapSlot` (`~0u`) marks an
unset slot.

Binding slots inside the heap are fixed:

| Constant | Value | Contents |
| --- | --- | --- |
| `kSamplerBindingSlot` | 0 | Samplers |
| `kImageBindingSlot` | 1 | Sampled images |
| `kRWImageBindingSlot` | 2 | Storage images |

Limits: `kMaxTextureHeapSize` (`INT16_MAX`) entries, `kMaxNumSamplers` (4000),
`kMaxNumTextureHeaps` (1024).

`RHI::Core::GetGlobalHeap()` is the process-wide heap that virtually everything
uses. `CmdSetTextureHeap(CL, Heap)` binds it, and every render path does this as
its first command.

**Slot lifetime is the sharp edge.** A slot freed while a submitted command list
still references it produces a GPU-side read of a destroyed image. Free heap
slots on the same deferred schedule as the resources behind them.

Stock samplers are registered by `Core::Initialize` in a fixed order, exposed as
`EStockSampler`: `LinearWrap`, `LinearClamp`, `LinearMirror`, `PointWrap`,
`PointClamp`, `AnisoWrap`, `AnisoClamp`, `Shadow`, `MinReduction`,
`MaxReduction`. These must stay in lockstep with the `SAMPLER_*` constants in
`GlobalRHI.slang`.

`GetTextureHeapTextures(Heap, Out)` enumerates every occupied sampled slot, which
is what the editor's GPU resource views display.

## Pipelines

```cpp
FPipelineH CreateGraphicsPipeline(const FShaderSource& Vertex, const FShaderSource& Fragment,
                                  const FRasterDesc& Desc, TSpan<const FSpecializationConstant> = {});
FPipelineH CreateComputePipeline(const FShaderSource& Compute, TSpan<const FSpecializationConstant> = {});
FPipelineH CreateMeshShaderPipeline(const FShaderSource& Task, const FShaderSource& Mesh,
                                    const FShaderSource& Fragment, const FRasterDesc& Desc,
                                    TSpan<const FSpecializationConstant> = {});
```

`FShaderSource` is a SPIR-V byte span plus an entry point name.
`RHI::Core::CreateGraphicsPipeline(VertexName, PixelName, Desc)` is the
convenience form that pulls bytecode from the engine shader library by
`FName`.

`FRasterDesc` carries topology, sample count, wireframe, alpha to coverage, the
depth and stencil formats, and the color target list (each with its own
`FBlendDesc`). There is **no vertex input layout**: vertices are pulled from
buffers through device addresses in the shader.

There is no support query to guard `CreateMeshShaderPipeline` with. A device that
could fail it never finished startup, so the call is unconditional. The task
stage is optional: an empty source means a mesh-only pipeline.

Depth and stencil state is a separate object (`CreateDepthStencil`) bound with
`CmdSetDepthStencilState`, because the engine reuses one pipeline across
different depth modes.

## Dynamic state

Front face, cull mode, line width, viewport, scissor, depth and stencil state,
and the index buffer are all dynamic:

```cpp
CmdSetFrontFace, CmdSetCullMode, CmdSetLineWidth,
CmdSetViewport, CmdSetScissor,
CmdSetDepthStencilState, CmdSetIndexBuffer
```

This keeps the pipeline permutation count down: the same pipeline serves both
cull modes and every viewport size.

## Command lists and submission

```cpp
FCmdListH OpenCommandList(EQueueType Type = EQueueType::Graphics);
void      ResetCommandList(FCmdListH CL);
void      Submit(EQueueType Queue, TSpan<const FCmdListH> CLs,
                 TSpan<const FSemaphoreInfo> Waits = {}, TSpan<const FSemaphoreInfo> Signals = {});
void      Submit(FCmdListH CL, EQueueType Type = EQueueType::Graphics);
void      SubmitAndWait(FCmdListH CL);
```

`EQueueType` is `Graphics`, `Transfer`, or `Compute`. Whether those are distinct
hardware queues depends on the device, so ask before you rely on overlap:

```cpp
bool SupportsAsyncCompute();
bool SupportsAsyncTransfer();
```

When either returns false the logical queue aliases graphics and shares its
family index, and a submission on it will not run concurrently. Uploads use the
transfer queue when one exists, which is why buffer and image uploads flush
separately: an image upload includes a layout transition, and a layout transition
is a write the transfer queue must not claim on an exclusive resource.

`SubmitAndWait` submits on the graphics queue and blocks until **only that
submission** completes, by waiting its own frame-timeline value. Use it for
one-off captures. Do **not** use `Submit` followed by `WaitDeviceIdle` mid-frame:
`WaitDeviceIdle` blocks on unrelated in-flight frame work, stalling the whole
frame instead of just your submission.

Command list recording is single threaded per list. Multiple scenes may record
concurrently because each opens its own list; shared resource creation inside the
RHI is internally locked.

## Synchronization

Semaphores are timeline semaphores:

```cpp
FSemaphoreH CreateTimelineSemaphore(uint64 InitialValue);
void        WaitSemaphore(FSemaphoreH Semaphore, uint64 Value);
uint64      GetSemaphoreValue(FSemaphoreH Semaphore);
```

`GetSemaphoreValue` reads the current value without blocking, which is how the
upload path tests whether a slot has been consumed before deciding to wait on it.

`FSemaphoreInfo { Semaphore, Value, Stage }` is what you pass to `Submit` as a
wait or a signal.

Barriers are expressed as stage-to-stage transitions, not as per-resource
transitions:

```cpp
void CmdBarrier(FCmdListH CL, EStageFlags Before, EStageFlags After);
```

`EStageFlags` covers `IndirectArguments`, `Transfer`, `Compute`,
`RasterColorOut`, `PixelShader`, `FragmentTests`, `VertexShader`, `Host`,
`MeshShader`, `TaskShader`, and `AllCommands`.

The `RHI::Barriers` namespace holds the canonical combinations, and passes should
use these rather than hand-rolling stage masks:

| Helper | Orders |
| --- | --- |
| `ComputeToAll` | Compute writes before any later read, including indirect args. |
| `RasterToRead` | Color and depth writes before shader reads. |
| `RasterToRaster` | Attachment writes before the next attachment writes. |
| `TransferToAll` | Copies before everything. |
| `TransferToTransfer` | Copy before copy (resolves write-after-write hazards between two copies to the same image). |
| `AllToTransfer` | Everything before a copy. |

Image layout transitions are handled by the backend. See
[Vulkan Backend](/internals/vulkan-backend/) for how unified image layouts remove
most of that bookkeeping.

## Render passes

`CmdBeginRenderPass` / `CmdEndRenderPass` take an `FRenderPassDesc` of color
attachments, a depth attachment, a stencil attachment, and a render area. Each
`FRenderAttachment` has a texture, an optional MSAA resolve target, a load op, a
store op, and a clear color. This maps onto Vulkan dynamic rendering; there are
no `VkRenderPass` or framebuffer objects.

## Draws and dispatches

```cpp
CmdDraw(CL, DrawArgs, VertexCount, InstanceCount, FirstVertex, FirstInstance);
CmdDrawIndexed(CL, IndexBuffer, IndexOffset, DrawArgs, IndexCount, InstanceCount, FirstIndex, VertexOffset, FirstInstance, IndexType);
CmdDrawIndirect(CL, DrawArgs, IndirectBuffer, Offset, DrawCount, Stride);
CmdDrawIndexedIndirect(CL, DrawArgs, Offset, DrawCount, Stride);
CmdDispatch(CL, DrawArgs, GroupX, GroupY, GroupZ);
CmdDispatchIndirect(CL, DrawArgs, IndirectBuffer, Offset);
CmdDrawMeshTasks(CL, DrawArgs, GroupCountX, GroupCountY, GroupCountZ);
CmdDrawMeshTasksIndirect(CL, DrawArgs, IndirectBuffer, Offset, DrawCount, Stride);
CmdDrawMeshTasksIndirectCount(CL, DrawArgs, IndirectBuffer, Offset, CountBuffer, CountOffset, MaxDrawCount, Stride);
```

Indirect argument structs mirror the Vulkan ones: `FDrawIndirectArguments`,
`FDrawIndexedIndirectArguments`, `FDispatchIndirectArguments`, and
`FDrawMeshTasksIndirectArguments`.

## Device, swapchain, and presentation

```cpp
void CreateDevice(const FDeviceDesc& Desc = {});   // bValidation, bDebugUtils
void FreeDevice();
void WaitDeviceIdle();
void TickFrame();

FSurfaceH    CreateSurface(void* WindowHandle);      // MAIN THREAD ONLY
FSwapchainH  CreateSwapchain(FSurfaceH Surface, const FUIntVector2& Extent);
void         RecreateSwapchain(FSwapchainH Swapchain, const FUIntVector2& Extent);
FTextureH    AcquireNextImage(FSwapchainH Swapchain);   // invalid handle if out of date
bool         PresentSwapchain(FSwapchainH, FCmdListH Final, FSemaphoreH FrameSignal, uint64 Value);
void         SetVSync(bool) / bool GetVSync();
```

`CreateSurface` must be called on the thread that owns the window, because GLFW's
window calls are main-thread only. The handle is then passed to the render side,
where `CreateSwapchain` consumes it and takes ownership. `FreeH` on a surface is
only for the case where the window died before a swapchain was built.

`AcquireNextImage` returning an invalid handle means out of date; recreate the
swapchain and skip the frame.

`kFramesInFlight` is 3.

## Introspection

```cpp
FGPUDeviceInfo GetDeviceInfo();                  // name, API version string, vendor ID, discrete
void           GetGPUMemoryStats(FGPUMemoryStats& Out);
bool           SupportsAsyncCompute();
bool           SupportsAsyncTransfer();
ICrashTracker& GetCrashTracker();
void           HandleDeviceLost();
```

`FGPUMemoryStats` breaks down per heap: budget and usage as reported by the OS,
plus allocated and block bytes from the allocator. The gap between allocated and
block bytes is fragmentation and reserve. `bReBAR` marks a heap that is both
device local and host visible and larger than the legacy 256 MB BAR window.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| GPU reads garbage from a buffer freed last frame | `RHI::Free` instead of `Core::DeferredFree`. |
| Validation error about a destroyed image still in a descriptor | A heap slot was freed before the frames referencing it retired. |
| Frame-long stall after a one-off submit | `WaitDeviceIdle` used where `SubmitAndWait` was meant. |
| Transient allocation failure mid-frame | Geometry or large buffers pushed through the transient ring. |
| Crash creating a surface | `CreateSurface` called off the main thread. |
| Startup aborts with "Vulkan Device Unsuitable" | The GPU is below the [mesh shader requirement](#mesh-shaders-are-required). |
| Write-after-write hazard between two copies | Missing `Barriers::TransferToTransfer` between them. |
| Transfer-queue work appears to run in lockstep with graphics | `SupportsAsyncTransfer()` is false, so the queue aliases graphics. |
