---
title: Meshlet Pipeline
description: "How geometry reaches the screen: the retained scene, the GPU cull chain, render buckets, and the mesh stage."
---

Every mesh in Lumina is drawn by mesh shaders. There is no vertex and index path, no fallback, and no
CPU-side per-draw gather. Culling is compute: there are no task shaders either, and the pipeline's task
stage is always empty. This page follows one frame from the retained scene to a rasterized triangle, and
explains why each stage is shaped the way it is.

See [RHI](/internals/rhi/) for the hardware requirement and [Render Passes](/internals/render-passes/) for
where this sits in the frame.

## The unit of work

A **meshlet** is 64 vertices and 64 triangles. Positions are quantized (signed 24-bit anchor plus a shared
power-of-two exponent and three 16-bit offsets), and the triangle list is one packed dword per triangle
holding three 8-bit local indices. Anchor plus offset stays under 2^24, so the decode is bit-identical
everywhere, which is load-bearing for early-Z.

64/64 is a deliberate compromise. meshoptimizer's own guidance favors more triangles than vertices, but an
equal count means the mesh workgroup can process one vertex and one triangle per lane per iteration with a
single loop shape, and the survivor bitmask fits two 32-bit words. The cost is roughly twice as many
meshlets per mesh as a 64/124 build, which is more cull granularity but more per-meshlet overhead.

| Constant | Value | Where |
| --- | --- | --- |
| `MESHLET_MAX_VERTICES` | 64 | `Shaders/Shared/SharedConstants.h` |
| `MESHLET_MAX_TRIANGLES` | 64 | same |
| `MESHLET_CULL_GROUP_SIZE` | 32 | cull workgroup, also meshlets per block |
| `MESHLET_MESH_GROUP_SIZE` | 32 | mesh workgroup |
| `MESHLET_MAX_LODS` | 6 | LOD 0 is full detail |

`SharedConstants.h` is parsed by **both** MSVC and Slang, so it holds preprocessor directives and `//`
comments only. Everything in it either sizes a buffer or is packed into a field both sides decode, which
is why drift corrupts memory instead of merely misbehaving. The C++ mirrors
(`RHI::kMeshMaxOutputVertices` and friends) are tied to it with `static_assert`s in `MeshData.h`.

Shadow casters cap at a lower LOD than the camera (`MESHLET_MAX_SHADOW_LOD` = 3), because sloppy LODs can
hole and a hole in a caster reads as a light leak. Past `ShadowCoarseLODDistance` the cap relaxes to 5,
where one cascade texel keeps the holes sub-texel.

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

Four compute stages, then the draws. Nothing reads back to the CPU inside the frame.

### 1. CullInstances

One thread per retained slot, 64 per workgroup, with a Y fold past `MAX_DISPATCH_AXIS` (65535).

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
demand totals the CPU reads back a few frames later to grow allocations.

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

### 4. MeshletCull

`BuildMeshletCullArgs` sizes the dispatch, then `MeshletCull.slang` runs **one workgroup per block**: up
to 32 meshlets of one instance, 32 threads, one meshlet per lane. It is the sole authority on what
rasterizes, and survivors are appended to the draw list every geometry pass then draws straight out of.

Because a block is one instance, every per-instance load is workgroup-uniform, and the only scattered
per-lane read is the meshlet's own bounding sphere. Each lane runs the cone, frustum and micro-poly tests,
and survivors are compacted through a groupshared flag.

**No lane may return early.** The dispatch ends in a group barrier that every lane must reach; a lane that
left first makes it non-uniform, which is undefined behavior NVIDIA tolerates and AMD hangs on, with no
page fault to point at. Every reject sets `bKeep = false` and falls through. The rule is inherited from
the task stage this pass replaced, and it did not go away with it.

This is also where the GPU-side reasoning for doing the meshlet resolve outside the mesh shader lives: 32
lanes walk 32 dependent pointer chains concurrently, instead of one mesh workgroup parking its lanes on
one.

### 5. The draw

One `CmdDrawMeshTasksIndirectCount` per batch. The grid is one mesh workgroup per surviving meshlet, and
both the grid and the sub-draw count come out of the bucket, so the CPU never learns either. The count
buffer offset points into the bucket's `SubDrawCount` for the slice being drawn.

## Render buckets

Every per-`(view, draw)` quantity lives in one `FRenderBucketGPU` (64 B):

```
DrawBase   DrawCapacity   DrawCursor
BlockBase  BlockCapacity  BlockCursor
CullWorkBase
SliceBase[3]  SliceCount[3]  SubDrawCount[3]
```

Base, capacity and cursor travel together, so an appender cannot pair one region's base with another's
bound. These used to be eight parallel arrays indexed by the same value.

`CullWorkBase` is the bucket's dense offset into the flat meshlet-cull dispatch. Blocks are dense within a
bucket but sparse across the arena, so the cull cannot derive its bucket from the block index alone.

The `[3]` arrays are the **slices**, `MESHLET_SLICE_EARLY`, `LATE`, and `ALL`. The two VisBuffer phases
share one cull view, so each phase's appends are tracked separately, while every single-phase pass takes
`ALL`, which by then is final. `SubDrawCount` is read as an indirect draw count, so it stays last in the
struct and 4-byte aligned.

Buckets carve regions out of shared allocations rather than owning separate buffers. That keeps a cascade
which culls almost everything nearly free, at the cost of needing the prefix pass to lay them out. The
block list is additionally sized from an **exact CPU bound** (the sum over active instances of
`ceil(largest LOD meshlets / 32)`), so block overflow is impossible rather than merely rare.

## The mesh stage

32 threads over a 64/64 meshlet, so each lane owns two vertices and two triangles. The two chains per lane
are independent, which lets the compiler overlap them instead of stalling on one load at a time.

Three choices worth knowing:

- **No shared memory.** Clip positions stay in registers and cross lanes through wave shuffles. That is
  only correct because the workgroup is exactly one subgroup, which is why the mesh workgroup is 32 and
  not 64, and why device selection insists the mesh stage can be pinned to a 32-wide subgroup:
  `WaveReadLaneAt` cannot reach across waves.
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

Two phase, driven by a **persistent per-instance visibility set**. `PrevVisibility[RetainedSlot]` holds
"this instance was visible to the camera at the end of last frame":

- **Early** replays that set with no Hi-Z test, producing the depth the mid pyramid is built from.
- **Late** tests every instance against that fresh pyramid, emits only what early did not draw, and
  accumulates next frame's set into `OutVisibility`.

The two draw sets partition the frustum-visible set, so whatever the flag holds, stale or raced or simply
wrong, each instance rasterizes exactly once. The flag only decides *which* phase an instance lands in,
which is to say how good the occluder set was. Both dispatches must therefore read the **same** flags,
which is why the write target is a separate buffer and the write index flips each frame.

`OutVisibility` is OR-only. An instance's blocks span workgroups, so a plain store would let an occluded
block clear a bit a visible one just set.

Only views flagged `CULL_VIEW_FLAG_MESHLET_HIZ` are two-phase. Shadow cascades are culled in full by the
early dispatch and skipped entirely by the late one, which is what stops them emitting their meshlets
twice. Cascades have their own deferral path instead, with the deferring cascade recorded in the spare
bits of the packed draw word (`MESHLET_DEFER_DRAWID_BITS`); a defer past 1024 is dropped rather than
wrapped into the cascade field.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Chunks of a mesh missing after changing the meshlet cap | Cooked assets still hold meshlets over the new cap; `ResolveMeshlet` drops them. Re-import. |
| The newest object added to a scene never renders | A per-view reject in `BuildMeshletBlocks` that `CullInstances` does not make, so blocks are appended for a view that reserved none. |
| Geometry rasterizes twice, or a shadow doubles up | A view drawn with both the `EARLY` and `LATE` slices when it should take `ALL`, or a non-Hi-Z view reaching the late dispatch. |
| Device lost with an out-of-range read in the cull | A region capacity published unclamped, letting an appender write past its allocation. |
| A hang on AMD that NVIDIA never reproduces | An early return in the meshlet cull, making the group barrier non-uniform. |
| Two-sided geometry disappears | The backface specialization constant disagreeing with `CmdSetCullMode`. |
| Startup aborts with "Vulkan Device Unsuitable" | The GPU is below the mesh shader limits, or its mesh subgroup cannot be pinned to 32. See [RHI](/internals/rhi/). |
