---
title: Tweens
description: Animate a value or a transform over time, with easing, chaining and looping.
---

Tweens live on `World.Tweens`. A tween interpolates something over a duration
and advances with the world, so it pauses when the world pauses and dies when
the world is destroyed.

```csharp
// Slide an entity up over half a second, easing out.
World.Tweens.CreateFor(Entity)
    .MoveTo(Entity, new FVector3(0, 3, 0), 0.5f)
    .Trans(Transition.Quad).EaseWith(Ease.Out);
```

Every method returns the same tween, so a sequence reads as one chain.

## Creating

| Method | Effect |
| --- | --- |
| `Create()` | Runs to completion regardless of what it drives |
| `CreateFor(owner)` | Killed automatically when `owner` is destroyed |

Prefer `CreateFor` for anything driving an entity. A tween outliving its target
would otherwise keep writing to a destroyed entity for the rest of its duration.

## Tweeners

A tween is a list of steps. Each of these adds one.

| Method | Effect |
| --- | --- |
| `MoveTo(entity, position, duration)` | Local-space position |
| `RotateTo(entity, rotation, duration)` | Local-space rotation, slerped so it takes the short way |
| `ScaleTo(entity, scale, duration)` | Local-space scale |
| `Value(from, to, duration, setter)` | Interpolates a float and hands each value to `setter` |
| `Interval(duration)` | Dead time, for spacing steps apart |
| `Call(callback)` | Fires once when the step is reached |

`Value` is the general case. The setter is a normal C# delegate, so it can drive
anything you can write to.

```csharp
// Ramp an animation parameter rather than snapping it.
World.Tweens.CreateFor(Entity)
    .Value(0.0f, 1.0f, 0.25f, Speed => World.Animation.SetFloat(Entity, "Speed", Speed));
```

Each tweener samples its starting value the first time it runs, not when you
build it. Chained moves therefore begin wherever the previous step left off.

## Sequencing

Steps run one after another by default. `Parallel()` puts the next tweener in
the same step as the last, so they run together.

```csharp
// Move and scale at once, then wait, then fire a callback.
World.Tweens.CreateFor(Entity)
    .MoveTo(Entity, Target, 1.0f)
    .Parallel()
    .ScaleTo(Entity, new FVector3(2, 2, 2), 1.0f)
    .Interval(0.25f)
    .Call(() => Debug.Log("Arrived"));
```

A step finishes when its longest tweener does. Time the step did not need rolls
into the next one, so a long frame will not swallow a short step.

## Easing

`Trans` picks the curve family and `EaseWith` picks the direction. Both apply to
the tweener that was added last, so set them right after the call they shape.

| `Transition` | Shape |
| --- | --- |
| `Linear` | Constant velocity |
| `Sine`, `Quad`, `Cubic`, `Quart`, `Quint`, `Expo`, `Circ` | Increasingly sharp acceleration |
| `Back` | Overshoots slightly before settling |
| `Elastic` | Oscillates past the target and rings down |
| `Bounce` | Settles in decaying hops |
| `Spring` | Overshoots once, softer than `Back` |

| `Ease` | Applies the curve to |
| --- | --- |
| `In` | The start |
| `Out` | The end |
| `InOut` | Both ends |
| `OutIn` | The middle |

`Back`, `Elastic`, `Bounce` and `Spring` leave the 0 to 1 range on purpose. That
is what gives them their character, but it also means a value tween using one
can briefly pass its target, so do not use them for something that must stay in
range.

## Loops, speed and control

| Method | Effect |
| --- | --- |
| `SetLoops(count)` | Repeat the whole sequence. `0` repeats forever, `1` is the default |
| `SetSpeedScale(scale)` | Multiplies the rate of the whole tween |
| `Delay(seconds)` | Holds back the last-added tweener before it starts |
| `SetPaused(paused)` | Freezes progress without discarding it |
| `Kill()` | Stops immediately, leaving whatever it drove at its current value |
| `OnFinished(callback)` | Fires after the last step, including after the final loop |
| `IsRunning` | False once the tween has finished or been killed |

```csharp
Tween Pulse = World.Tweens.CreateFor(Entity);
Pulse.ScaleTo(Entity, new FVector3(1.2f, 1.2f, 1.2f), 0.3f)
     .Trans(Transition.Sine).EaseWith(Ease.InOut)
     .SetLoops(0);

// Later.
Pulse.Kill();
```

A `Tween` value stays safe to hold after the tween ends. The handle is
generational, so a finished or killed tween reports `IsRunning` as false rather
than reaching into a recycled slot.

## From C++

The same library is available natively through `World->GetTweenManager()`, with
the same chaining and an additional typed `To` for any value that supports
`Lerp`.

```cpp
World->GetTweenManager().CreateForEntity(Entity)
    .MoveTo(Entity, Target, 1.0f).Trans(EEaseTransition::Back).Ease(EEaseType::Out)
    .Interval(0.25f)
    .Call([] { /* ... */ });
```

The easing itself lives in `Core/Math/Easing.h` as `Easing::Evaluate`, separate
from the tween runner, so any code that just wants a curve can call it directly.
It is `constexpr` for the polynomial families, which means a curve table can be
built at compile time.

```cpp
static_assert(Easing::Evaluate(EEaseTransition::Cubic, EEaseType::In, 0.5f) == 0.125f);
```

`Easing::IsConstantEvaluable(transition)` reports which families fold today. The
rest need `sin`, `cos`, `pow` or `sqrt`, which are not `constexpr` until a
toolchain ships C++26 constexpr cmath, at which point they start folding with no
code change.

## Notes

Tweens advance in the `FrameStart` stage, before gameplay systems run, so a
system reading a transform in the same frame sees the tweened value.

Animation blend curves use a different, separate easing set
(`EAnimAlphaEasing`). That one guarantees every curve is monotonic and stays in
range, which the overshooting transitions here deliberately are not, so the two
are not interchangeable.
