---
title: Animation
description: Play single clips, drive an animation graph, and layer montages from a script.
---

Animation lives on `World.Animation`. Every method takes the **entity** you want
to animate, which needs a skeletal mesh for the pose to show. There are two ways
to drive it, and you pick per entity by which component it has:

- **A single clip**, play one animation directly (attacks, reactions,
  one-shots). Backed by `SSimpleAnimationComponent`.
- **An animation graph**, a state machine you steer by setting named
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
to play. You set **parameters**, and its transitions decide. Parameters are
named values declared as fields on the graph's **parameter struct**.

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
values speculatively.

The calls above resolve the name to a field on the graph's parameter struct every
call. When you know the struct, prefer typed access instead: a field is checked at
compile time, and a typo is an error rather than a silent no-op.

```csharp
var Anim = Registry.Get<SAnimationGraphComponent>(Entity);

if (Anim.GetParameters<SLocomotionParams>() is { } P)
{
    P.Speed = Velocity.Length;
    P.bGrounded = Grounded;
}
```

`GetParameters<T>()` returns null when the graph names a different struct, so the
type is checked before you get a handle to the memory. `RequireParameters<T>()`
throws instead if you would rather fail loudly.

A typical locomotion update looks like this:

```csharp
public override void OnUpdate(float DeltaTime)
{
    FVector3 Velocity = World.Physics.GetLinearVelocity(Entity);
    World.Animation.SetFloat(Entity, "Speed", Velocity.Length);
    World.Animation.SetBool(Entity, "Falling", Velocity.Y < -0.1f);
}
```

## Montages

A montage plays a clip **over** whatever the graph is already doing, on a named
slot. The entity's graph needs a Slot node matching one of the montage's slot
tracks; without it nothing is heard. This is how an attack, a reload, or a hit
reaction rides on top of locomotion instead of replacing it.

```csharp
CAnimationMontage? Attack = AttackMontage.Get();
if (Attack is not null)
{
    World.Animation.PlayMontage(Entity, Attack);
}
```

| Method | Effect |
| --- | --- |
| `PlayMontage(entity, montage, playRate, section)` | Blends out anything already on the slots it uses. Returns 0 when nothing started |
| `StopMontage(entity, montage, blendOutTime)` | A null montage stops every montage; a negative blend time uses the montage's own |
| `IsMontagePlaying(entity, montage)` | A null montage asks whether *any* montage is contributing |
| `GetMontagePosition(entity, montage)` | Seconds into the montage |
| `GetMontageWeight(entity, montage)` | How strongly it is blended over the graph pose, 0 to 1 |
| `GetMontageSection(entity, montage)` | The section playing now |
| `SetMontagePlayRate(entity, montage, rate)` | Retime it while it plays |
| `JumpToMontageSection(entity, montage, section)` | Re-arms a montage that was blending out, which is how a combo follow-up chains |
| `SetNextMontageSection(entity, montage, section)` | Overrides the authored link, taken at the current section's end |

The same calls exist on `SAnimationGraphComponent` itself when you already have
the component in hand.

### Reacting to a notify

An animation notify fires at an authored point in a clip. Poll it on the
component the frame it lands rather than guessing from the playhead.

```csharp
var Graph = Registry.TryGet<SAnimationGraphComponent>(Entity);
if (Graph is not null && Graph.WasNotifyTriggered("Hit"))
{
    ApplyMeleeDamage();
}
```

`SSimpleAnimationComponent` has the same `WasNotifyTriggered`, plus
`IsNotifyStateActive(name)` for a notify with a duration, and both components
expose `GetCurveValue(name, default)` for a curve authored on the clip.

:::note
The two backends are independent: single-clip calls (`Play`, `Stop`, …) act on
the simple component, parameter and montage calls act on the graph component. An
entity normally uses one or the other.
:::
