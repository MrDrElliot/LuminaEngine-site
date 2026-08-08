---
title: Meshlet Pipeline
description: "How geometry reaches the screen: the retained scene, the GPU cull chain, render buckets, and the task/mesh stages."
---

Every mesh in Lumina is drawn by mesh and task shaders. There is no vertex and index path, no fallback,
and no CPU-side per-draw gather. This page follows one frame from the retained scene to a rasterized
triangle, and explains why each stage is shaped the way it is.

See [RHI](/internals/rhi/) for the hardware requirement and [Render Passes](/internals/render-passes/) for
where this sits in the frame.

## The unit of work

A **meshlet** is 64 vertices and 64 triangles. Positions are quantized (24-bit anchor plus a shared
exponent and three 16-bit offsets), normals are three SNorm16, and the triangle list is one packed dword
per triangle holding three 8-bit local indices.

64/64 is a deliberate compromise. meshoptimizer's own guidance favors more triangles than vertices, but an
equal count means the mesh workgroup can process one vertex and one triangle per lane per iteration with a
single loop shape, and the survivor bitmask fits two 32-bit words. The cost is roughly twice as many
meshlets per mesh as a 64/124 build, which is more cull granularity but more per-meshlet overhead.

| Constant | Value | Where |
| --- | --- | --- |
| `MESHLET_MAX_VERTICES` | 64 | `Shared/SharedConstants.h` |
| `MESHLET_MAX_TRIANGLES` | 64 | same |
| `MESHLET_TASK_GROUP_SIZE` | 32 | task workgroup, also meshlets per block |
| `MESHLET_MESH_GROUP_SIZE` | 32 | mesh workgroup |

Those constants are mirrored in C++ (`RHI::kMeshMaxOutputVertices` and friends) with `static_assert`s
tying the two sides together, because a silent disagreement here is an out-of-bounds write into a mesh
shader's output arrays rather than a compile error.

## The retained scene

The CPU does not walk the scene per frame. `FScenePrimitiveSet` keeps a **retained instance array**: one
stable slot per primitive surface, written only when that primitive actually changes. It is split by
access rate into three parallel arrays:

- `FInstanceCullEntry` (32 B) is the only thing the reject path reads: bounds, flags, draw id, surface
  descriptor index, draw distance.
- `FTransform3x4` (48 B) and `FInstanceStatic` (32 B) are read **only** once an instance has survived.

Uploads are dirty-range only. A moving object re-sends 48 bytes; an object that neither moved nor rebound
sends nothing.

## The cull chain

Four compute dispatches, then the draws. Nothing reads back to the CPU inside the frame.

### 1. CullInstances

One thread per retained slot, 64 per workgroup, with a Y fold past 65535 groups.

Each surviving slot is tested against every cull view by `IsInstanceVisibleToView`, which owns the entire
per-`(instance, view)` reject set: caster test, frustum, cascade frustum, and Hi-Z occlusion. Survivors
are atomically appended into a compacted instance buffer, so downstream passes see a dense array.

The same loop accumulates, per `(view, draw)` pair, how many meshlets that pair could emit and how many
cull blocks that is. **LOD is picked per view**, from each view's own origin, so a distant capture
reserves for its coarse LOD while the primary reserves for its fine one.

### 2. BuildDrawPrefix

A single thread, one serial scan over `NumViews * NumDraws`. A draw is a PSO bucket, so that product is in
the hundreds and a hierarchical scan would cost more in launch overhead than it saves.

It turns the accumulated capacities into region bases, **clamps each capacity to the room actually left in
the allocation**, writes one indirect argument per pair, and sizes the next dispatch. It also publishes
demand totals that the CPU reads back three frames later to grow allocations.

The clamp is load-bearing. Every appender uses its region's *length* as its capacity, so publishing a
clamped base with an unclamped length lets a builder write past the buffer from a base that is itself in
range. That was a real device-lost bug.

### 3. BuildMeshletBlocks

One thread per `(visible instance, view)`, dispatched indirectly from a grid the previous pass computed,
because the survivor count only exists on the GPU.

It resolves which meshlet range that view rasters (the identical LOD pick `CullInstances` reserved from)
and appends the instance's run of **blocks** into the pair's region. A block is up to 32 meshlets of one
instance, contiguous by construction, so an instance's whole run costs one atomic.

This pass must make **exactly** the same accept/reject decision as `CullInstances`, which is why both call
`IsInstanceVisibleToView` rather than duplicating the tests. A view one accepts and the other rejects
spends room another instance was measured into, and whoever appends into the full region is granted
nothing and silently never renders.

### 4. The draw

One `CmdDrawMeshTasksIndirect` per batch, with the grid read from the indirect arguments.

## Render buckets

Every per-`(view, draw)` quantity lives in one `FRenderBucket` (24 B):

```
DrawBase   DrawCapacity   DrawCursor
BlockBase  BlockCapacity  BlockCursor
```

Base, capacity and cursor travel together, so an appender cannot pair one region's base with another's
bound. These used to be eight parallel arrays indexed by the same value.

Buckets carve regions out of shared allocations rather than owning separate buffers. That keeps a cascade
which culls almost everything nearly free, at the cost of needing the prefix pass to lay them out. The
block list is additionally sized from an **exact CPU bound** (the sum over active instances of
`ceil(largest LOD meshlets / 32)`), so block overflow is impossible rather than merely rare.

## The task stage

One workgroup is one block: up to 32 meshlets of **one** instance, 32 threads, one meshlet per lane.

Because a block is one instance, every per-instance load is workgroup-uniform, and the only scattered
per-lane read is the meshlet's own bounding sphere. Each lane runs the cone, frustum and micro-poly tests,
survivors are compacted through a groupshared bitmask, and the stage ends in a uniform `DispatchMesh` with
the exact survivor count.

Doing the meshlet resolve here rather than in the mesh shader is the point of having an amplification
stage: 32 lanes walk 32 dependent pointer chains concurrently instead of one mesh workgroup parking its
lanes on one.

**No lane may return early.** The stage ends in a group barrier and a uniform `DispatchMesh`; a lane that
left before the barrier makes it non-uniform, which is undefined behavior that some drivers tolerate and
others hang on, with no page fault to point at. Every reject sets a flag and falls through.

## The mesh stage

32 threads over a 64/64 meshlet, so each lane owns two vertices and two triangles. The two chains per lane
are independent, which lets the compiler overlap them instead of stalling on one load at a time.

Three choices worth knowing:

- **No shared memory.** Clip positions stay in registers and cross lanes through wave shuffles. That is
  only correct because the workgroup is exactly one subgroup, which is why the mesh workgroup is 32 and
  not 64: `WaveReadLaneAt` cannot reach across waves.
- **No primitive compaction.** Every triangle is declared and dead ones set `SV_CullPrimitive` for the
  hardware to discard. Compaction needed a shared bitmask, an atomic per surviving lane, and a second
  barrier, and bought nothing: output storage is reserved from the *declared* array size either way.
- **Clamped indices, not bounds branches.** Surplus lanes redundantly reprocess the last vertex rather
  than sitting masked. They were not saving anything behind the branch, and the duplicate store writes an
  identical value.

Per-triangle culling (backface, frustum, sub-pixel) is a **specialization constant**, not a uniform. The
backface bit must mirror the pipeline's dynamic cull mode or two-sided geometry vanishes, and the
small-primitive test is off under MSAA because it assumes a single sample at the pixel center.

## Occlusion culling

Hi-Z is **single phase and per instance**. Instances test against last frame's depth pyramid and are
rejected outright; there is no defer list and no late re-test pass.

That costs one frame of disocclusion lag: geometry that becomes visible appears a frame late. Testing
whole instances rather than individual meshlets keeps that lag from splitting a mesh apart, so a partially
occluded object still draws in full.

The two-phase alternative (defer occluded meshlets, rebuild the pyramid mid-frame, re-test) removes the
lag but costs five extra cull views, two extra raster passes, a defer arena sized like the draw list, and
a second pyramid rebuild. For a camera plus four cascades that is ten cull views instead of five.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Chunks of a mesh missing after changing the meshlet cap | Cooked assets still hold meshlets over the new cap; `ResolveMeshlet` drops them. Re-import. |
| The newest object added to a scene never renders | A per-view reject in `BuildMeshletBlocks` that `CullInstances` does not make, so blocks are appended for a view that reserved none. |
| Device lost with an out-of-range read in the cull | A region capacity published unclamped, letting an appender write past its allocation. |
| Two-sided geometry disappears | The backface specialization constant disagreeing with `CmdSetCullMode`. |
| Startup aborts with "Vulkan Device Unsuitable" | The GPU is below the mesh shader limits; see [RHI](/internals/rhi/). |
