---
title: Vulkan Backend
description: Device creation, queues, memory, descriptors, swapchain, and GPU crash handling.
---

`Engine/Source/Runtime/Renderer/API/Vulkan/VulkanRHI.cpp` is the only backend.
It is a single large translation unit implementing every `Lumina::RHI` free
function against Vulkan **1.4**.

The engine **requires Vulkan 1.4**. Device selection rejects any physical device
reporting `apiVersion < VK_API_VERSION_1_4` with an explicit error dialog rather
than failing later in a confusing way.

## Loader

**volk** is the loader. `volkInitialize()` runs before anything else; a failure
there means the Vulkan runtime is missing or corrupted, and the engine reports
that directly. `volkLoadInstance` and `volkLoadDevice` are called after instance
and device creation respectively. `VK_NO_PROTOTYPES` is defined for the Runtime
module, so there are no statically linked Vulkan symbols at all.

## Instance

- `apiVersion = VK_API_VERSION_1_4`.
- `VK_EXT_debug_utils` is added when debug utils are enabled (every
  non-Shipping build).
- Requested instance extensions are filtered against what the loader actually
  advertises, so an unavailable request can never make `vkCreateInstance` fail.
- Validation is compiled in through `LUMINA_WITH_VALIDATION` and passed as
  `FDeviceDesc::bValidation`.
- The debug messenger deliberately omits `DEVICE_ADDRESS_BINDING_BIT`, because
  that message type requires the `VK_EXT_device_address_binding_report` device
  extension and feature, and requesting it without them makes instance creation
  reject the message type as invalid.

## Device features

Enabled unconditionally (these are the engine's baseline; a device without them
will not run):

**Core 1.0**: `fragmentStoresAndAtomics`, `samplerAnisotropy`,
`sampleRateShading`, `fillModeNonSolid`, `imageCubeArray`, `multiViewport`,
`multiDrawIndirect`, `shaderStorageImageWriteWithoutFormat`,
`shaderStorageImageReadWithoutFormat`, `shaderStorageImageExtendedFormats`,
`drawIndirectFirstInstance`, `vertexPipelineStoresAndAtomics`, `shaderInt16`,
`shaderInt64`, `independentBlend`, `pipelineStatisticsQuery`.

**1.1**: `shaderDrawParameters`, `multiview`.

**1.2**: `timelineSemaphore`, `bufferDeviceAddress`, `descriptorIndexing`,
`descriptorBindingPartiallyBound`, `runtimeDescriptorArray`,
`samplerFilterMinmax`, `shaderInt8`, `shaderFloat16`, plus update-after-bind for
sampled images, storage images, uniform buffers, and storage buffers, and
`descriptorBindingUpdateUnusedWhilePending`.

**1.3**: `dynamicRendering`, `synchronization2`.

Conditionally enabled from device support: `wideLines`, `geometryShader`,
`smoothLines` (1.4).

`geometryShader` is enabled even though no geometry stage exists. The VisBuffer
mesh-shader fragment reads `SV_PrimitiveID`, and Slang emits the SPIR-V
`Geometry` capability for that builtin because it has no `MeshShadingEXT`
lowering for it. Every mesh-shader-capable GPU supports the feature anyway.

## Optional extensions

Everything past `VK_KHR_swapchain` is enabled only if the driver advertises it,
through an `EnableIfPresent` helper, so the engine degrades instead of failing.

| Extension | Used for |
| --- | --- |
| `VK_KHR_swapchain` | Required. Absence aborts with a message. |
| `VK_EXT_sampler_filter_minmax` | Min and max reduction samplers (depth pyramid). |
| `VK_KHR_shader_non_semantic_info` | AMD rejects non-semantic SPIR-V without an explicit enable even though it is core in 1.3. |
| `VK_NV_device_diagnostics_config` | Nsight Aftermath. NVIDIA only; AMD and Intel skip the diagnostics `pNext`. |
| `VK_EXT_device_fault` | Vendor-agnostic fault info on `VK_ERROR_DEVICE_LOST`. |
| `VK_KHR_unified_image_layouts` | Removes most layout transition bookkeeping. |
| `VK_EXT_memory_priority` plus `VK_EXT_pageable_device_local_memory` | VMA allocation priority and pageable device-local memory. |
| `VK_EXT_mesh_shader` | Required. See below. Absence aborts with a message. |

`VK_EXT_mesh_shader` sits in this table because it goes through the same
`EnableIfPresent` path, but it is **not optional**. It is the only geometry path
the renderer has. Device selection aborts when the extension is missing, when the
`meshShader` feature is false, or when any of these limits comes up short:

| Limit | Minimum | Comes from |
| --- | --- | --- |
| `maxMeshWorkGroupSize[0]`, `maxMeshWorkGroupInvocations` | 32 | `MESHLET_MESH_GROUP_SIZE` |
| `maxMeshOutputVertices` | 64 | `MESHLET_MAX_VERTICES` |
| `maxMeshOutputPrimitives` | 64 | `MESHLET_MAX_TRIANGLES` |
| `maxTaskWorkGroupSize[0]`, `maxTaskWorkGroupInvocations` | 32 | `MeshletCullTask.slang` workgroup size |
| `maxTaskPayloadSize`, `maxTaskPayloadAndSharedMemorySize` | 4096 | `kMaxTaskPayloadBytes` |

The dialog names which of the three checks failed and which hardware generations
qualify, because "device unsuitable" on its own sends people to the wrong place.
The measured limits are also logged on every successful startup, which is the
fastest way to tell a driver problem from a hardware one.

`VK_KHR_unified_image_layouts` is additionally gated on the **validation layer
version**: it is only enabled when no validation layer is present or the layer is
at least 1.4.311, because older layers do not understand the extension and
produce a flood of false positives.

Plugins can request extra device extensions through
`Native::FDeviceCreationRequest` (`Renderer/RHINative.h`); requests are enabled
only if the driver advertises them and they are not already in the list. This is
how the Nsight Perf plugin gets what it needs without the core engine knowing
about it.

## Queues

Three logical queues (`Graphics`, `Compute`, `Transfer`) are resolved from the
device's queue families. **Aliasing is expected**: if there is no dedicated
compute or transfer family, both fall back to the graphics queue and share its
family index. Backend code must not assume a submission on the transfer queue
runs concurrently with graphics work. `RHI::SupportsAsyncCompute()` and
`RHI::SupportsAsyncTransfer()` report whether a given queue is real, and callers
that care about overlap are expected to ask.

This is a common source of vendor-specific bugs: on a device where the transfer
queue aliases graphics, an ordering mistake between the two is invisible, and the
same build faults on a device that has a dedicated transfer family.

`RHINative.h` exposes the graphics queue and its family index to native-access
clients (ImGui backends, capture tools).

## Memory

**Vulkan Memory Allocator** backs every allocation, created with
`vulkanApiVersion = VK_API_VERSION_1_4` and with `VK_EXT_memory_priority`
enabled when available.

- `RHI::Malloc` creates a buffer through `vmaCreateBufferWithAlignment` and
  immediately queries `vkGetBufferDeviceAddress`. That address is the `GPUPtr`
  the rest of the engine passes around. **There is no buffer object exposed
  above the backend.**
- `RHI::CreateTexture` uses `vmaCreateImage`.
- Allocations above 32 MB (`kDedicatedMemoryThreshold`) become dedicated
  allocations.
- Uploads use a dedicated TLSF pool so staging traffic does not fragment the
  general heap.

`GetGPUMemoryStats` walks VMA's per-heap budget and usage. `AllocatedBytes` is
what the allocator handed out; `BlockBytes` is what it reserved from the driver.
The gap is fragmentation plus reserve. `bReBAR` marks a heap that is both device
local and host visible and larger than the legacy 256 MB BAR window, which is
what lets the engine write directly into VRAM.

### Deferred frees

Freed memory is retired only after every in-flight frame that could reference it
has completed. The backend keeps a pending list keyed on frame number and
releases entries once `Frame - Pending.Frame > kFramesInFlight`.

### The upload ring

`Renderer/RHIUpload.h` is the batched upload path.

```cpp
Upload::UploadBuffer(Dest, Data, Size);
Upload::UploadTexture(Dest, Mip, Data, Size, RowPitchTexels);
Upload::UploadClearTexture(Dest, ClearValue);
```

Callers stage bytes into a per-frame CPU-write linear ring and return
immediately. Every queued copy is recorded once at the next
`RHI::Core::BeginFrame`, followed by a single `Transfer -> All` barrier. That
replaces the old pattern of one staging allocation, one submit, and one fence
block per upload.

Two behaviors to be aware of:

- If the destination is host visible, `UploadBuffer` writes through immediately
  and queues nothing.
- An upload becomes resident **at the next `BeginFrame` flush**. Data that must
  be resident before its first use (boot placeholders, stock LUTs) has to use
  `Upload::FlushUploadsAndWait()`, which restores the synchronous guarantee.

All three staging calls are thread safe.

## Descriptors

There is one descriptor set layout, used as a bindless heap:

| Binding | Contents |
| --- | --- |
| 0 | Samplers |
| 1 | Sampled images |
| 2 | Storage images |

The heap uses `descriptorIndexing` with partially bound, update-after-bind,
and `runtimeDescriptorArray`. Writing a texture into the heap returns its array
index; shaders index the array with that integer. No per-draw descriptor sets are
allocated, and `CmdSetTextureHeap` binds the one set.

Everything else a shader needs (buffers, per-draw constants) arrives as a device
address in a push constant, which is why `GPUPtr DrawArgs` is a parameter on
every draw call.

## Dynamic rendering

There are no `VkRenderPass` or `VkFramebuffer` objects.
`RHI::CmdBeginRenderPass` maps to `vkCmdBeginRendering` with the attachment
descriptions built from `FRenderPassDesc`. Pipelines carry attachment formats in
`FRasterDesc` instead of a render pass handle.

Barriers use `synchronization2` (`vkCmdPipelineBarrier2`) and submissions use
`vkQueueSubmit2`.

## Reverse-Z

Depth is reverse-Z throughout: depth clears to **0.0** and comparisons use
`EOp::Greater` or `GreaterEqual`. This gives much better depth precision across
the view range with a floating-point depth buffer. Any new pass that writes or
tests depth must follow the same convention, or it will z-fight against
everything else.

The projection matrix also bakes the Vulkan Y flip, which is why the scene
renderer sets `CmdSetFrontFace(CL, EFrontFace::CW)`: counter-clockwise wound
geometry lands clockwise in framebuffer space.

## Swapchain and presentation

- Image count is `max(kFramesInFlight, minImageCount)`.
- **Binary** semaphores handle acquire and present: an acquire semaphore ring
  (at least `kFramesInFlight` entries, cycled per acquire) and one present
  semaphore per swapchain image, indexed by the acquired image.
- Frame pacing uses a **timeline** semaphore, not the binary ones.
  `RHI::Core::BeginFrame(slot)` waits the frame timeline value for that slot,
  which is what makes recycling that slot's command lists and transient ring
  slice safe.
- `AcquireNextImage` returns an invalid handle when the swapchain is out of date.
  The caller recreates and skips the frame.
- `CmdSwapchainBarrierToRender` transitions the acquired image for rendering;
  `Present` records the transition to present, submits with the acquire wait and
  present signal, and calls `vkQueuePresentKHR` on the graphics queue.

## GPU crash handling

`Renderer/ErrorHandling/Vulkan` implements an `ICrashTracker`.

- **`VK_EXT_device_fault`** gives vendor-agnostic fault information on
  `VK_ERROR_DEVICE_LOST`: the address ranges and, where the driver provides it,
  the offending vendor-specific info.
- **Nsight Aftermath** is wired through `VK_NV_device_diagnostics_config` on
  NVIDIA. The Aftermath DLL is declared a runtime dependency in
  `NvidiaAftermath.Build.cs` and copied next to the executable by the build tool.
- **Debug markers** (`CmdBeginMarker` / `CmdEndMarker`) name every pass, so a
  crash dump points at a pass rather than an opaque command buffer offset. An
  unbalanced marker corrupts the label stack for the rest of the frame, so every
  `Begin` needs its `End` on every path, including early returns.
- `RHI::HandleDeviceLost()` is the entry point that dumps everything the tracker
  collected.

Shader debug information is raised to `STANDARD` on non-AMD, non-Shipping builds,
so Nsight can do source-level debugging. It is deliberately left lower on AMD,
where the extra debug info triggered driver problems.

## Native access escape hatch

`Renderer/RHINative.h` exposes the raw Vulkan handles (instance, physical device,
device, graphics queue and family, `vkGetInstanceProcAddr`) for code that has to
talk to Vulkan directly: the ImGui backend, RenderDoc integration, and profiling
plugins. It also carries the device-creation request mechanism described above.

Use it sparingly. Anything that goes around the RHI also goes around its
deferred-free, barrier, and frame-pacing guarantees.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Startup error about Vulkan 1.4 | The driver or the selected GPU does not report 1.4. Update drivers. |
| Flood of validation errors about image layouts | An old validation layer with `VK_KHR_unified_image_layouts` enabled. The version gate should prevent this; check the layer version. |
| Z-fighting in a new pass | The pass used a standard depth comparison instead of reverse-Z. |
| Geometry disappears in a new pass | Front face not set to `CW`, or the winding assumption differs from the rest of the renderer. |
| `VK_ERROR_DEVICE_LOST` with no useful information | `VK_EXT_device_fault` is not available on this driver. Try an Aftermath-enabled NVIDIA build. |
| Corrupted debug marker labels | An unbalanced `CmdBeginMarker` on an early-return path. |
| Uploaded texture is black on its first use | The upload had not flushed yet. Use `FlushUploadsAndWait` for data needed immediately. |
