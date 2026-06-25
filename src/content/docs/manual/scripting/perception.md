---
title: AI Perception
description: Give entities sight, hearing, and damage senses, and react when they perceive or lose a target.
---

**Perception** lets an entity sense the world the way an AI agent needs to: it
can *see* other entities inside a vision cone, *hear* noises reported nearby,
and notice *who damaged it*. The system tracks what each perceiver is currently
aware of, remembers a target's last known location for a while after it slips
away, and raises events the moment awareness is gained or lost.

It is built from two components and one facade:

| Piece | Role |
| --- | --- |
| `SPerceptionComponent` | Put it on the **perceiver** (the AI). Defines its senses and holds what it currently perceives. |
| `SAIStimuliSourceComponent` | Put it on anything the AI should be able to **sense** (the player, other NPCs, props). |
| `World.Perception` | The script facade: query perceived state, inject noise/damage, register sources at runtime. |

A perceiver only senses a source when their **affiliation tags** agree (see
[Affiliation](#affiliation-who-can-sense-whom)), so a guard can ignore its own
team and react only to intruders.

## Quick start

Add an `SPerceptionComponent` to your AI and an `SAIStimuliSourceComponent` to
the things it should notice (both authored in the editor under the **AI**
category, or added from script). Then react in your `EntityScript`:

```csharp
public sealed class Guard : EntityScript
{
    [RequireComponent] private SPerceptionComponent _Perception = null!;

    public override void OnReady()
    {
        _Perception.OnTargetPerceived.Bind(OnSpotted);
        _Perception.OnTargetLost.Bind(OnLost);
    }

    private void OnSpotted(SPerceptionEvent Event)
    {
        // We just became aware of Event.Target via Event.Sense.
        Debug.Log($"Spotted {Event.Target} via {Event.Sense}");
        MoveTo(Event.Location);
    }

    private void OnLost(SPerceptionEvent Event)
    {
        // Event.Location is where we last knew the target to be.
        Debug.Log($"Lost {Event.Target}, searching last known spot");
        MoveTo(Event.Location);
    }
}
```

That is the whole loop for most AI: get told when a target appears, get told
when it is lost, and use the queries below for everything in between.

## The perceiver

`SPerceptionComponent` declares which senses run and how far they reach. Every
field is editable in the inspector and exposed to script.

### Sight

Sight is scanned by the perception system on a throttle. A source is seen when
it is inside the **vision cone**, within range, and has unobstructed line of
sight.

| Property | Default | Meaning |
| --- | --- | --- |
| `bSightEnabled` | `true` | Master switch for the sight sense. |
| `SightRadius` | `20` m | Distance at which a target is **first** seen. |
| `LoseSightRadius` | `25` m | Distance at which an already-seen target is **dropped**. |
| `SightFOVDegrees` | `90°` | Full vision cone angle. |
| `EyeOffset` | `(0, 1.6, 0)` | Eye height (along entity up); the ray origin. |
| `SightBlockingMask` | Static \| Dynamic | Which collision layers block line of sight. |

`SightRadius` and `LoseSightRadius` form a **hysteresis** band: a target is
acquired only inside the tighter `SightRadius` *and* the FOV cone, but once
seen it is retained out to the larger `LoseSightRadius` regardless of angle.
This stops a target that steps to the perceiver's side — faster than the AI can
physically turn — from being dropped and re-acquired every scan. Keep
`LoseSightRadius >= SightRadius`.

Line of sight is a physics raycast from the eye to the source's
[aim point](#the-source), ignoring the perceiver's own body. Anything on
`SightBlockingMask` between them breaks the line.

### Hearing

Hearing is **event-driven** — nothing is scanned. Call
`World.Perception.ReportNoise` when something makes a sound, and every perceiver
within range that cares about the instigator hears it.

| Property | Default | Meaning |
| --- | --- | --- |
| `bHearingEnabled` | `true` | Master switch for hearing. |
| `HearingRadius` | `15` m | Base radius; scaled by the reported loudness. |

```csharp
// A footstep at half loudness, a gunshot at triple.
World.Perception.ReportNoise(FootLocation, 0.5f, Instigator: Entity);
World.Perception.ReportNoise(MuzzleLocation, 3.0f, Instigator: Entity);
```

The effective radius is `HearingRadius * Loudness`, so loudness is a multiplier,
not an absolute distance.

### Damage

Damage is also event-driven and **affiliation-agnostic**: you always notice who
hurt you, regardless of tags.

| Property | Default | Meaning |
| --- | --- | --- |
| `bDamageEnabled` | `true` | Master switch for damage sense. |

```csharp
World.Perception.ReportDamage(Victim: Entity, Instigator: Attacker, HitLocation, Amount: 25.0f);
```

The victim immediately perceives the instigator, with `Event.Strength` carrying
the damage amount.

### Memory and throttling

| Property | Default | Meaning |
| --- | --- | --- |
| `ForgetTime` | `5` s | How long a lost target is remembered before `OnTargetLost` fires. |
| `UpdateInterval` | `0.1` s | Minimum seconds between sight scans for this perceiver. |
| `DetectableTags` | *(empty)* | Affiliation filter — see below. Empty senses everyone. |

While a target is sensed its memory timer is held at zero. When it slips out of
sight (or a heard/damaged target's momentary stimulus ends) the timer counts up;
during this window `GetLastKnownLocation` still returns where the target was last
seen. Only after `ForgetTime` elapses is the target truly forgotten and
`OnTargetLost` raised.

`UpdateInterval` spreads sight cost across frames: raising it makes a crowd of
AI cheaper at the cost of slower reaction. Hearing and damage are unaffected —
they always apply the tick they are reported.

## The source

To be perceivable, an entity needs an `SAIStimuliSourceComponent`.

| Property | Default | Meaning |
| --- | --- | --- |
| `AffiliationTags` | *(empty)* | Identity tags this source broadcasts (e.g. `Team.Red`). |
| `RegisteredSenses` | Sight \| Hearing | Which passive senses this source can be detected by. |
| `SightTargetOffset` | `(0, 1.0, 0)` | Aim point offset (along up) so LoS rays target the torso, not the floor. |

`RegisteredSenses` gates passive detection only — damage is always reported
explicitly via `ReportDamage`, so a source need not register for it.

## Affiliation: who can sense whom

Sight and hearing are filtered by **gameplay tags**:

- A source advertises its identity through `AffiliationTags`.
- A perceiver lists which identities it cares about in `DetectableTags`.
- The perceiver senses the source only when `DetectableTags` matches **any** of
  the source's `AffiliationTags`.

An **empty** `DetectableTags` filter senses everyone — handy for an omniscient
sensor or while prototyping. Damage ignores affiliation entirely.

```csharp
// A red-team guard that only reacts to the blue team.
World.Perception.AddDetectableTag(Guard, GameplayTag.Request("Team.Blue"));
```

## Reacting to perception

The primary way to respond is to bind the perception component's two events,
`OnTargetPerceived` and `OnTargetLost`, shown in [Quick start](#quick-start).
Both carry an `SPerceptionEvent`, oriented from the perceiving entity's point of
view.

| Field | Meaning |
| --- | --- |
| `Perceiver` | This entity (the one sensing). |
| `Target` | The entity that was perceived or lost. |
| `Location` | Last known / stimulus world location of the target. |
| `Sense` | The `EAISenseChannel` that triggered the event (`Sight`, `Hearing`, or `Damage`). |
| `Strength` | Damage amount or noise loudness; `0` for sight. |

`EAISenseChannel` is a bit-flag enum, so a target can be sensed by more than one
channel at once.

:::note
Perception handlers run during the system's event-dispatch phase, *after* the
state has settled for the tick. That makes it safe to add or remove components
(including the perceiver's own script) from inside a handler.
:::

Native C++ systems can subscribe without touching script: the system exposes
`SPerceptionSystem::OnTargetPerceived` / `OnTargetLost` multicast delegates, and
dispatches an in-ECS `FPerceptionUpdatedEvent` that any system can read through
its event sink.

## Querying perceived state

Use `World.Perception` for follow-up logic between events — checking whether a
known target is *still* visible, picking the nearest threat, or doing a one-off
line-of-sight test.

| Method | Returns |
| --- | --- |
| `GetClosestPerceivedTarget(perceiver)` | Nearest perceived entity, or `Entity.Null`. |
| `GetPerceivedTargets(perceiver)` | All currently-tracked targets (`Entity[]`). |
| `GetPerceivedTargets(perceiver, Span<uint>)` | Allocation-free variant into a caller buffer; returns the count. |
| `CanSense(perceiver, target)` | `true` if sensed right now by any channel. |
| `CanSense(perceiver, target, sense)` | `true` if sensed by that specific channel this tick. |
| `GetLastKnownLocation(perceiver, target)` | `FVector3?` — last seen position, or `null` if not remembered. |
| `HasLineOfSight(from, to)` | One-shot LoS test between two entities (eye/aim offsets applied). |

```csharp
Entity Threat = World.Perception.GetClosestPerceivedTarget(Entity);
if (Threat != Entity.Null && World.Perception.CanSense(Entity, Threat, EAISenseChannel.Sight))
{
    AimAt(Threat);
}
else if (World.Perception.GetLastKnownLocation(Entity, Threat) is FVector3 LastSeen)
{
    // Sound or memory only — investigate where we last had eyes on it.
    MoveTo(LastSeen);
}
```

A single perceiver tracks up to `Perception.MaxPerceivedTargets` (16) targets at
once; the closest are kept.

## Registering at runtime

You do not have to author every component in the editor. Spawned entities can be
wired up from script:

| Method | Effect |
| --- | --- |
| `RegisterAsSource(entity, affiliation, senses)` | Adds an `SAIStimuliSourceComponent`, sets its senses, and adds one affiliation tag. |
| `AddDetectableTag(perceiver, tag)` | Ensures an `SPerceptionComponent` and adds a tag to its filter. |
| `ReportNoise(location, loudness, instigator)` | Inject a hearing stimulus. |
| `ReportDamage(victim, instigator, hitLocation, amount)` | Inject a damage stimulus. |

```csharp
// Make a freshly spawned pickup audible-and-visible to the red team.
World.Perception.RegisterAsSource(Pickup, GameplayTag.Request("Team.Red"),
    EAISenseChannel.Sight | EAISenseChannel.Hearing);
```

For richer tag sets, author the component in the editor — `RegisterAsSource`
adds a single affiliation tag as a convenience.

## Debugging

Perception can draw its sight cones, sense-range spheres, and lines to perceived
targets. Two switches, OR'd together:

- The **`ai.Perception.Debug`** console variable draws *every* perceiver.
- The per-component **`bDrawDebug`** property (under **AI → Perception →
  Debug**) draws a single chosen perceiver.

Cones are colored by sense; a line to a target is green while currently sensed
and amber while only remembered (within the forget window).

## How it performs

The system is built to scale to a crowd of perceivers:

- Stimulus sources are gathered into a **spatial grid** each tick, so a
  perceiver only tests sources inside its sight radius rather than the whole
  world.
- The per-perceiver sight scan — including the line-of-sight raycasts — runs in
  **parallel** across the job system.
- `UpdateInterval` throttles each perceiver's sight scan; hearing and damage are
  zero-cost until something is reported.
- Sight is **sticky** (held across ticks); hearing and damage are **momentary**
  (they last only the tick of the report), which keeps the tracked set tight.
