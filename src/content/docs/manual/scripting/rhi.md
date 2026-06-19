---
title: Low-Level Rendering (RHI)
description: "Drive the GPU directly from C# with the engine's Render Hardware Interface: compute dispatch, custom textures, and the bindless heap."
---

The **Render Hardware Interface (RHI)** is the engine's thin abstraction over
Vulkan: memory, textures, pipelines, command lists, and submission. The whole
RHI is exposed to C# as a direct, 1:1 binding, so a script can allocate GPU
memory, build a pipeline, record commands, and dispatch work on the GPU.

This is the lowest-level surface in the scripting API. Every call is a thin
pointer into the matching native function, handles and descriptors cross the
boundary by value with no marshalling, and the command recorders skip the GC
transition, so the C# RHI runs at the speed of the C++ RHI.

:::caution[This is an advanced, explicit API]
Almost all rendering in Lumina is data-driven: you author **materials**,
**lights**, and **post-process** settings as assets and components, and the
renderer does the rest (see [Rendering](/manual/rendering/)). Reach for the RHI
only when you need to run your own GPU work, for example a custom compute pass,
a procedural texture, or a bespoke visualization. The RHI gives you no safety
net: you manage memory, barriers, and lifetime yourself, exactly as in C++.
:::

## What you drive, and what the engine owns

The RHI surface in C# is deliberately scoped to the operations a script may
safely perform. The **device**, the **per-frame loop**, and the **window
swapchain** are owned by the engine and are not on this surface. There is no
device create or destroy, no frame tick, no present, and no device-wide stall.
A script creates resources, records and submits work, and waits on **its own**
submissions with a timeline semaphore.

| You drive | The engine owns |
| --- | --- |
| GPU memory, textures, pipelines, semaphores, the bindless heap | The GPU device (create, destroy) |
| Command list recording and submission | The per-frame loop and frame pacing |
| Barriers and per-submission synchronization | The window swapchain and present |
| Device and memory introspection | Vsync and the backbuffer |

## The two classes

Everything lives in the `LuminaSharp.Rendering` namespace, across two static
classes.

- **`RHI`** is the core surface: memory, resources, the texture heap, command
  lists, submission, the `Cmd*` recorders, and introspection. Call sites read
  `RHI.Malloc(...)`, `RHI.CreateTexture(...)`, `RHI.CmdDispatch(...)`, mirroring
  the C++ `RHI::` functions.
- **`RHICore`** is the runtime support layer: the global texture and sampler
  heap, the per-frame transient ring, deferred frees, and pipeline creation from
  the engine shader library by name.

```csharp
using LuminaSharp.Rendering;
```

## Resource handles

Resources are referenced by opaque handles, not objects. Each handle
(`FTextureH`, `FPipelineH`, `FTextureHeapH`, `FSemaphoreH`, `FDepthStencilH`,
`FCmdListH`) is a single 8-byte value you copy freely. A handle is just a
number, so pass it around as you like.

```csharp
FTextureH Texture = RHI.CreateTexture(Desc);
if (Texture.IsValid)   // zero is the invalid handle
{
    // ...
    RHI.FreeH(Texture);   // you free what you create
}
```

`FreeH` is overloaded for every handle type. **You own the lifetime of anything
you create**, so free it when you are done, the same as `delete` in C++.

## GPU memory

`GPUPtr` is a device-addressable GPU memory pointer (a 64-bit device address).
Allocate it with `RHI.Malloc`, map it to a CPU address with `RHI.ToHost`, and
release it with `RHI.Free`. `GPUPtr` supports byte-offset arithmetic, and zero
is the null pointer.

```csharp
GPUPtr Buffer = RHI.Malloc(1024, EMemoryType.CPUWrite);

unsafe
{
    float* Cpu = (float*)RHI.ToHost(Buffer);   // CPU-visible address
    Cpu[0] = 1.0f;
}

RHI.Free(Buffer);
```

The memory type decides where the allocation lives. Both CPU-visible types are
mapped and **fully readable and writable from the CPU**: the name is a hint about
the dominant access pattern, not a restriction.

| `EMemoryType` | CPU access | Tuned for | `ToHost` mappable |
| --- | --- | --- | --- |
| `CPUWrite` (default) | Read **and** write | CPU writes and fast GPU reads (uploads, args). Lives in device-local ReBAR memory, so CPU reads work but are slow (uncached). | Yes |
| `CPURead` | Read **and** write | CPU readback. Lives in cached host memory, so CPU reads are fast; the GPU reaches it across PCIe. | Yes |
| `GPUOnly` | None | GPU-only working data. Fastest for the GPU, device-local, not mapped. | No |

`Malloc(Size)` defaults to 16-byte aligned `CPUWrite`, which is **read and
write**: you can both fill it from the CPU and read it back, so the default is a
fine choice when you do not want to think about the distinction. The memory type
and alignment are optional arguments, so pass `Malloc(Size, EMemoryType.CPURead)`
when the CPU reads a lot of GPU-produced data and you want those reads cached, or
give an explicit alignment with `Malloc(Size, alignment, type)`. Calling `ToHost`
on `GPUOnly` memory is invalid: to fill device-local memory, upload through a
CPU-visible staging allocation and a copy command.

:::note[Device addresses are the GPU pointers]
A `GPUPtr` is a real GPU device address. When a shader reads a buffer through a
pointer field, the value you store is simply the buffer's `GPUPtr`. This is how
the engine binds buffers: by address, not by descriptor slot. There is no buffer
object and no binding step for raw memory.
:::

## How a shader reads its arguments

The RHI uses a single, uniform argument model for every draw and dispatch. Each
command takes one `GPUPtr` (named `DrawArgs`) that points at a small struct in
GPU memory. The engine binds that pointer as the shader's only push constant,
and the shader reads it back with `GetArgs<T>()`.

In a shader (`.slang`), include the RHI conventions and declare the args struct:

```hlsl
#include "Includes/GlobalRHI.slang"

struct FMyArgs
{
    float* Input;     // a GPU device address (a buffer)
    float* Output;
    uint   Count;
};

// GetArgs<T>() returns the struct the dispatch pointed at.
FMyArgs* Args = GetArgs<FMyArgs>();
```

On the C# side you build a byte-identical struct, fill it (including the device
addresses of any buffers it references), and pass its `GPUPtr` to the dispatch
or draw call. The fields line up by offset, so a shader `float*` matches a C#
`GPUPtr`, and a shader `uint` matches a C# `uint`.

This is the same args model the engine's own passes use, so anything you can
express in an engine shader works identically from a script.

## The bindless texture heap

Textures and samplers are not bound one at a time. They live in a single global
**bindless heap**, and a shader indexes them by an integer slot. `RHICore`
exposes the engine's global heap:

```csharp
FTextureHeapH Heap = RHICore.GetGlobalHeap();

uint TexSlot = RHI.HeapWriteTexture(Heap, Texture);        // sampled-image slot
uint UavSlot = RHI.HeapWriteRWTexture(Heap, Texture, 0);   // storage-image slot (mip 0)
uint SmpSlot = RHI.HeapWriteSampler(Heap, FSamplerDesc.LinearWrap);
```

Each `HeapWrite*` returns the slot index. You pass that integer to your shader
(through the args struct), and the shader reads the resource from the matching
global array:

```hlsl
float4 Color = SampleTexture2D(Args.TexSlot, SAMPLER_LINEAR_WRAP, UV);
gRWTextures2D[Args.UavSlot][Texel] = Color;
```

Release a slot with `HeapFreeTexture`, `HeapFreeRWTexture`, or
`HeapFreeSampler` when the resource goes away. The global heap is pre-populated
with a set of stock samplers, so most shaders never create their own:

| Stock sampler slot | Constant in `GlobalRHI.slang` |
| --- | --- |
| 0 | `SAMPLER_LINEAR_WRAP` |
| 1 | `SAMPLER_LINEAR_CLAMP` |
| 2 | `SAMPLER_LINEAR_MIRROR` |
| 3 | `SAMPLER_POINT_WRAP` |
| 4 | `SAMPLER_POINT_CLAMP` |
| 5 | `SAMPLER_ANISO_WRAP` |
| 6 | `SAMPLER_ANISO_CLAMP` |

For a compute pass that uses the heap, bind it once on the command list with
`RHI.CmdSetTextureHeap(CL, Heap)` before dispatching.

## Command lists, queues, and submission

GPU work is recorded into a command list and then submitted to a queue. Open a
list with `RHI.OpenCommandList`, record `Cmd*` calls into it, and submit it.

```csharp
FCmdListH CL = RHI.OpenCommandList(EQueueType.Compute);
RHI.CmdSetPipeline(CL, Pipeline);
RHI.CmdDispatch(CL, ArgsPtr, GroupsX, 1, 1);
RHI.Submit(CL, EQueueType.Compute);
```

There are three queues, selected by `EQueueType`: `Graphics` (the default),
`Compute`, and `Transfer`. Command-list recording is **per-thread and
lock-free**, so you can build lists on worker threads; creation and submission
are the synchronized operations.

To wait for work to finish, signal a **timeline semaphore** on submit and wait
on it. A timeline semaphore is a monotonically increasing 64-bit counter:
`RHI.CreateSemaphore(start)` makes one, the submit signals it to a value, and
`RHI.WaitSemaphore(sem, value)` blocks the calling thread until the GPU reaches
that value.

```csharp
FSemaphoreH Done = RHI.CreateSemaphore(0);

FSemaphoreInfo[] Signal = { new FSemaphoreInfo(Done, 1, EStageFlags.Compute) };
RHI.Submit(EQueueType.Compute, new[] { CL }, default, Signal);

RHI.WaitSemaphore(Done, 1);   // block until the GPU signals 1
RHI.FreeH(Done);
```

The same overload takes a span of waits, so one submission can wait on
another's semaphore to chain passes across queues.

## Barriers

The GPU runs work out of order unless you tell it not to. A **barrier** orders
one set of pipeline stages before another so that writes are visible to later
reads. Record one with `RHI.CmdBarrier(CL, before, after)` using `EStageFlags`,
or use the named helpers in `RHI.Barriers` for the common cases.

| Helper | Orders |
| --- | --- |
| `RHI.Barriers.ComputeToAll(CL)` | Compute writes before any later stage reads them. |
| `RHI.Barriers.RasterToRead(CL)` | Color or depth output before a later sample. |
| `RHI.Barriers.RasterToRaster(CL)` | One raster pass before the next. |
| `RHI.Barriers.AllToTransfer(CL)` / `TransferToAll(CL)` | Around a copy or blit. |

To read GPU results back on the CPU, barrier from the producing stage to
`EStageFlags.Host`:

```csharp
RHI.CmdBarrier(CL, EStageFlags.Compute, EStageFlags.Host);
```

## Worked example: dispatch a compute shader and read back the results

This runs a compute shader that doubles every number in a buffer, then reads the
results back to the CPU. It is the smallest end-to-end RHI program: a pipeline,
two buffers, an args struct, a dispatch, and a semaphore wait.

### The shader

Place a `DoubleNumbers.slang` in the engine shaders directory so the shader
library can compile it by name. The args struct holds the two buffer addresses
and the element count.

```hlsl
#include "Includes/GlobalRHI.slang"

struct FDoubleArgs
{
    float* Input;
    float* Output;
    uint   Count;
};

[shader("compute")]
[numthreads(64, 1, 1)]
void ComputeMain(uint3 Tid : SV_DispatchThreadID)
{
    FDoubleArgs* Args = GetArgs<FDoubleArgs>();

    uint Index = Tid.x;
    if (Index >= Args.Count)
        return;

    Args.Output[Index] = Args.Input[Index] * 2.0;
}
```

### The script

The C# `DoubleArgs` struct mirrors the shader struct field for field. A shader
`float*` is a device address, so it maps to a C# `GPUPtr`.

```csharp
using System.Runtime.InteropServices;
using LuminaSharp.Rendering;

[StructLayout(LayoutKind.Sequential)]
struct DoubleArgs
{
    public GPUPtr Input;
    public GPUPtr Output;
    public uint   Count;
}

public static unsafe float[] DoubleOnGPU(float[] Values)
{
    int Count = Values.Length;
    ulong Bytes = (ulong)(Count * sizeof(float));

    // 1. Pipeline, compiled and cached from the engine shader library by name.
    FPipelineH Pipeline = RHICore.CreateComputePipeline("DoubleNumbers.slang");

    // 2. Buffers. Both are CPU-visible (read + write). CPUWrite is the default,
    //    tuned for CPU writes and fast GPU reads; CPURead is tuned for the CPU
    //    reading the GPU's results back (cached reads). Either type can do both.
    GPUPtr Input  = RHI.Malloc(Bytes, EMemoryType.CPUWrite);
    GPUPtr Output = RHI.Malloc(Bytes, EMemoryType.CPURead);

    // Fill the input from the managed array.
    float* In = (float*)RHI.ToHost(Input);
    for (int i = 0; i < Count; i++)
    {
        In[i] = Values[i];
    }

    // 3. Args struct in GPU memory, holding the two buffer addresses + the count.
    //    No type given, so this uses the default: CPUWrite, which is read + write.
    GPUPtr ArgsMem = RHI.Malloc((ulong)sizeof(DoubleArgs));
    DoubleArgs* Args = (DoubleArgs*)RHI.ToHost(ArgsMem);
    Args->Input  = Input;
    Args->Output = Output;
    Args->Count  = (uint)Count;

    // 4. Record: bind the global heap (every pipeline's layout includes it),
    //    set the pipeline, dispatch one thread per element (64 per group),
    //    then barrier the compute writes so the CPU can read them.
    FCmdListH CL = RHI.OpenCommandList(EQueueType.Compute);
    RHI.CmdSetTextureHeap(CL, RHICore.GetGlobalHeap());
    RHI.CmdSetPipeline(CL, Pipeline);
    RHI.CmdDispatch(CL, ArgsMem, (uint)((Count + 63) / 64), 1, 1);
    RHI.CmdBarrier(CL, EStageFlags.Compute, EStageFlags.Host);

    // 5. Submit, signalling a timeline semaphore, then wait for the GPU.
    FSemaphoreH Done = RHI.CreateSemaphore(0);
    FSemaphoreInfo[] Signal = { new FSemaphoreInfo(Done, 1, EStageFlags.Compute) };
    RHI.Submit(EQueueType.Compute, new[] { CL }, default, Signal);
    RHI.WaitSemaphore(Done, 1);

    // 6. Read the results back.
    float[] Result = new float[Count];
    float* Out = (float*)RHI.ToHost(Output);
    for (int i = 0; i < Count; i++)
    {
        Result[i] = Out[i];   // Values[i] * 2
    }

    // 7. Release everything this function created.
    RHI.Free(Input);
    RHI.Free(Output);
    RHI.Free(ArgsMem);
    RHI.FreeH(Pipeline);
    RHI.FreeH(Done);

    return Result;
}
```

That is the full pattern. Every other RHI workload is a variation on it: more
buffers, a graphics pipeline and a render pass instead of a dispatch, or the
results left on the GPU (in `GPUOnly` memory) for a later pass to consume rather
than read back.

:::note[For repeated, per-frame work]
This example creates and frees everything for a single run, which is right for a
one-shot job. For work you do every frame, create the pipeline and any
persistent buffers once (in `OnReady`) and reuse them, and use
`RHICore.AllocTransient` for the small per-dispatch args so you are not calling
`Malloc` and `Free` on the hot path.
:::

## Pipelines

A pipeline is the compiled shader plus its fixed-function state. Build a compute
or graphics pipeline one of two ways.

**By name, from the engine shader library** (the path the example uses). The
engine compiles the named `.slang` through its Slang pipeline and caches the
result, so this is the simplest path for shaders the engine knows about.

```csharp
FPipelineH Compute  = RHICore.CreateComputePipeline("DoubleNumbers.slang");
FPipelineH Graphics = RHICore.CreateGraphicsPipeline(
    "MyVertex.slang", "MyPixel.slang", FRasterDesc.Default, ColorTargets);
```

**From compiled bytecode**, when you have precompiled SPIR-V to hand. `RHI`
takes the bytecode and the entry-point name directly:

```csharp
FPipelineH Pipeline = RHI.CreateComputePipeline(SpirvBytes, "ComputeMain", default);
```

Both compute overloads accept a span of `FSpecializationConstant`, which bakes
constants into the shader at pipeline-build time (a loop count, a feature
toggle) so the compiler can fold them. Build them with the typed helpers:

```csharp
FSpecializationConstant[] Constants =
{
    FSpecializationConstant.UInt(0, 256),
    FSpecializationConstant.Bool(1, true),
};
```

Free a pipeline with `RHI.FreeH(Pipeline)` when you are done with it.

## Textures

Create a texture from an `FTextureDesc`. The `Texture2D` helper fills the common
case; set the `EImageUsageFlags` for how the texture will be used.

```csharp
FTextureH Target = RHI.CreateTexture(
    FTextureDesc.Texture2D(512, 512, EFormat.RGBA16_FLOAT,
        EImageUsageFlags.Storage | EImageUsageFlags.Sampled));
```

| `EImageUsageFlags` | Allows |
| --- | --- |
| `Sampled` | Sampling in a shader (a heap sampled slot). |
| `Storage` | Read/write in a shader (a heap storage slot). |
| `ColorAttachment` / `DepthAttachment` | Rendering into it in a render pass. |
| `TransferSrc` / `TransferDst` | Copy and blit source or destination. |

To use a texture in a shader, register it in the bindless heap (above) and pass
the returned slot through your args. To render into one, list it as an
attachment in `RHI.CmdBeginRenderPass`. `RHI.CreateTexture(Desc)` lets the engine
manage the backing memory; the overload taking a `GPUPtr` places the texture on
memory you allocated.

## Per-frame transient memory

For small, short-lived per-frame data (args structs, a handful of constants),
`RHICore.AllocTransient` hands out CPU-writable, device-addressable memory from a
ring that the engine recycles automatically each frame. It returns both the CPU
pointer and the `GPUPtr`, so there is nothing to map and nothing to free.

```csharp
FTransientAlloc Alloc = RHICore.AllocTransient((ulong)sizeof(DoubleArgs));
unsafe
{
    DoubleArgs* Args = (DoubleArgs*)Alloc.Cpu;
    Args->Count = 256;
    // ...
}
RHI.CmdDispatch(CL, Alloc.Gpu, Groups, 1, 1);
```

The allocation is valid until its frame slot recycles, so use it within the
frame and never hold it across frames. To free a longer-lived allocation safely
once every in-flight frame has retired, use `RHICore.DeferredFree(memory)`
instead of `RHI.Free`.

## Inspecting the device

The RHI can report what GPU it is running on and how much memory is in use,
which is handy for diagnostics and for sizing allocations.

```csharp
GPUDeviceInfo Info = RHI.GetDeviceInfo();
// Info.Name "NVIDIA GeForce RTX 4080", Info.APIName "Vulkan 1.4.x", Info.IsDiscrete

var (Totals, Heaps) = RHI.GetGPUMemoryStats();
// Totals.TotalUsage / Totals.TotalBudget, plus per-heap detail in Heaps
```

## Custom draws and the deferred renderer

Lumina's renderer is deferred at the frame level. Gameplay runs first, across the
update stages (frame start, pre-physics, physics, post-physics, frame end). Only
at the **end** of the frame does the renderer gather (extract) the scene's state
and submit it, and it owns the scene's render targets and the final present to
the window. Every script has already run by the time the scene is drawn.

That ordering shapes what a script can and cannot do with the RHI.

**You can run independent GPU work.** Anything self-contained, a compute pass, a
copy or blit, or a render pass into a texture you created, works from a script.
You open a command list, record, submit to a queue, and wait on your own
semaphore (the compute example above). It runs as its own GPU submission, on your
schedule. This is the intended use of the RHI: GPU computation and offscreen work
whose results you own.

**You cannot inject a draw into the scene's view.** There is no render-extension
or custom-pass hook in the renderer today, and the scene's color and depth
targets, plus the swapchain, are engine-owned and assembled at frame end after
every script has run. A command list you submit is its own GPU work; it is not
composited into the scene image, and you cannot draw to the backbuffer. Issuing
"my own draw call into the world", the way you would inside an engine render
pass, is not possible from a script right now.

To put custom visuals in the world, use the channels that are wired into the
renderer:

- For lines, shapes, and text, **`World.Draw`** (debug drawing) feeds the
  engine's own debug pass and shows up in the view. See
  [The World API](/manual/scripting/world/). (Dev and Debug builds.)
- For anything heavier, treat the RHI as a producer: compute or render into a
  texture or buffer you own, then surface that result wherever the engine already
  lets you reference one. The RHI makes the data; the engine still owns
  compositing it into the final image.

A general "render into the scene view" extension point (a custom pass or view
extension) is a future addition, not something the current API exposes.

## Threading and lifetime, in short

- **Free what you create.** Handles and `GPUPtr` are not garbage collected.
  Every `Create*`, `Malloc`, and `HeapWrite*` has a matching free.
- **Record per-thread, submit synchronized.** Build command lists on any thread,
  including [worker threads](/manual/scripting/tasks/). Submission and resource
  creation are the synchronized points.
- **Synchronize your own work.** Wait on a timeline semaphore you signalled, not
  on the device. The device and the frame loop belong to the engine.
- **Barrier between dependent stages.** The GPU will not order a write before a
  read for you.

If you are doing heavy CPU-side compute rather than GPU work, see
[Parallel Work](/manual/scripting/tasks/). For the high-level, data-driven
renderer that most projects use, see [Rendering](/manual/rendering/).
