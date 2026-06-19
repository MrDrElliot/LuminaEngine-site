---
title: Animation
description: Play single clips or drive an animation graph's parameters from a script.
---

Animation lives on `World.Animation`. Every method takes the **entity** you want
to animate, which needs a skeletal mesh for the pose to show. There are two ways
to drive it, and you pick per entity by which component it has:

- **A single clip** — play one animation directly (attacks, reactions,
  one-shots). Backed by `SSimpleAnimationComponent`.
- **An animation graph** — a state machine you steer by setting named
  parameters (locomotion, blends). Backed by `SAnimationGraphComponent`.

## Playing a single clip

`Play` starts (or restarts) a clip. With `Loop` false it plays once and then
reports `IsFinished`, which is the clean way to react to "the punch landed"
without polling time.

```csharp
CAnimation Punch = Asset.Load<CAnimation>("/Game/Content/Anims/Punch");

World.Animation.Play(Entity, Punch);          // one-shot
World.Animation.Play(Entity, Run, Loop: true, Speed: 1.2f);
```

`Play` adds an `SSimpleAnimationComponent` if the entity doesn't have one; every
other call below is a no-op when the entity isn't running a clip.

| Method | Effect |
| --- | --- |
| `Play(entity, clip, loop, speed)` | Start/restart a clip (null clip stops playback) |
| `Stop(entity)` | Stop and snap back to the start (bind pose) |
| `Pause(entity)` / `Resume(entity)` | Freeze / resume at the current time |
| `IsPlaying(entity)` | `true` while advancing |
| `IsFinished(entity)` | `true` once a non-looping clip completes |
| `SetSpeed(entity, speed)` | Playback rate multiplier (1 = normal) |
| `SetTime(entity, seconds)` / `GetTime(entity)` | Scrub / read the playhead |

```csharp
World.Animation.Play(Entity, Punch);
// ...next frame, somewhere in OnUpdate:
if (World.Animation.IsFinished(Entity))
{
    ReturnToIdle();
}
```

## Driving an animation graph

A graph is a state machine authored in the editor. You don't tell it which clip
to play — you set **parameters**, and its transitions decide. Parameters are
named floats and bools, resolved by name.

```csharp
World.Animation.SetFloat(Entity, "Speed", Velocity.Length);
World.Animation.SetBool(Entity, "IsGrounded", Grounded);
World.Animation.SetBool(Entity, "Jump", JumpPressed);
```

| Method | Effect |
| --- | --- |
| `SetFloat(entity, name, value)` | Set a named float parameter |
| `GetFloat(entity, name, default)` | Read a named float parameter |
| `SetBool(entity, name, value)` | Set a named bool parameter |
| `GetBool(entity, name, default)` | Read a named bool parameter |
| `HasParameter(entity, name)` | `true` if the graph declares that parameter |

Setting a parameter the graph doesn't declare is a no-op, so it's safe to push
values speculatively. A typical locomotion update looks like this:

```csharp
public override void OnUpdate(float DeltaTime)
{
    FVector3 Velocity = World.Physics.GetLinearVelocity(Entity);
    World.Animation.SetFloat(Entity, "Speed", Velocity.Length);
    World.Animation.SetBool(Entity, "Falling", Velocity.y < -0.1f);
}
```

:::note
The two backends are independent: single-clip calls (`Play`, `Stop`, …) act on
the simple component, parameter calls (`SetFloat`, …) act on the graph
component. An entity normally uses one or the other.
:::
