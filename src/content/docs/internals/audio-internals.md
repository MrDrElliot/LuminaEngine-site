---
title: Audio Internals
description: The audio context, the command queue, voices, buses, spatialization, and procedural streams.
---

Audio is **miniaudio** behind an `IAudioContext` facade. The engine never calls
miniaudio directly outside `Audio/Miniaudio`.

The central design decision: **the game thread never touches the mixer.** Every
operation is a command queued from the game thread and drained by a per-frame
pump job on the task pool. Voices are addressed by generation-checked handles, and
voice state is published back for the game thread to read.

For the authoring view see the [Audio](/manual/audio/) section of the manual.

## Lifecycle

```cpp
Audio::Initialize();     // FEngine::Init, skipped when headless
Audio::Update();         // once per frame, top of FEngine::Update
Audio::ApplySettings();  // push CAudioSettings onto the live context
Audio::Shutdown();
```

`Audio::Update()` drains queued commands and runs housekeeping. It is a **pump**,
not the mixer: the actual mixing happens on miniaudio's device callback thread,
which is owned by the audio device and is not a Lumina thread.

`ApplySettings` is safe to call **before a device exists**, which matters because
settings load before the audio device is guaranteed to be up. It is wired to
`FCoreDelegates::OnSettingsSaved` so changing audio settings in the editor takes
effect live. See [Configuration and Settings](/internals/config-and-settings/).

A headless dedicated server never initializes audio at all.

## The command queue

`FAudioCommand` is the game-thread-to-pump control message. It is deliberately
**flat rather than a union**, so payloads with default member initializers (like
`SAudioAttenuation`) can live in it: a type tag, a handle, three float slots, a
bool, a byte, a frame counter, two vectors, and a quaternion.

Every mutating call on `IAudioContext` (`SetVolume`, `SetPosition`,
`SetAttenuation`, `StopSound`, and the rest) enqueues one of these. The API is
therefore **thread safe**, and a call returns before the change has been applied.

That deferral shows up in a few places worth knowing about:

- `SetOutputDevice`-style device rebuilds are applied on the pump, so the call
  returns before the device has actually changed.
- Playback started this frame begins on the next pump.

## Voices and handles

```cpp
struct FAudioHandle
{
    uint32 Generation = 0;   // 0 == invalid
    uint32 Index      = 0;
};
```

A handle is a slot index plus a generation. When a voice ends, its slot is reused
with a bumped generation, so a stale handle referring to a finished sound is
detected rather than silently controlling whoever inherited the slot. This is the
standard fix for the "I turned down a sound and something else got quieter" bug.

`EAudioVoiceState` (`Free`, `Playing`, `Paused`) is **published per voice slot**
so the game thread can query a voice without touching the mixer.

## Playback

Three ways to start a voice:

| Call | Source |
| --- | --- |
| `PlayAudio(TSharedPtr<FAudioData>, Params)` | Asset-backed. The shared encoded bytes are decoded on the pump and **kept alive for the lifetime of the voice**, so the caller's asset can be unloaded mid-playback. |
| `PlayFile(VfsPath, Params)` | Loose file. Read on the pump, so a large file briefly occupies a worker. |
| `PlayProceduralStream(TSharedPtr<FProceduralAudioStream>, Params)` | Caller-generated PCM. |

`FAudioData` is immutable encoded bytes (a `.wav` file image, for instance) shared
between an asset and any in-flight sounds. Sharing through `TSharedPtr` is what
makes "unload the asset while it is still playing" safe.

`FAudioPlayParams` carries everything needed to start a voice (volume, pitch,
looping, bus, priority, position and spatialization settings) and is passed **by
value** into the pump's pending-play queue.

## Per-voice control

```cpp
SetVolume, SetPitch, SetLooping, SetPaused, SetPan, SetPriority, SetBus
SetPosition, SetVelocity, SetDirection
SetAttenuation, SetMinMaxDistance
StopSound(Handle, EAudioStopMode, FadeSeconds)
StopAllSounds(EAudioStopMode, FadeSeconds)
```

`EAudioStopMode` selects an immediate stop or a fade. Newly started voices also
get a short volume ramp, configurable on the context, which kills the clicks that
otherwise come from abrupt gain edits.

Seeking a playing non-procedural sound to a PCM frame is supported;
procedural streams are not seekable by nature.

## Buses

`EAudioBus`: `Master`, `Music`, `SFX`, `UI`, `Voice`, `Ambient`
(`NumAudioBuses` is 6). Every voice is assigned a bus at play time, and
`SetBus` moves it.

Bus volume and reverb send are set on the context. Setting a bus's reverb send to
0 disables its wet branch entirely, and **the reverb network is built on first
use**, so a project that never uses reverb never pays for it.

## Spatialization

`SAudioAttenuation` describes distance falloff between a minimum and maximum
distance, using an `EAudioAttenuationModel` curve (including `None`, which plays
at full gain anywhere). `EAudioPositioning` selects how the voice's position is
interpreted.

**Doppler** is per voice, with a global multiplier on the context; setting the
multiplier to 0 disables doppler engine-wide.

**Occlusion** (`SAudioOcclusion`) takes an amount from 0 (clear line of sight) to
1 (fully blocked) and drives a per-voice low-pass plus a gain multiplier. The
engine does **not** trace or smooth for you:

> The caller is responsible for smoothing the occlusion value over time.

Feeding a raw per-frame raycast result straight in produces audible filter
chatter when the ray flickers across an edge. Filter it.

The per-voice low-pass is also directly controllable for effects that are not
occlusion (underwater, radio); passing 0 bypasses the filter.

## Procedural streams

`FProceduralAudioStream` is a streaming float32 PCM buffer. Allocate one from the
context, push samples into it, and start playback by passing it to
`PlayProceduralStream`.

The stream is reference counted and shared with the mixer, so it stays alive
while a voice references it. Underruns are the failure mode to watch for: if the
producer cannot keep the buffer ahead of the mixer, the voice starves.

## Device management

`FAudioDeviceInfo` reports the live device's sample rate, channel count, period
size in frames, and listener count.

Two operations worth knowing:

- The output device can be rebuilt at runtime, with 0 meaning "device native" for
  any field. Applied on the pump.
- The device can be **stopped without dropping voices**, which is what the engine
  does when the application loses focus. Voices resume where they were when the
  device restarts.

## Threading summary

| Work | Thread |
| --- | --- |
| `Audio::Update()` pump | Game thread, once per frame, from `FEngine::Update` |
| Command drain, decode, file reads | The pump (so a large decode occupies a worker briefly) |
| Mixing | miniaudio's device callback thread |
| Voice state queries | Any thread; state is published per slot |

**Never touch engine state from a mixing callback.** The callback is owned by the
audio device, runs at its cadence, and has no relationship to the frame.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Adjusting one sound changes a different one | A stale handle. The generation check catches it; if you bypassed handles, it will not. |
| A sound cuts off when its asset unloads | The voice was started from raw bytes rather than a shared `FAudioData`. |
| A change does not apply this frame | Every setter is a queued command drained by the pump. |
| Audible chatter on occluded sounds | Raw per-frame occlusion values with no smoothing. |
| A frame hitch when a sound starts | A large file decoded on the pump. Pre-load it as an asset. |
| Procedural audio stutters | Producer underrun; the buffer is not staying ahead of the mixer. |
| Reverb appears despite being unused | A nonzero bus reverb send. Zero disables the wet branch. |
| Audio silent after the app regains focus | The device was stopped and not restarted. |
