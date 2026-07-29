---
title: Audio
description: Sound sources, the listener, 3D attenuation, and occlusion.
---

Lumina plays sound through two components, a **source** that emits and a
**listener** that hears. Every voice routes through a [mix bus](/manual/audio/mixing/)
so groups of sounds can be balanced together, and one-off sounds can be fired
straight [from script](/manual/scripting/audio/).

## Audio Source

Add an **Audio Source** component to an entity to make it emit a sound. Its
transform drives distance attenuation, panning, and doppler.

| Property | Does |
| --- | --- |
| Sound | The audio asset to play. |
| Bus | Mix group the voice routes through (SFX by default). |
| Volume | Volume multiplier (1.0 = full). |
| Pitch | Pitch multiplier (1.0 = original). |
| Spatialized | Off plays the sound flat, ignoring the transform. |
| Attenuation | Distance falloff, cone, and doppler settings. See below. |
| Occlusion | Muffling when geometry blocks the listener. See below. |
| Priority | Higher priority voices survive when the voice limit is reached. |
| Fade In Time | Seconds to ramp up from silence when playback starts. |
| Fade Out Time | Seconds to ramp down when the source is asked to fade out. |
| Looping | Restart automatically when it finishes. |
| Play On Ready | Start playing as soon as the entity is set up. |
| Cull Beyond Max Distance | Don't start a voice the listener can't hear anyway. |

From script the source's fields are settable, and it exposes a few methods.

```csharp
SAudioSourceComponent Source = Registry.Get<SAudioSourceComponent>(Entity);
Source.Volume = 0.5f;
Source.bLooping = true;
Source.Play();
```

| Method | Effect |
| --- | --- |
| `Play()` | Start (or restart) the source. |
| `Stop()` | Cut the voice immediately. |
| `FadeOut()` | Ramp down over Fade Out Time, then stop. |
| `SetPaused(bool)` | Pause or resume without losing the playback position. |
| `IsPlaying()` | True while the mixer still holds a voice for this source. |
| `GetPlaybackTime()` | Current position in seconds. |
| `SeekToTime(float)` | Jump to a position in seconds. |

## Audio Listener

The **Audio Listener** component marks the "ears". Sound is panned and
attenuated relative to its world position, so put one on your camera or player.
Without a listener, audio plays from the world origin.

| Property | Does |
| --- | --- |
| Listener Index | Which of the four engine listener slots this component drives. |
| Apply Doppler | Feed the listener's motion into the doppler calculation. |

Split screen uses one listener component per view, each with its own index.
Sounds are spatialized against whichever listener is closest.

## Attenuation

The **Attenuation** struct on a source controls how a voice behaves in 3D.

| Property | Does |
| --- | --- |
| Model | `Inverse` (default, physically correct), `Linear`, `Exponential`, or `None`. |
| Min Distance | Distance (m) the sound stays at full volume within. |
| Max Distance | Distance (m) the falloff curve bottoms out at. |
| Rolloff | Falloff steepness past Min Distance. Higher gets quiet sooner. |
| Min Gain / Max Gain | Floor and ceiling on the attenuated volume. |
| Cone Inner Angle | Degrees. Full volume inside this cone around the source's forward axis. |
| Cone Outer Angle | Degrees. Volume ramps to Cone Outer Gain between the two angles. |
| Cone Outer Gain | Volume outside the outer cone. |
| Doppler Factor | Pitch shift from relative motion. 0 disables doppler for this voice. |
| Directional Factor | How much the listener's facing attenuates the voice. 0 ignores facing. |
| Pan | Stereo pan applied after spatialization. |
| Positioning | `Absolute` (world space) or `Relative` (to the listener). |

Leave the cone angles at 360 for an omnidirectional source. Narrow them for
things that project sound in one direction, like a speaker or a megaphone.

Doppler needs velocity, which the engine derives automatically from how the
source and the listener move each frame. A global **Doppler Scale** in the
[audio settings](/manual/audio/settings/) scales every voice at once.

## Occlusion

Occlusion muffles a sound when level geometry sits between it and the listener.
It's off by default. Turn it on per source under **Occlusion**.

| Property | Does |
| --- | --- |
| Enabled | Trace to the listener and muffle this source when blocked. |
| Low Pass Frequency | Cutoff (Hz) at full occlusion. Lower is more muffled. |
| Volume Attenuation | Volume multiplier at full occlusion. |
| Interp Time | Seconds to blend between occluded and clear. Keeps the filter from popping. |
| Trace Interval | Seconds between traces for this source. |

The engine raycasts from the listener to the source, then blends the result in
over Interp Time and applies it as a low-pass filter plus a volume drop. Sources
that are never occluded pay nothing, the filter is only created the first time a
source is actually blocked.

Which collision layers count as blocking, the per-tick trace budget, and a
global on/off switch all live in the [audio settings](/manual/audio/settings/).

Distant or quiet sources don't need frequent traces. Raise **Trace Interval** on
ambience and background loops so the budget goes to sounds the player is paying
attention to.

## Voice limits

The mixer holds a limited number of simultaneous voices (128 by default,
configurable up to 256). When they're all in use, a new sound evicts the lowest
priority voice that ranks below it, or is dropped if nothing does.

Two properties keep the budget healthy:

- **Priority** ranks a source against the rest. Give gunshots and dialogue a
  high value and ambience a low one.
- **Cull Beyond Max Distance** stops a source from taking a voice when the
  listener is outside its Max Distance. Looping sources that also have Play On
  Ready go further and release their voice when the listener walks away, taking
  a new one when they come back, so a level full of ambient loops costs nothing
  while you're nowhere near it.

## Procedural audio

A **Procedural Audio** component streams PCM samples you generate at runtime,
for synths, engine sounds, or network voice. Set its sample rate and channel
count, call `Start()`, then push interleaved float samples with
`QueueSamples()`. It carries the same Bus and Attenuation properties as a
regular source.
