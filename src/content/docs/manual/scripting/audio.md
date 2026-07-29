---
title: Audio
description: Play 2D and spatialized sounds from a script and control them while they play.
---

Audio lives on `World.Audio`, with a shorthand static `Sound` class for the
current world. You play a loaded [sound asset](/manual/audio/) and get back a
handle you can use to stop or adjust the voice while it plays.

```csharp
CAudioStream Shot = Asset.Load<CAudioStream>("/Game/Content/Audio/Shot");
Sound.Play(Shot);
```

Sounds are fire-and-forget, you only need the returned handle if you want to
change or stop the sound afterward. The audio engine is process-global, so these
calls work the same from any script.

## Playing sounds

A **2D** sound plays at full volume regardless of position, use it for UI, music,
and non-diegetic effects. A **3D** sound is attenuated by distance from the
listener, fading between `MinDistance` (full volume) and `MaxDistance` (silent).

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
| `Play(sound, params)` | Full control, see below |

Every parameter after the sound is optional (`Volume` 1, `Pitch` 1, `Loop`
false, `MinDistance` 1, `MaxDistance` 50). A null or unloaded sound returns an
invalid handle and plays nothing.

## Full control

`FSoundPlayParams` covers everything a voice can be configured with at start:
[bus](/manual/audio/mixing/), attenuation, cone, priority, fades, and delay.
Start from `Default()` and change what you care about.

```csharp
FSoundPlayParams Params = FSoundPlayParams.Default();
Params.Bus = EAudioBus.Ambient;
Params.Spatialized = true;
Params.Position = Transform.GetWorldLocation();
Params.Looping = true;
Params.Priority = 40;
Params.FadeInSeconds = 1.5f;
Params.Attenuation.MaxDistance = 30.0f;
Params.Attenuation.Model = EAudioAttenuationModel.Linear;

PlayingSound Wind = Sound.PlayEx(Loop, Params);
```

| Field | Does |
| --- | --- |
| `Volume`, `Pitch` | Multipliers, 1 is unchanged. |
| `Looping` | Restart on completion. |
| `Spatialized` | Attenuate and pan by `Position`. |
| `StartPaused` | Create the voice without starting it. |
| `Position`, `Direction` | World position and cone forward axis. |
| `Bus` | Mix group. |
| `Priority` | 0 to 255. Low priority voices are evicted first at the voice cap. |
| `FadeInSeconds` | Ramp up from silence. |
| `StartDelaySeconds` | Schedule the voice to begin later. |
| `UseOcclusion` | Build the voice's filter up front if you plan to occlude it. |
| `Attenuation` | Falloff, cone, doppler. See [Attenuation](/manual/audio/#attenuation). |

For a quick one-shot on a specific bus without building a struct:

```csharp
Sound.PlayOnBus(Click, EAudioBus.UI);
```

## Controlling a playing sound

`Sound.Play*` returns a `PlayingSound` that carries its world, so it keeps
working after the callback that created it returns. Every call is safe on a
stale or invalid handle, it simply does nothing.

```csharp
PlayingSound Engine = Sound.PlayAt(Loop, Location, Loop: true);

// Later, as the car revs and moves:
Engine.Pitch = 1.0f + Throttle;
Engine.Position = Transform.GetWorldLocation();
Engine.Velocity = Velocity;   // drives doppler

// When it stops:
Engine.Stop(FadeOut: true);
```

| Member | Effect |
| --- | --- |
| `Volume`, `Pitch`, `Pan` | Live multipliers. |
| `Position`, `Velocity` | Move a spatialized voice. Velocity drives doppler. |
| `Looping`, `Paused`, `Bus` | Toggle looping, pause without losing position, move to another bus. |
| `IsPlaying`, `State` | Whether the mixer still holds the voice. |
| `PlaybackFrame` | Current position in PCM frames. |
| `SetAttenuation(atten)` | Replace the whole 3D setup. |
| `SetOcclusion(amount, lowPass, volume)` | Muffle by hand, 0 clear to 1 blocked. |
| `FadeTo(volume, seconds)` | Ramp to a new volume. |
| `Stop(fadeOut, fadeSeconds)` | Stop, optionally with a fade. |

The same operations exist on `World.Audio` taking an `AudioHandle`, if you'd
rather keep the raw handle.

| Field | Meaning |
| --- | --- |
| `Generation` / `Index` | Identify the voice in the audio engine. |
| `IsValid` | `false` if the sound failed to start (no data, audio disabled, or the voice cap was hit). |

## Filters and occlusion

Components can occlude themselves automatically (see
[Occlusion](/manual/audio/#occlusion)). For script-driven voices you supply the
value yourself, which is also how you get effects that aren't occlusion at all.

```csharp
// Muffle everything while the player is underwater.
World.Audio.SetLowPassCutoff(Handle, 800.0f);

// Open it back up.
World.Audio.SetLowPassCutoff(Handle, 0.0f);
```

`SetOcclusion` applies both a low-pass and a volume drop scaled by the amount,
and expects a value you've already smoothed. Jumping it from 0 to 1 in one frame
will be audible.

## Mixing and settings

Bus volumes, mutes, reverb, doppler scale, and suspend all hang off
`World.Audio` too. See [Mixing & Buses](/manual/audio/mixing/) for the options
menu pattern.

```csharp
World.Audio.SetBusVolume(EAudioBus.Music, 0.4f);
World.Audio.SetDopplerScale(0.5f);
World.Audio.SetSuspended(true);      // stops the device, keeps the voices
World.Audio.SaveMixSettings();
```

`ActiveVoiceCount` reports how many voices the mixer is holding, which is worth
putting on a debug overlay if you're near the cap.

:::note
For sounds that should follow an entity automatically, an `SAudioSourceComponent`
authored on the entity plays, positions, and occludes itself without any script.
Use `World.Audio` when you want to trigger and steer one-off sounds from code.
:::
