---
title: Audio
description: Positional sound sources, the listener, and playing audio from scripts.
---

Lumina plays sound through two components — a **source** that emits and a
**listener** that hears — plus a small scripting API for one-off sounds.

## Audio Source

Add an **Audio Source** component to an entity to make it emit a sound. Its
position in the world drives attenuation and (with a listener present) spatial
panning.

| Property | Does |
| --- | --- |
| Sound File | The audio asset to play. |
| Volume | Volume multiplier (1.0 = full). |
| Pitch | Pitch multiplier (1.0 = original). |
| Min Distance | Distance (m) at which the sound starts to attenuate. |
| Max Distance | Distance (m) beyond which it's inaudible. |
| Looping | Restart automatically when it finishes. |
| Play On Ready | Start playing as soon as the entity is set up. |

From a script, the source's exposed fields are settable — `Sound`, `Volume`,
`Pitch`, `bLooping`, and the distance falloff. Set `bPlayOnReady` so the sound
starts when the entity is set up:

```csharp
SAudioSourceComponent Source = Registry.Get<SAudioSourceComponent>(Entity);
Source.Volume = 0.5f;
Source.bLooping = true;
```

## Audio Listener

The **Audio Listener** component marks the "ears" — sound is panned and
attenuated relative to its world position. Put one on your camera or player.
Without a listener, audio plays unattenuated.

## Playing sounds from script

Today the script-facing audio path is the **Audio Source** component. To play a
sound from a script, give an entity a source, point its `Sound` at an audio
asset, and set `bPlayOnReady` (or configure it in the editor):

```csharp
SAudioSourceComponent Source = Registry.Emplace<SAudioSourceComponent>(Entity)!;
Source.Sound = Asset.Load<CAudioStream>("/Game/Content/Audio/Theme");
Source.bLooping = true;
Source.bPlayOnReady = true;
```

A standalone, fire-and-forget one-shot API is not yet exposed to C#.
