---
title: Task System
description: The fiber job scheduler, counters, ParallelFor, task graph, futures, and fiber-aware locks.
---

`Engine/Source/Runtime/TaskSystem` is two layers:

- **`Lumina::Jobs`** (`Scheduler/JobScheduler.h`), the low-level fiber scheduler.
  Raw job submission, counters, fiber park and resume.
- **The task API** on top: `Task::ParallelFor`, `FTaskGraph`, `TFuture` /
  `TPromise`, `TTask` coroutines, and fiber-aware locks.

Application code should stay on the upper layer. Reach for `Jobs` directly only
when building a new primitive.

## The scheduler

One worker thread per core (`hardware_concurrency() - 1` by default) drains
lock-free MPMC queues, one per priority. Each job runs on a pooled user-mode
fiber.

When a job waits on a counter, the fiber **parks** and the worker switches to
other runnable work. The fiber resumes later, possibly on a different worker.
Compared to a blocking wait, this keeps every core productive, makes nested
parallelism deadlock-free, and suspends the waiting stack instead of holding a
thread hostage.

```cpp
Jobs::Initialize({
    .NumWorkerThreads   = 0,   // 0 => hardware_concurrency() - 1
    .NumExternalThreads = 8,   // reserved slots for main / other non-worker threads
    .NumWorkFibers      = 0,   // 0 => default pool size
    .FiberStackSize     = 0,   // 0 => default per-fiber reserved stack
});
```

`Task::Initialize()` in `FEngine::Init` does this for you.

### Thread slots

`Jobs::GetNumThreadSlots()` is the array-sizing bound for per-thread data:
workers plus reserved external slots. `Jobs::GetWorkerIndex()` returns the dense
slot for the calling OS thread.

`GetWorkerIndex()` is stable per OS thread but **a job's slot is only valid until
its first wait**. A parked fiber may resume on a different worker. Re-read the
index after any wait rather than caching it across one. The same applies to
`thread_local` storage: use `Jobs::GetCurrentFiberHandle()` when you need a
stable "am I still the same logical execution?" identity.

Non-worker threads claim a slot with `RegisterExternalThread()` and release it
with `UnregisterExternalThread()`.

### Counters

A counter is the only dependency primitive. `AllocCounter(N)` hands back a
counter set to `N`; a counter is "done" when it reaches the waited-for target
(0 by default).

```cpp
Jobs::FCounter* Counter = Jobs::AllocCounter();
Jobs::RunJobs(Jobs, Count, Jobs::EJobPriority::Normal, Counter); // +Count up front
Jobs::WaitForCounter(Counter);                                   // each job -1 on completion
Jobs::FreeCounter(Counter);
```

- `RunJobs` / `RunJob` increment the counter by the job count up front, and each
  job decrements it on completion.
- `DecrementCounter` lets you signal a counter that is not tied to a job, which
  is how graph fan-in works.
- `SetCounterCompletion(Counter, Fn, Ctx)` fires a one-shot callback on a worker
  the moment the counter hits zero. The callback may free the counter.
- `WaitForCounter` parks on a worker and assist-waits on an external thread.
- `WaitForAll()` blocks until every job submitted so far has completed.

### Fiber park and resume

`ParkFiber` / `ResumeFiber` are the foundation everything else is built on.

```cpp
Jobs::ParkFiber(
    [](void* Ctx, Jobs::FFiberHandle Handle) -> bool
    {
        // Called on the scheduler fiber, AFTER this fiber's context is saved.
        // Link Handle into your wait queue under your own lock here.
        // Return false to abort the park (the condition became true in the meantime).
        return true;
    },
    &MyQueue);
```

The "return false to abort" path is what closes the race between checking a wait
condition and parking on it. `ResumeFiber(Handle)` is callable from any thread.

**Worker fibers only.** External threads have no fiber to suspend, so
fiber-aware primitives branch on `IsWorkerThread()` and assist-wait with
`AssistOneJob()` instead.

`SetThreadNoParkGuard(Name)` marks the calling thread as running a serial pump
that must never yield. The render drain sets it. A park while the guard is
active logs a loud error naming the guard; the park still proceeds, so it is a
tripwire rather than a block.

## ParallelFor

The everyday entry point. `GTaskSystem->ParallelFor` splits `[0, Num)` across
workers. Ranges are unordered.

```cpp
GTaskSystem->ParallelFor(Num, [&](uint32 Index)
{
    // per item
});

GTaskSystem->ParallelFor(Num, [&](const Task::FParallelRange& Range)
{
    for (uint32 i = Range.Start; i < Range.End; ++i) { /* ... */ }
    // Range.Thread is the worker slot; valid only until this body waits
}, MinRange);
```

The lambda may take `(uint32 Index)`, `(uint32 Index, uint32 Thread)`, or
`(const FParallelRange&)`; the correct overload is selected at compile time.
`MinRange` is the grain: the smallest number of items worth handing to one
worker. `Task::ComputeChunkCount(Num, MinRange)` is the worker-balanced chunk
count, capped at `Task::kMaxChunks` (256).

`ParallelForEach(Begin, End, Func)` is the iterator form.

`ScheduleLambda(Num, MinRange, Function, Priority)` is the fire-and-forget
version: it returns an `FTaskHandle` (a shared `FTaskCompletion` flag) that you
can poll with `IsCompleted()` or block on with `Wait()`.

Priorities are `ETaskPriority::High` / `Medium` / `Low`, mapping one to one onto
`Jobs::EJobPriority`.

## Task graph

`FTaskGraph` handles fan-out, dependency, and fan-in patterns. Dependents queue
automatically when their parents complete.

```cpp
FTaskGraph Graph;
auto A = Graph.Add([]{ /* ... */ });
auto B = Graph.AddParallelFor(Count, MinRange, [](uint32 i){ /* ... */ });
// wire dependencies, then run the graph
```

Node callables are placement-constructed in the graph's own arena, so adding a
node never heap-allocates even for large captures. `AddParallelFor` with
`Count == 0` still produces a node, a no-op one, so dependents still fire.

## Futures and promises

`TPromise<T>` produces a single value; `TFuture<T>` consumes it. Waiting is
fiber-aware: a worker fiber parks until the value lands, an external thread
assist-waits.

```cpp
TPromise<FResult> Promise;
TFuture<FResult>  Future = Promise.GetFuture();

// producer, anywhere
Promise.SetValue(MakeResult());

// consumer
FResult Value = Future.Get();          // parks or assist-waits
Future.Then([](FResult Value) { ... }); // scheduled as a job when ready
```

The shared state is reference counted, so the promise, the future, and any
continuations may outlive each other in any order. Continuations are dispatched
as jobs rather than run inline on the setter, so a chain never recurses on the
thread that resolved the promise.

The store of the value happens-before the release that publishes readiness, so a
waiter that observes readiness always sees the value.

## Coroutine tasks

`TTask<T>` (`Task.h`) is the C++20 coroutine layer. The type is named `TTask`,
not `Task`, because `Lumina::Task` is already a namespace of free helpers.

Awaiting a `TTask` suspends the awaiting coroutine and resumes it on a worker
when the awaited task completes; the final suspend hands control straight to the
continuation via a symmetric-transfer `await_suspend`, so a chain does not grow
the stack. `LaunchDetached` starts a coroutine with no awaiter.

## Fiber-aware locks

`FiberSync.h` provides locks that park a fiber instead of blocking a worker:

| Type | Behavior |
| --- | --- |
| `FFiberMutex` | Non-recursive, FIFO, direct hand-off from unlocker to next waiter (no thundering herd). Re-locking on the same fiber deadlocks. |
| `FFiberSharedMutex` | Reader/writer, FIFO-fair. A waiting writer blocks newly arriving readers; readers queued behind a writer are granted as a batch. Not recursive, not upgradable. |

**Prefer these over `FMutex` / `FSharedMutex` for any lock that may be held while
a job runs, or that a job may contend.** For a lock held briefly on one thread,
the standard mutex from `Core/Threading/Thread.h` is still fine and cheaper.

## Introspection

`Jobs::FJobLiveStats` is a cheap on-demand snapshot of pool occupancy (worker
count, fiber count, free fibers, and so on), always compiled in, with no standing
cost. The editor's Task System profiler reads it. In editor builds `FJobProfiler`
additionally records per-frame job timelines; see
[Diagnostics](/internals/diagnostics/).

Job labels come from `FJobDecl::Name` (a string literal) or the `Name` argument
of `RunJob`, and show up in both the profiler and Tracy.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Data written to the wrong per-thread slot | A worker index cached across a wait. Re-read `GetWorkerIndex()` after any park. |
| Crash inside the scheduler after a migration | `/GT` missing on `JobScheduler.cpp`. It is pinned in `Engine/Source/Runtime/Runtime.Build.cs` for exactly this reason. |
| Deadlock with idle cores | A bare spin wait on an external thread. Use `WaitForCounter` or `AssistOneJob` so the waiter helps drain. |
| Deadlock re-entering a lock | `FFiberMutex` is not recursive. |
| A continuation runs on an unexpected thread | Continuations are jobs. They run on a worker, not on whichever thread called `SetValue`. |
| "No-park guard" error | A fiber parked on a thread running a serial pump, almost always the render drain. |
