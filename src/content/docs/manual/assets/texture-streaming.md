---
title: Texture Streaming
description: How much of each texture stays on the GPU, and the budget that decides it.
---

Textures do not keep their whole mip chain on the GPU. Each one loads holding
only its small mips, and the engine promotes the rest on demand based on how
much of the screen the texture actually covers. That is what keeps GPU memory
roughly flat as a level grows, instead of scaling with the number of textures
placed in it.

## How it works

When a texture is saved, its mips are split. Everything at or below **256 px**
is written inline, and the larger mips go into a separate region of the package
file. On load, only the inline tail is resident, so opening fifteen 4K textures
costs fifteen 256 px images until something asks for more.

Each frame the engine resolves residency in two steps.

- **Wanted** is pure quality. It comes from the renderer reporting which mip the
  shaders actually sampled, so it reflects real screen coverage rather than a
  guess from distance.
- **Budgeted** reconciles that against the pool. When the total is over budget,
  the engine sheds a single mip at a time across the whole set in retention
  order, so the scene softens uniformly instead of a few textures collapsing to
  blurry while the rest stay sharp.

Residency then follows Budgeted in both directions. A texture that drops out of
view is not demoted immediately, since a camera cut or a one frame occlusion
would otherwise cost a full reload on the next frame.

Opening a texture in the Texture editor pins it fully resident. Pinned textures
are exempt from the budget and can push the pool past its limit.

## Settings

**Project Settings → Rendering → Texture Streaming**, stored in
`Config/GameSettings.json`. These are project scoped rather than per user, since
the pool size a project targets is a shipping decision.

| Setting | Default | What it does |
| --- | --- | --- |
| **Pool Size MB** | 1024 | GPU budget for streamable mips. Textures are trimmed toward their inline tail once the total exceeds this. |
| **Texture Streaming** | On | Off keeps every texture fully resident and stops trimming. See below, this is not a way to avoid the load cost. |
| **Resolution Bias** | 1.0 | Multiplier on the requested resolution. Above 1 keeps sharper mips than coverage implies, below 1 trades sharpness for memory. |
| **Max Loads In Flight** | 8 | Cap on concurrent mip loads. Bounds how deep the IO queue gets. |
| **Max Load Staging MB** | 128 | Ceiling on host memory held by in flight reads. A load reads its whole mip chain into RAM before any of it uploads, so this is what bounds that spike. |
| **Max Upload MB Per Frame** | 32 | Host bytes staged per frame. Loads that do not fit wait a frame. |
| **Max Residency Changes Per Frame** | 4 | Promotions plus demotions per frame. Separate from the upload budget, because a demotion recreates the GPU image while moving zero host bytes. |

If you see stream in hitches, lower **Max Upload MB Per Frame** and **Max
Residency Changes Per Frame** before touching the pool. If you see textures
staying blurry, the pool is too small for the scene, or **Resolution Bias** is
below 1.

## Turning it off

Switching **Texture Streaming** off does not skip the streaming work. Every
texture is promoted to fully resident and trimming stops, which means:

- The mips are still read from disk. They live in the package file either way,
  so turning streaming off changes when they load, not whether they load.
- **Pool Size MB** no longer applies, because nothing is ever shed. GPU memory
  for textures becomes uncapped.

It is useful for deciding whether a visual bug is the streamer's fault. It is
not a way to reduce load cost or memory, and it will generally use more of both.

## Keeping one texture resident

To take a single texture out of the streamer, set **Never Stream** on the
Texture asset, under Level Of Detail. That flag is applied when the asset is
saved: the whole mip chain is written inline, so the texture never enters the
streamer and costs no streaming reads at all. It also removes pop in for that
texture, at the cost of holding it fully resident.

Re-save or recook the texture after changing it, since the split is baked in at
save time.

A texture is also non streamable when it has no chain to stream, which means
**Mip Gen Settings** is set to not generate, or the image is a single mip. See
[Textures](/manual/assets/textures/) for the rest of the import settings.
