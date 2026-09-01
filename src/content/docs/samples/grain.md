---
title: Grain
description: A micro-voxel world at 6 cm resolution, raymarched with global illumination, simulated water, and destruction.
---

`Engine/Applications/Grain/`, about 4,400 lines.

A 160 by 128 by 160 meter landscape built from **6.25 cm voxels**, roughly 13 billion
voxel positions. It is raymarched rather than meshed, lit by one bounce of global
illumination, has flowing water, and you can dig holes in it by clicking. There are
no triangles in the scene at all.

This is the sample that argues the case hardest. Nothing about it fits the scene
renderer, and going straight to the RHI is not a workaround here, it is the only
sensible design.

## The world

Three levels of eight, over a flat root grid.

| Level | Node covers | Holds |
| --- | --- | --- |
| Root | 32 m | 8³ mid nodes |
| Mid | 4 m | 8³ leaf nodes |
| Leaf | 0.5 m | 8³ voxels |

Each node carries a 512-bit occupancy mask. A child is found by counting the bits
below its slot, so the children of a node are stored contiguously and cost nothing
when absent. A node whose whole subtree is one material collapses to a single record,
which is what makes solid rock underground free.

Five buffers hold the world, all reached from shaders by **buffer device address**:
nodes, occupancy masks, a rank prefix table, a child index run, and 2-bit palette
payloads. Around 500 MB in total for the whole landscape.

Generation runs on the job system, one root subtree per task into thread-local
buffers, then a merge that rebases indices. It takes about 3.5 seconds.

## The renderer

One fullscreen pixel shader marches the tree. There is no DDA. Each step resolves
the deepest node containing the point and jumps to that cell's exit, so empty space
skips at whatever level it is empty:

```
if the containing cell is solid  -> hit
otherwise                        -> advance to that cell's far plane
```

The descent stops early once a cell is smaller than the pixel footprint, which is
both a level of detail scheme and the thing that stops 6 cm voxels aliasing into a
moire field at distance. Sub-pixel jitter and temporal accumulation take care of the
rest.

**Global illumination** is one cosine-weighted bounce ray per pixel, plus a sun
shadow ray. That is a very noisy estimator, so the frame is separated before it is
denoised:

- The raymarch writes **indirect irradiance**, **direct radiance** and **albedo** to
  three separate targets.
- Only indirect goes through the denoiser. Albedo is multiplied back afterwards.
- Temporal accumulation uses a per-pixel history counter, so a stable pixel averages
  48 samples rather than being capped by a fixed blend rate.
- Four a trous passes at doubling stride filter it, edge-stopped on distance, face
  index and luminance variance.

Accumulating final color instead would put the per-voxel albedo variation inside the
noisy signal, and the filter would then refuse to blur across every material boundary
for a reason that has nothing to do with lighting.

Caves are lit entirely by bounce light from emissive crystal veins, which is the
clearest demonstration that the global illumination is real.

## The water

A dense 256³ volume (16 m) sits inside the sparse world, seeded from the same
generator and authoritative inside its own box. Each cell stores a solid material in
the low bits and a **water volume** in the rest, so a cell can be partly full.

Flow is a pairwise exchange with parity, one compute dispatch per axis per tick,
where each thread owns both cells of its pair. That is exactly mass conserving and
needs no atomics and no second buffer. Gravity runs before the two lateral axes, so
water falls before it spreads.

The surface normal comes from the gradient of the volume field across neighboring
cells, which is what makes a blocky grid read as flowing water, and a downward column
sum gives depth for absorption and foam.

## Destruction

Left click digs a crater. The key property is that **clearing an occupancy bit never
allocates**, so destruction runs in place on the sparse tree with no allocator:

- One compute thread marches for the aim point and writes it to a small buffer, so
  the crater center never round-trips to the CPU.
- A second dispatch runs one thread per 0.5 m leaf cell in the crater box. Cells map
  one to one onto leaf nodes, so no two threads touch the same node and no atomics
  are needed.

Digging stops about 9 m down, where the tree stops being subdivided and collapsed
interior nodes have no per-voxel mask to clear. Going deeper needs a node allocator.

## Performance

About **5 ms per frame** at 1600x900 unlocked, with global illumination, sun shadows,
water reflections, the denoiser and the simulation all running. Normal runs sit at
the refresh rate.

Getting there was profiling, not cleverness. Two findings did nearly all of it:

- Passing the argument struct **by value** into the hot mask helpers made Slang copy
  240 bytes on every call, several times per traversal step. Taking a pointer instead
  cut the frame from 15.8 ms to 6.2 ms.
- Finding a child's index summed the popcount of every mask word below its slot,
  about eight loads per level, three levels deep, on every step of every ray. A
  precomputed prefix table makes it two loads and one popcount, and took a close view
  from 33 ms to about 5 ms.

Neither was visible by reading the code. `-gputimes` reports a per-pass GPU
breakdown, and `-unlocked` disables the present-mode cap that otherwise pins every
measurement to the refresh rate.

## Running it

```bash
LuminaBuild.bat Build Grain -TargetType=Editor -Configuration=Development
```

Then run `Binaries/Windows64/Grain-Editor-Development.exe`.

| Input | Does |
| --- | --- |
| WASD | Fly |
| Right mouse drag | Look |
| Left click | Dig |
| Space / Left Control | Up and down |
| Left Shift | Move faster |
| T | Toggle temporal accumulation |
| F | Toggle the spatial filter |
| Escape | Quit |

Useful flags:

| Flag | Does |
| --- | --- |
| `-gputimes` | Per-pass GPU breakdown on exit |
| `-unlocked` | Uncap the frame rate for measurement |
| `-screenshot -frames N` | Write `Grain.png` at frame N and exit |
| `-lowcam`, `-cave`, `-simcam` | Preset viewpoints |
| `-nosim`, `-nofilter`, `-notemporal` | Disable a stage for A/B |
| `-debugmat`, `-debugnormal` | Debug views |

## Worth reading

- `Source/World/VoxelWorld.cpp` for generation and the parallel build.
- `Source/Render/Shaders.h` for the whole shader set. `kVoxelCommon` holds the
  traversal shared by the rendering and compute modules, so the two cannot drift.
- `Source/World/VoxelSim.cpp` and the `SimFlowCS` entry point for the water.
