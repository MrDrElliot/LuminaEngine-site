---
title: Audio Settings
description: Project-wide audio configuration in the editor's Settings panel.
---

Project audio configuration lives under **Engine > Audio** in the editor's
Settings panel (File > Settings). Changes apply to the running editor
immediately and are saved to `/Config/AudioSettings.json` in your project.

## Mix

Starting volumes for each [bus](/manual/audio/mixing/). These are the values the
game boots with, before an options menu overrides them.

| Setting | Does |
| --- | --- |
| Master Volume | Scales every bus. |
| Music / SFX / UI / Voice / Ambient Volume | Per-bus multipliers. |
| Mute When Unfocused | Suspend audio while the game is in the background. |

**Mute When Unfocused** only applies to standalone builds. The editor ignores it,
because a Play In Editor window is a separate window from the main editor and
losing focus on one doesn't mean you've left the app. Minimizing always
suspends, in both.

## Output

| Setting | Does |
| --- | --- |
| Sample Rate | Mixer rate. 0 uses the output device's native rate. |
| Channels | Mixer channel count. 0 uses the device's native layout. |
| Period Frames | Mixer period. Smaller is lower latency and more CPU. 0 lets the backend choose. |
| Max Voices | Cap on simultaneous voices (8 to 256). |
| Volume Smoothing | Milliseconds of ramp on volume changes. Stops abrupt edits from clicking. |

:::caution
Changing Sample Rate, Channels, or Period Frames rebuilds the output device.
Every playing sound is stopped when that happens. Leave them alone unless you
have a reason to change them, 48 kHz at the device's native layout is a good
default.
:::

## Spatialization

| Setting | Does |
| --- | --- |
| Doppler Scale | Global multiplier on every voice's doppler factor. 0 turns doppler off engine-wide. |

## Occlusion

| Setting | Does |
| --- | --- |
| Occlusion Enabled | Master switch. Off skips all occlusion tracing. |
| Occlusion Trace Channel | Collision layers a trace treats as blocking. |
| Max Occlusion Traces Per Tick | Trace budget per world tick. |

Put occluding geometry on the layer you select here. Static level geometry is
usually the right answer, tracing against dynamic bodies means every crate the
player pushes around muffles the world behind it.

The trace budget bounds the cost. Sources past the budget in a given tick keep
their previous result and retry next tick, so raising it costs CPU and lowering
it costs responsiveness, not correctness.

## Reverb

| Setting | Does |
| --- | --- |
| Reverb Room Size / Damping / Width / Wet Level | Starting shape of the shared reverb. |
| Music / SFX / UI / Voice / Ambient Reverb Send | How much each bus feeds the reverb return. |

All sends default to 0, which leaves the reverb network unbuilt. See
[Mixing & Buses](/manual/audio/mixing/) for changing these at runtime.

## Persisting player choices

Settings you edit here are the project's defaults. When a player changes volume
in an options menu, call `Sound.SaveMixSettings()` to write the current bus
volumes back to the same file so they survive a restart.
