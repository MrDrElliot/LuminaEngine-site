---
title: Audio
description: Play 2D and spatialized sounds from a script and control them while they play.
---

Audio lives on `World.Audio`. You play a loaded [sound asset](/manual/audio/)
and get back an `AudioHandle` you can use to stop or adjust the voice while it
plays.

```csharp
CAudioStream Shot = Asset.Load<CAudioStream>("/Game/Content/Audio/Shot");
World.Audio.Play2D(Shot);
```

Sounds are fire-and-forget: you only need the returned handle if you want to
change or stop the sound afterward. The audio engine is process-global, so these
calls work the same from any script.

## Playing sounds

A **2D** sound plays at full volume regardless of position — use it for UI,
music, and non-diegetic effects. A **3D** sound is attenuated by distance from
the listener, fading between `MinDistance` (full volume) and `MaxDistance`
(silent).

```csharp
// UI / music.
World.Audio.Play2D(Music, Volume: 0.6f, Loop: true);

// Positional gunshot that falls off between 2m and 40m.
World.Audio.PlayAtLocation(Shot, Transform.GetWorldLocation(), MinDistance: 2.0f, MaxDistance: 40.0f);
```

| Method | Effect |
| --- | --- |
| `Play2D(sound, volume, pitch, loop)` | Non-spatialized playback |
| `PlayAtLocation(sound, location, volume, pitch, minDistance, maxDistance, loop)` | Spatialized 3D playback |

Every parameter after the sound is optional (`Volume` 1, `Pitch` 1, `Loop`
false, `MinDistance` 1, `MaxDistance` 50). A null or unloaded sound returns an
invalid handle and plays nothing.

## Controlling a playing sound

Keep the `AudioHandle` to drive the voice after it starts. Every control call is
safe on a stale or invalid handle — it simply does nothing.

```csharp
AudioHandle Engine = World.Audio.PlayAtLocation(Loop, Location, Loop: true);

// Later, as the car revs and moves:
World.Audio.SetPitch(Engine, 1.0f + Throttle);
World.Audio.SetPosition(Engine, Transform.GetWorldLocation());

// When it stops:
World.Audio.Stop(Engine, FadeOut: true);
```

| Method | Effect |
| --- | --- |
| `Stop(handle, fadeOut)` | Stop a voice (optionally letting its fade-out play) |
| `StopAll()` | Stop every playing sound |
| `SetVolume(handle, volume)` | Live volume (1 = full) |
| `SetPitch(handle, pitch)` | Live pitch multiplier (1 = original) |
| `SetLooping(handle, loop)` | Toggle looping on a running voice |
| `SetPosition(handle, position)` | Move a spatialized voice (track a moving emitter) |
| `SetMinMaxDistance(handle, min, max)` | Update 3D attenuation range |

The `AudioHandle` fields.

| Field | Meaning |
| --- | --- |
| `Generation` / `Index` | Identify the voice in the audio engine |
| `IsValid` | `false` if the sound failed to start (no data, or audio disabled) |

:::note
For sounds that should follow an entity automatically, an `SAudioSourceComponent`
authored on the entity plays and positions itself without any script. Use
`World.Audio` when you want to trigger and steer one-off sounds from code.
:::
