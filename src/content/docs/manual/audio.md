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

From a script, the source's fields are settable, and it exposes `Play()` and
`Stop()`:

```lua
local source = self:GetComponent(SAudioSourceComponent)
source.Volume = 0.5
source:Play()
```

## Audio Listener

The **Audio Listener** component marks the "ears" — sound is panned and
attenuated relative to its world position. Put one on your camera or player.
Without a listener, audio plays unattenuated.

## Playing sounds from script

For fire-and-forget sounds you don't want to author as components, use the
`Audio` table:

| Call | Returns |
| --- | --- |
| `Audio.PlaySound2D(file)` | A non-positional (UI/music) sound, returns an `AudioHandle`. |
| `Audio.PlaySoundAtLocation(file, location)` | A positional one-shot. |
| `Audio.StopAllSounds()` | Stops everything. |

An `AudioHandle` has `:Stop()`, `:FadeOut(seconds)`, `:SetVolume(v)`,
`:SetPitch(p)`, `:SetLooping(b)`, and `:IsValid()`.

```lua
local music = Audio.PlaySound2D("/Game/Audio/Theme")
music:SetLooping(true)
-- later
music:FadeOut(2.0)
```

See [Scripting › Reference](/manual/scripting/reference/) for the full `Audio`
table.
