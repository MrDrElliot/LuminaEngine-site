---
title: Parallel Work
description: Running heavy compute across worker threads, and timing sequences without coroutines.
---

When a script has expensive, parallelizable compute — generating a heightfield,
processing a large array, baking data — the `Task` library spreads it across the
engine's worker threads. This is the C# mirror of the native `Lumina::Task`
system.

:::caution[Compute only — task bodies must not block]
Task bodies run on the engine's fiber-based worker threads. A body **must be
self-contained compute**: it must not block, await, sleep, perform I/O, take a
long-held lock, or call engine APIs that are game-thread only (the world,
registry, physics). Parallel number-crunching into preallocated buffers is the
supported use; anything that yields its thread will corrupt the runtime.
:::

## Parallel-for

`Task.ParallelFor(count, body)` splits `[0, count)` across the worker pool and
runs `body(i)` for each index. It **blocks** until every index is done, so the
results are ready when it returns:

```csharp
FVector3[] Points = ...;
float[] Heights = new float[Points.Length];

Task.ParallelFor(Points.Length, i =>
{
    Heights[i] = SampleNoise(Points[i]);   // pure compute, no engine calls
});

// Heights is fully populated here.
```

Have each index write to its own slot (as above) so the workers never touch the
same memory.

## One-shot background work

`Task.Run(body)` schedules `body` to run once on a worker thread and returns a
`TaskHandle` to wait on. You own the handle — `Wait()` for completion, then
dispose it (a `using` block is the safe pattern):

```csharp
using TaskHandle Handle = Task.Run(() => BakeLightingData());
// ... do unrelated work on the game thread ...
Handle.Wait();   // block until the bake finishes
```

| Call | Does |
| --- | --- |
| `Task.ParallelFor(count, body)` | Run `body(i)` for each index across workers; blocks until done. |
| `Task.Run(body)` | Run `body` once on a worker; returns a `TaskHandle`. |
| `Task.WaitForAll()` | Block until every submitted task has completed. |
| `Task.WorkerCount` | Number of background worker threads. |

## Timing and sequences

C# scripts don't have coroutines that pause mid-hook. To run something after a
delay, or to step through a sequence, **drive it from `OnUpdate`** with a small
amount of state — accumulate `DeltaTime` and act when a timer elapses:

```csharp
private float _OpenIn = -1.0f;   // < 0 means "not opening"

public void BeginOpen()
{
    _OpenIn = 0.25f;             // open a quarter-second from now
}

public override void OnUpdate(float DeltaTime)
{
    if (_OpenIn >= 0.0f)
    {
        _OpenIn -= DeltaTime;
        if (_OpenIn < 0.0f)
        {
            Open();
        }
    }
}
```

For multi-step sequences, a small `enum` state machine advanced in `OnUpdate`
keeps the logic readable without blocking the frame. State held in instance
fields is naturally cleaned up when the entity is destroyed.
