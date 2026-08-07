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

One worker thread per core (`hardware_concurrency() - 1` by default). Each job
runs on a pooled user-mode fiber.

Work is **sharded per worker**: every worker owns one lock-free MPMC queue per
priority band, drains its own first, and steals from other workers when they run
dry. A burst submit is spread across those queues at enqueue time
(`DistributeJobs`) so every worker has local work immediately instead of every
consumer funnelling through one shared queue. The owner dequeues through a home
consumer token; thieves dequeue tokenless.

Idle workers are not spinning. Each parks on its own futex (`std::atomic::wait`)
and a submitter wakes as many as it has jobs for, targeted through an idle
bitmask — so a fan-out wakes idle workers in parallel rather than filing them
one at a time through a single condition variable.

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

### Pools and allocation

Counters and fibers come from fixed pools sized at `Initialize`: 8192 counters,
256 work fibers with a 512 KB reserved stack each by default. The free lists for
both are **bounded lock-free rings** (`TBoundedMPMCQueue`, a Vyukov ring),
allocated once at startup and never again — they cannot hold more than the pool
they hand out from, so an unbounded queue there would buy nothing but allocation
and a per-thread producer on every thread that ever touched them.

The job queues themselves stay unbounded, because a submit burst has no such
ceiling.

Steady-state job submission and completion therefore allocate nothing. If the
memory profiler shows allocations under `Jobs::`, something has changed.

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
that must never yield — a loop whose correctness depends on staying on one thread
for its whole duration. A park while the guard is active logs a loud error naming
the guard; the park still proceeds, so it is a tripwire rather than a block.

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

Priorities are `ETaskPriority::High` / `Medium` / `Low`, mapping onto the
matching `Jobs::EJobPriority` bands.

### Priority bands

`Jobs::EJobPriority` has four bands, most urgent first:

| Band | Meaning |
| --- | --- |
| `High` | Latency-critical work on the frame's critical path. |
| `Normal` | The default. |
| `Low` | Runs when nothing more urgent is queued. |
| `Background` | Throughput work that must never be charged to somebody else's latency. |

The first three are urgency hints *within* the pool — an idle worker will happily
run a `Low` job, and a thread assist-waiting on an unrelated counter will happily
inline one. `Background` is different in exactly one way: **an assist-wait never
dequeues from it** (`kMaxAssistPriority` is `Low`), so a terrain build or an asset
cook can never end up executing inside a frame's wait.

Use `Background` for work nothing in the current frame depends on and whose
duration dwarfs a frame. Do **not** use it for a fan-out the submitting thread is
about to wait on: that thread would spin instead of helping, since refusing to
inline `Background` is the whole point.

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
| "No-park guard" error | A fiber parked on a thread that had marked itself a serial pump with `SetThreadNoParkGuard`. |
| An assist-wait spins with work queued | The queued work is `Background`, which assist-waits refuse by design. Submit at `Low` or above if the waiter should help. |
