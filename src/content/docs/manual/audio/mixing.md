---
title: Mixing & Buses
description: Mix groups, volume multipliers, an options menu, and reverb.
---

Every voice routes through a **bus**, a mix group with its own volume and mute.
Buses are how you give players a Music slider that doesn't touch gunfire, or duck
the world under dialogue.

## The buses

| Bus | For |
| --- | --- |
| Master | Everything. Feeds the output device. |
| Music | Score and licensed tracks. |
| SFX | World and gameplay sound. The default for new sources. |
| UI | Menu clicks, notifications, anything non-diegetic. |
| Voice | Dialogue and VO. |
| Ambient | Beds, room tone, weather. |

The five named buses all feed Master, so Master's volume scales the whole mix.
Pick a bus per source with its **Bus** property, per script call with
`FSoundPlayParams.Bus`, or move a live voice with `SetBus`.

## Volume multipliers

A bus volume is a plain multiplier, `1.0` is unchanged and `0.0` is silent. The
starting values ship in the [audio settings](/manual/audio/settings/), and
anything can change them at runtime.

```csharp
Sound.SetBusVolume(EAudioBus.Music, 0.4f);
Sound.SetBusMuted(EAudioBus.Voice, true);
```

Volume changes are ramped rather than applied instantly, so dragging a slider
doesn't click.

## An options menu

This is the whole pattern. Read the current values to populate your sliders,
write them back as the player drags, and persist once when they hit Apply.

```csharp
// Populate.
float Music = Sound.GetBusVolume(EAudioBus.Music);
float Sfx   = Sound.GetBusVolume(EAudioBus.SFX);

// Live preview while dragging.
Sound.SetBusVolume(EAudioBus.Music, MusicSlider);
Sound.SetBusVolume(EAudioBus.SFX, SfxSlider);

// Apply.
Sound.SaveMixSettings();
```

`SaveMixSettings()` writes the current bus volumes into the project's
`AudioSettings.json`, so they come back on the next launch.

:::note
The full set is also on `World.Audio` (`SetBusVolume`, `GetBusVolume`,
`SetBusMuted`, `IsBusMuted`, `SaveMixSettings`). `Sound` is just the static
shorthand for the current world.
:::

## Ducking

There's no automatic sidechain, but a duck is a few lines: drop the bus you want
out of the way, restore it when the important sound finishes.

```csharp
PlayingSound Line = Sound.PlayOnBus(Dialogue, EAudioBus.Voice);
Sound.SetBusVolume(EAudioBus.Music, 0.25f);

// When Line.IsPlaying goes false, put it back.
Sound.SetBusVolume(EAudioBus.Music, 1.0f);
```

## Reverb

The engine has one shared reverb return. Buses send into it, so you can wet the
world without touching UI or music.

```csharp
World.Audio.SetBusReverbSend(EAudioBus.SFX, 0.35f);
World.Audio.SetBusReverbSend(EAudioBus.Ambient, 0.5f);

// Room size, damping, stereo width, wet level.
World.Audio.SetReverb(0.8f, 0.4f, 1.0f, 0.5f);
```

| Parameter | Does |
| --- | --- |
| Room Size | Decay length. 0 is a small room, 1 is a cathedral. |
| Damping | High-frequency absorption in the tail. Higher is darker. |
| Width | Stereo spread of the tail. |
| Wet Level | Gain of the reverb return. |

Sends default to 0 and the reverb network isn't built until something asks for
it, so a project that never uses reverb pays nothing for it.

Because the parameters are live, reverb zones are just a trigger volume that
calls `SetReverb` on enter. Starting values for the sends and the reverb shape
live in the [audio settings](/manual/audio/settings/).

:::caution
The send is per bus, not per voice, and there's a single reverb instance. Two
sounds on the same bus can't have different wetness.
:::
