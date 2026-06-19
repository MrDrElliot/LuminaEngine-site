---
title: Timers
description: Schedule one-shot and repeating callbacks against world time.
---

Timers live on `World.Timers`. They run callbacks after a delay or on a repeat,
measured in world time — so they pause when the world pauses and stop when it is
destroyed.

```csharp
// Do something once, two seconds from now.
World.Timers.Delay(2.0f, () => Debug.Log("Two seconds later"));

// Repeat every half second.
World.Timers.SetTimer(0.5f, Tick, Loop: true);
```

A timer's callback is a normal C# delegate, so it captures whatever it needs
from the surrounding scope.

## Scheduling

| Method | Returns / effect |
| --- | --- |
| `Delay(seconds, callback)` | Run `callback` once after `seconds`. Self-cleaning. |
| `SetTimer(seconds, callback, loop, firstDelay)` | One-shot, or repeating every `seconds` when `loop` is true |
| `SetTimerForEntity(owner, seconds, callback, loop, firstDelay)` | As `SetTimer`, but cleared automatically when `owner` is destroyed |

`firstDelay` (default −1, meaning "same as the interval") overrides only the
wait before the *first* fire — handy for staggering many loopers so they don't
all run on the same frame.

```csharp
// Spread 10 spawners across the first second, then each repeats every second.
for (int i = 0; i < 10; ++i)
{
    int Index = i;
    World.Timers.SetTimer(1.0f, () => Spawn(Index), Loop: true, FirstDelay: Index * 0.1f);
}
```

## Inspecting and cancelling

`SetTimer` returns a `TimerHandle`. Keep it to query or cancel the timer.

```csharp
TimerHandle Reload = World.Timers.Delay(ReloadTime, FinishReload);

// Cancel if interrupted.
if (Cancelled)
{
    World.Timers.Clear(Reload);
}

float Left = World.Timers.GetRemaining(Reload);   // seconds until next fire
```

| Method | Returns / effect |
| --- | --- |
| `Clear(handle)` | Cancel a timer and release its callback |
| `IsActive(handle)` | `true` while the timer is scheduled |
| `GetRemaining(handle)` | Seconds until the next fire |
| `GetElapsed(handle)` | Seconds elapsed in the current interval |
| `SetPaused(handle, paused)` | Pause or resume a timer without losing its progress |

## Lifetime

One-shot timers (`Delay`, or `SetTimer` with `Loop: false`) release their
callback automatically once they fire — you never have to clean them up.

**Looping timers hold their callback until you cancel them.** Clear them before
the world goes away — typically in `OnDetach`:

```csharp
private TimerHandle _heartbeat;

public override void OnReady()
{
    _heartbeat = World.Timers.SetTimer(1.0f, Pulse, Loop: true);
}

public override void OnDetach()
{
    World.Timers.Clear(_heartbeat);
}
```

Or use `SetTimerForEntity` with your own entity as the owner, so the timer is
cancelled automatically when the entity is destroyed.
