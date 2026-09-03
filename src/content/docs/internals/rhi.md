---
title: RHI
description: "The graphics abstraction: handles, GPU pointers, bindless heaps, and command lists."
---

Lumina's RHI is not a class hierarchy. It is a **flat set of free functions in
the `Lumina::RHI` namespace** over opaque handles, declared in
`Engine/Source/Runtime/Source/Renderer/RHI.h` and implemented per backend. There is one
backend today, Vulkan (`Renderer/API/Vulkan/VulkanRHI.cpp`). The enum reserves
`Metal` and `DX12` slots, both unimplemented.

There is **no OpenGL backend**, and there is no render graph. Passes are recorded
by hand into command lists, in an explicit order, with explicit barriers. See
[Why there is no render graph](#why-there-is-no-render-graph).

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
- **Mesh shaders are the only geometry path.** Not an optimization, the
  pipeline. There is no vertex and index path beside it. See
  [Mesh shaders are required](#mesh-shaders-are-required).
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

## Why there is no render graph

A render graph exists to answer two questions. What has to happen before what,
and which resources can share memory. Both answers cost CPU time every frame,
and Lumina already has both without asking.

Barriers name **stages, not resources**:

```cpp
void CmdBarrier(FCmdListH CL, EStageFlags Before, EStageFlags After);
```

There is no resource argument, so there is nothing to track. No per-resource
state machine, no last-writer table, no reordering step, no aliasing analysis. A
pass that wrote with compute and is about to be read by anything says so in one
line, `RHI::Barriers::ComputeToAll(CL)`, and moves on. The canonical
combinations are listed under [Synchronization](#synchronization), and a pass
picks one rather than assembling stage masks by hand.

Layouts are gone as well. Every image stays in `GENERAL` for its whole life, and
the only real transition left is swapchain present. A graph that solves for
optimal layouts would be solving a problem the renderer does not have. See
[Vulkan Backend](/internals/vulkan-backend/) for how that works.

Transient aliasing is the other half of the usual pitch, and it does not apply
here either. Scene images are named and persistent, allocated once per view and
reallocated only when the view resizes. Nothing requests and releases a render
target per frame, so there is no lifetime puzzle to solve.

What the absence buys:

- **The frame is the source.** Passes run in the order they are written in the
  scene renderer. Reading the render function is reading the frame, with no
  graph to execute in your head and no node to trace back to the code that
  registered it.
- **A capture matches the code.** A GPU capture, a profiler zone, and the call
  site line up, because nothing was reordered on the way to the driver.
- **No per-frame graph cost.** Nothing to build, resolve, or compile. Recording
  a pass costs the pass.
- **One layer, not two.** A graph is an abstraction over an abstraction. Removing
  it means a pass calls the same functions the backend implements.

The trade is deliberate and worth stating plainly. A new pass has to choose its
own barrier, and choosing one too narrow is a hazard nothing will catch at
compile time. That is why the narrow helpers carry the warning they do, and why
the broad helper above them is the right default when in doubt.

## Mesh shaders are required

`VK_EXT_mesh_shader` is a hard requirement. Device selection rejects a GPU that
lacks the extension, lacks the `meshShader` feature, or reports limits below what
the geometry path needs, and it says so in a dialog instead of failing later in a
confusing way. There is no vertex and index path to fall back to.

The limits checked at startup:

| Limit | Minimum | Comes from |
| --- | --- | --- |
| `maxMeshWorkGroupSize[0]`, `maxMeshWorkGroupInvocations` | 32 | `kMeshWorkGroupSize` |
| `maxMeshOutputVertices` | 64 | `kMeshMaxOutputVertices` |
| `maxMeshOutputPrimitives` | 64 | `kMeshMaxOutputPrimitives` |

There is a fourth check, on subgroup width. A mesh workgroup is 32 threads, so a
device whose `minSubgroupSize` is below that must be able to pin the mesh stage
to 32 through `subgroupSizeControl`. When it can, the required size is recorded
and applied at pipeline creation; when it cannot, the device is rejected.

**No task-stage limits are checked, because the engine has no task shaders.**
Meshlet culling is a compute pass that writes indirect arguments, and the only
`CreateMeshShaderPipeline` call in the renderer passes an empty task source.

In practice the requirement means NVIDIA Turing (GTX 16 series, RTX 20 series) or
newer, AMD RDNA2 (RX 6000) or newer, or Intel Arc.

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

### Retiring

Freeing memory the GPU may still be reading is the classic bug here. `RHI::Free`
and `FreeH` destroy immediately. For anything a submitted command list can name,
go through the retire queue instead:

```cpp
RHI::Core::Retire(GPUPtr Memory);
RHI::Core::Retire(FTextureH Texture);
RHI::Core::Retire(FPipelineH Pipeline);
RHI::Core::RetireSampledSlot(uint32 HeapSlot);
RHI::Core::RetireStorageSlot(uint32 HeapSlot);
RHI::Core::RetireCallback(TFunction<void()> Callback);
```

This is the single point in the engine that destroys a GPU resource. Retiring is
**fence based, not frame counted**. Posting stamps the item with each queue's
current counter plus its open command list count, so the fence reaches past any
recording that may already name the resource but has not been submitted yet. The
drain at the next `BeginFrame` for that slot destroys only the items whose
recorded value every queue's timeline has passed.

`RetireCallback` runs on the same boundary a buffer retired at that instant would
be freed on. Use it for CPU-side state that *describes* a GPU resource and has to
stop describing it at exactly the moment it dies. Any earlier and frames already
recorded lose what they were built against; any later and frames recorded since
read freed state. A frame count cannot express that, but the fence already does.

Draining is metered at 64 destroys per frame, since a destroy can reach
`vkFreeMemory` and a streaming burst retires hundreds at once. Past a 512 item
backlog the cap is dropped, because at that point the backlog is itself VRAM the
frame is trying to allocate. `RHI/RetireBacklog` in Tracy is the number to watch:
a backlog that does not fall between frames means retires are outrunning
destroys.

Retires posted after `Core::Shutdown` destroy inline, since there are no frames
left to wait for.

### Transient memory

`RHI::Core::AllocTransient(Size, Alignment)` is a per-frame bump allocator over
CPU-write, device-addressable memory. It is thread safe (atomic bump) and valid
until its frame slot is reused. Each slot's slice resizes itself at `BeginFrame`:
it grows 1.5x when last frame's demand overflowed it, and shrinks back after 64
consecutive frames of using less than half.

```cpp
GPUPtr Args = RHI::Core::CopyTransient(MyPushConstants);
GPUPtr Data = RHI::Core::CopyTransientArray(Items.data(), Items.size());
```

This is the intended way to pass per-draw and per-pass data. **It is not for
geometry.** Vertex and index data belong in a persistent allocation. Pushing
megabytes of mesh data through the ring makes it grow to fit, and every slot pays
that size for the rest of the session.

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
void   HeapRepointTexture(FTextureHeapH Heap, uint32 Slot, FTextureH Texture);
void   HeapSetFallbackTexture(FTextureHeapH Heap, FTextureH Texture);
void   HeapUnbindTexture(FTextureHeapH Heap, uint32 Slot);
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

**Slot lifetime is the sharp edge**, in two ways.

A slot freed while a submitted command list still references it produces a
GPU-side read of a destroyed image. Retire heap slots
(`Core::RetireSampledSlot`, `Core::RetireStorageSlot`) rather than freeing them,
on the same schedule as the resources behind them.

When a resource is replaced rather than destroyed (a streamed texture changing
residency, for instance), **repoint the slot instead of freeing and reallocating
it**. `HeapRepointTexture` overwrites the descriptor in place, so every GPU
struct already holding that integer keeps working. Free plus realloc can hand the
same index back to something else, and any struct still carrying it then samples
the wrong image. `HeapUnbindTexture` points a slot at the heap's fallback texture
without releasing the index, which is how a slot stays valid while its contents
are temporarily gone.

Stock samplers are registered by `Core::Initialize` in a fixed order, exposed as
`EStockSampler`: `LinearWrap`, `LinearClamp`, `LinearMirror`, `PointWrap`,
`PointClamp`, `AnisoWrap`, `AnisoClamp`, `Shadow`, `MinReduction`,
`MaxReduction`, `PointMirror`, `AnisoMirror`. The slot index **is** the enum
value and `GlobalRHI.slang` hardcodes it, which is why the last two are appended
rather than grouped with their filter families. New entries go on the end, and
the `SAMPLER_*` constants have to move with them.

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
stage is optional, and in practice unused: the renderer always passes an empty
task source and culls in compute instead.

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

`RHI::Core` adds the frame-aware wrappers the engine actually calls:

```cpp
void        Core::Submit(FCmdListH CL);                  // graphics, bookkeeping included
uint64      Core::SubmitOn(EQueueType, TSpan<const FCmdListH>, TSpan<const FSemaphoreInfo> Waits = {});
FSemaphoreH Core::GetQueueTimeline(EQueueType Queue);
uint32      GetOpenCommandListCount(EQueueType Queue);
```

`SubmitOn` bumps that queue's counter, signals its timeline with the new value,
and returns it, which is what the retire fences and the frame slot waits are
built on. `GetOpenCommandListCount` reports lists opened and neither submitted
nor reset: a resource retired while that is non-zero may already be named by a
recording no queue counter accounts for yet, which is why a retire fence reaches
past the queue's current value.

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
`MeshShader`, and `AllCommands`. There is no task-stage flag, because there are
no task shaders.

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
| `TransferToCompute` | Uploads and clears before the cull dispatches and the geometry front end. |
| `ComputeToGeometry` | A cull dispatch before later dispatches, the mesh stage, and indirect fetch. |
| `ComputeToIndirect` | A dispatch that writes nothing but indirect arguments. |

The last three are narrow by design. Use one only where **every** reader of
**every** buffer the source wrote is inside the destination mask; otherwise take
the broad helper above it.

Queue ownership moves with a matching pair, `CmdReleaseImageToQueue` on the
source queue and `CmdAcquireImageFromQueue` on the destination. Both are required
for an exclusive resource crossing queue families.

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
void CreateDevice(const FDeviceDesc& Desc = {});   // bValidation, bDebugUtils, bHeadless
void FreeDevice();
void WaitDeviceIdle();
void RetireSlot(uint32 Slot);

FSurfaceH    CreateSurface(void* WindowHandle);      // MAIN THREAD ONLY
FSwapchainH  CreateSwapchain(FSurfaceH Surface, const FUIntVector2& Extent);
void         RecreateSwapchain(FSwapchainH Swapchain, const FUIntVector2& Extent);
FTextureH    AcquireNextImage(FSwapchainH Swapchain);   // invalid handle if out of date
bool         PresentSwapchain(FSwapchainH, FCmdListH Final, FSemaphoreH FrameSignal, uint64 Value);
void         SetPresentMode(EPresentMode) / EPresentMode GetPresentMode();
```

`CreateSurface` must be called on the thread that owns the window, because GLFW's
window calls are main-thread only. The handle is then passed to the render side,
where `CreateSwapchain` consumes it and takes ownership. `FreeH` on a surface is
only for the case where the window died before a swapchain was built.

`AcquireNextImage` returning an invalid handle means out of date; recreate the
swapchain and skip the frame.

`kFramesInFlight` is 2. The frame ring itself is driven by
`RHI::Core::BeginFrame(slot)`, described in
[Frame Pipeline](/internals/frame-pipeline/#frames-in-flight). `RetireSlot` is
the backend half of that drain and is not called directly.

`EPresentMode` is `Immediate`, `Mailbox`, or `FIFO`, declared in
`Renderer/PresentMode.h` so it can be a reflected settings property without
dragging a generated header into `RHI.h`. Setting it only records the choice;
the swapchain has to be rebuilt for it to apply, which
`CRendererSettings::ApplyPresentMode` does through
`FRenderManager::RecreatePrimarySwapchain`.

## Introspection

```cpp
FGPUDeviceInfo GetDeviceInfo();                  // name, API version string, vendor ID, discrete
void           GetGPUMemoryStats(FGPUMemoryStats& Out);
bool           SupportsAsyncCompute();
bool           SupportsAsyncTransfer();
uint32         GetMaxMeshWorkGroupCount();
bool           GetPipelineStatistics(FPipelineH, TVector<FPipelineStat>& Out);
ICrashTracker& GetCrashTracker();
void           HandleDeviceLost();

FString        DescribeDeviceAddress(uint64 AddressLow, uint64 AddressHigh);
bool           GetAllocationRange(GPUPtr Ptr, GPUPtr& OutBase, uint64& OutSize);
void           SetValidationHandler(FValidationHandlerFn Handler, void* UserData);

#if WITH_EDITOR
void           GetGPUAllocations(TVector<FGPUAllocation>& Out);
#endif
```

`FGPUMemoryStats` breaks down per heap: budget and usage as reported by the OS,
plus allocated and block bytes from the allocator. The gap between allocated and
block bytes is fragmentation and reserve. `bReBAR` marks a heap that is both
device local and host visible and larger than the legacy 256 MB BAR window.

Heap totals say how much VRAM is gone, never what took it. `GetGPUAllocations`
is the other half: one row per live allocation with the debug name its creating
site gave it, which is what the editor's Memory tool groups by. It takes the
allocator locks and copies the whole ledger, so it is a tool-rate call and never
a per-frame one. Editor builds only; game builds keep neither the names nor the
texture ledger.

`DescribeDeviceAddress` and `GetAllocationRange` resolve a raw device address,
including an interior one, back to the allocation that owns it. That is what
turns a device-fault address range into a named buffer. `SetValidationHandler`
installs an observer on the debug-utils messenger, in addition to the log; it
must be set before `CreateDevice` and fires on whichever thread the driver
reports on.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| GPU reads garbage from a buffer freed last frame | `RHI::Free` instead of `Core::Retire`. |
| Validation error about a destroyed image still in a descriptor | A heap slot was freed instead of retired, before the frames referencing it drained. |
| A struct samples the wrong texture after a streaming change | The heap slot was freed and reallocated instead of repointed. |
| `RHI/RetireBacklog` climbs and never falls | Retires are outrunning the metered drain. Something is churning GPU resources per frame. |
| Frame-long stall after a one-off submit | `WaitDeviceIdle` used where `SubmitAndWait` was meant. |
| Transient allocation failure mid-frame | Geometry or large buffers pushed through the transient ring. |
| Crash creating a surface | `CreateSurface` called off the main thread. |
| Startup aborts with "Vulkan Device Unsuitable" | The GPU is below the [mesh shader requirement](#mesh-shaders-are-required). |
| Write-after-write hazard between two copies | Missing `Barriers::TransferToTransfer` between them. |
| Transfer-queue work appears to run in lockstep with graphics | `SupportsAsyncTransfer()` is false, so the queue aliases graphics. |
