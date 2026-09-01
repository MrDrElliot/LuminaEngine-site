---
title: Breakout
description: A brick breaker built on the ECS and the RHI, with an embedded post chain and synthesized audio.
---

`Engine/Applications/Breakout/`, about 5,600 lines.

A brick breaker. Paddle, ball, bricks, power-ups, a boss, lasers, shockwaves, screen
shake, and a great deal of particle work. It exists because a game with a lot of
small moving parts is a good stress test for using the ECS outside a world.

## What it demonstrates

**The ECS as a plain gameplay database.** Breakout creates an `ECS::FRegistry`
directly. No `CWorld`, no systems registry, no scheduler. Components are ordinary
structs in `GameTypes.h`:

```cpp
struct FBody   { FVector2 Position; FVector2 Velocity; FVector2 HalfSize; float Rotation; };
struct FBall   { float Speed; float Damage; bool bStuck; };
struct FBrick  { int32 Health; EPowerUp Drop; };
```

and gameplay is a handful of views iterated in a fixed order:

```cpp
for (auto [Entity, Body, Ball] : Registry.View<FBody, FBall>().Each())
{
    Body.Position += Body.Velocity * Delta;
}
```

That is the whole architecture. It shows the registry is useful on its own, not only
as the thing a `CWorld` wraps.

**A self-contained render pipeline.** One instanced quad shader draws everything,
paddle, bricks, particles, and text, differentiated by a `Kind` field on the instance
and evaluated with signed distance fields in the pixel shader. Instances reach the
GPU through `RHI::Core::CopyTransientArray`, and the shader reads them by device
address. On top of that sits a five-level bloom chain and a composite pass doing
tonemapping, chromatic aberration, vignette and a beat-synced warp.

**Bitmap text with no font asset.** `Render/Font.h` is a 5x7 glyph table that emits
the same quad instances as everything else, so the HUD costs one extra draw and no
asset loading.

**Procedural audio.** `Audio/SoundEngine.cpp` synthesizes all 32 sounds and the music
from oscillators and envelopes at mix time, against `IAudioRenderCallback` and
`Audio::CreateDevice`. There are no audio files. It also runs a small music sequencer
with ducking, so the track dips under gameplay hits.

**A fixed timestep with proper input latching.** The simulation runs at a fixed rate
with an accumulator and a catch-up cap. One-shot inputs are only cleared on frames
that actually advanced the simulation:

```cpp
// A frame shorter than the fixed step runs no simulation, so a press has to survive to the next one.
if (Steps > 0)
{
    Input.bLaunch = false;
    Input.bConfirm = false;
}
```

Without that, a launch press on a frame faster than the step is silently dropped.

## Running it

```bash
LuminaBuild.bat Build Breakout -TargetType=Editor -Configuration=Development
```

Then run `Binaries/Windows64/Breakout-Editor-Development.exe`.

| Input | Does |
| --- | --- |
| Left / Right, or A / D | Move the paddle |
| Mouse | Move the paddle |
| Space or Enter | Launch, and confirm |
| P | Pause |
| R | Restart |
| F3 | Toggle the stats overlay |
| Escape | Quit |

## Worth reading

- `Source/Game/Game.cpp` for the whole simulation, including how hit stop is applied
  as a time scale rather than a frame skip. Freezing the loop outright reads as a
  hitch, which is exactly what it was mistaken for during development.
- `Source/Render/Shaders.h` for the embedded Slang. Each entry point is a separate
  string glued to a shared prelude, because a Slang module compiles one entry point
  at a time.
- `Source/Render/Renderer.cpp` for the screen passes, which use the shared
  `RHI::Utils::BeginScreenPass` and `RHI::Utils::FMipChain` helpers.
