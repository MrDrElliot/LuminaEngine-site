---
title: Particles
description: GPU particle systems, the module stack, and driving effects from gameplay.
---

Particles in Lumina are **GPU simulated**. A **Particle System** asset describes
an emitter; the editor compiles its module stack into a compute shader, and the
renderer simulates and draws every emitter on the GPU.

Add a **Particle System** component to an entity and assign the asset.

## The component

| Property | Meaning |
| --- | --- |
| **Particle System** | The asset that drives this emitter. |
| **Offset** | Local-space offset of the emitter origin relative to the entity transform. |
| **Spawn Rate Scale** | Scales the asset's continuous spawn rate. 0 disables spawning, 1 uses the asset value. |
| **Time Scale** | Scales the simulation time step. Useful for slow motion. |
| **Emitting** | Whether new particles are spawned. Existing particles keep simulating either way. |
| **Auto Burst** | Fire the asset's burst count on the first active frame. |

The component can also **override user parameters** declared by the asset, so one
asset can serve many variants. Overrides fall back to the asset default, and can
be cleared to revert.

## The asset

**Simulation**

| Property | Meaning |
| --- | --- |
| Max particles | Capacity of the emitter's particle buffer. |
| Spawn rate | Continuous spawns per second. |
| Burst count | Particles spawned in one burst. |
| Duration | Emitter lifetime. 0 means infinite, used with looping. |
| Looping | Restart when the duration elapses. |

**Emitter**

`Inherit Emitter Velocity` blends between world-space spawns (0) and particles
flowing with the emitter's motion (1). It is applied at spawn regardless of which
modules are in the stack.

**Render**

| Property | Meaning |
| --- | --- |
| Blend mode | Additive or alpha blended. |
| Texture | The particle sprite. |
| Billboard to camera | Face the camera. |
| Write depth | Whether particles write depth. Usually off. |

## The module stack

The Particle System editor builds the emitter from a **stack of modules**: shape,
velocity, forces, color over life, size over life, rotation, noise, and so on.
The stack compiles into a single compute shader for that emitter, so adding a
module costs shader instructions rather than a separate dispatch.

## User parameters

An asset can declare **named, typed parameters** (float, vector, or color), and a
built-in simulation property can be **routed through** a named parameter. That
turns an asset property into something gameplay can drive: bind spawn rate or
start color to a parameter, then set that parameter per component from C#.

The component exposes lookups for whether a parameter exists, setting an
override, clearing an override, and resolving the effective value (component
override first, asset default second).

## How it runs

Simulation and rendering are two passes in the scene renderer, after translucency
and fog:

- **Particle Simulate**, a compute dispatch per emitter running the compiled
  module stack.
- **Particle Render**, the draw.

Per-emitter GPU and simulation state lives on the render thread inside the render
scene, and the game thread publishes a per-frame snapshot of simulation
properties after resolving parameter bindings. That means gameplay never touches
GPU particle state directly.

See [Render Passes](/internals/render-passes/) for where these sit in the frame.

## Current state

:::caution
The module stack is the current authoring path and is still under active
development. Older assets that predate it fall back to a set of legacy
uniform-driven fields (shape, velocity mode, gravity, drag, start and end color,
size ranges, rotation, noise) that are still serialized but **deliberately hidden
from the editor**, because the compiled module stack supersedes them.

If you open an old particle asset and see far fewer properties than you expect,
that is why: recreate the effect with modules rather than trying to edit the
legacy fields.
:::

## Performance notes

- Max particles allocates a buffer per emitter, so a high cap costs memory
  whether or not the particles exist.
- Overdraw dominates particle cost. Large, additive, camera-facing sprites filling
  the screen are far more expensive than a higher particle count of small ones.
- Every emitter is a separate compute dispatch and draw. Prefer one emitter with a
  richer module stack over many small emitters producing the same effect.
