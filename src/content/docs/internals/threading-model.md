---
title: Threading Model
description: Which threads exist, what each may touch, and where the hand-offs are.
---

Lumina has fewer OS threads than its subsystem list suggests. What used to be a
dedicated render thread, a dedicated physics thread, and a dedicated audio update
thread are now **jobs on the fiber pool**. The threads that actually exist are:

| Thread | Count | Owner |
| --- | --- | --- |
| Main (game) thread | 1 | `LuminaMain` / `FApplication::Run` |
| Job scheduler workers | `hardware_concurrency() - 1` by default | `Lumina::Jobs` |
| Log backend | 1 | `Logging::Init` |
| Hang watchdog | 1 | `HangWatchdog::Start` |
| Audio device callback | 1 | miniaudio, driven by the audio device |
| CoreCLR internals (GC, finalizer, tiered JIT) | runtime-defined | .NET, when the scripting host is up |

Everything else is a job. See [Task System](/internals/task-system/) for the
scheduler itself.

## Main thread

The main thread runs `FApplication::Run`. It owns:

- The OS window and the GLFW event pump. **Window and surface creation are main
  thread only.** `RHI::CreateSurface` must be called here, then the handle
  passed to the render side to build a swapchain on.
- The whole update-stage sequence, so all game-thread ECS access.
- ImGui frame construction (`FRenderManager::FrameStart` calls `ImGui::NewFrame`).
- Asset loading requests, though the work fans out to jobs.

`MainThread::Enqueue(callback)` is the deferral primitive: thread-safe, runs the
callback once on the main thread during the next frame's `FrameStart`, in FIFO
order. Use it from a worker when you need to touch main-thread-only state.

## Job workers and fibers

Worker threads drain lock-free MPMC queues, one per priority
(`High` / `Normal` / `Low`). Each job runs on a pooled user-mode fiber. When a
job waits on a counter it does **not** block its worker: the fiber parks and the
worker picks up other runnable work. The fiber resumes later, possibly on a
different worker.

Two consequences you must design around:

- **A fiber migrates.** Thread identity does not survive a wait. Never cache
  `Jobs::GetWorkerIndex()` across a `WaitForCounter`, and never use a
  `thread_local` as a "same logical execution" flag; use
  `Jobs::GetCurrentFiberHandle()` instead.
- **`JobScheduler.cpp` is compiled with `/GT`** (fiber-safe thread-local
  storage). Without it the scheduler reads stale TLS after a migration and
  crashes. `Runtime.Build.cs` pins this flag on that one file with
  `AddPerFileOption`.

Non-worker threads (main, and any thread registered with
`RegisterExternalThread`) are not on fibers. A `WaitForCounter` from one of them
**assist-waits**: it runs queued jobs inline until the counter is satisfied. That
keeps the system deadlock-free when the awaited signal itself depends on other
jobs.

## The render drain

There is no render OS thread. `FRenderThread` owns a strict-FIFO queue of
commands enqueued from the game thread, and drains them on a single
**auto-arming pool job**. Only one drain runs at a time, so FIFO ordering and
single-threaded recording and submission are preserved, but the work rides a
worker instead of occupying a dedicated thread.

```cpp
ENQUEUE_RENDER_COMMAND(UploadThing)([Snapshot = Move(Snapshot)]() mutable
{
    // runs on the render drain
});
```

Rules:

- `FRenderThread::IsInRenderStage()` tells you whether you are inside the drain.
  The old thread-id-based `Threading::IsRenderThread()` check is meaningless now
  that the drain rides a pool worker.
- The drain is marked with `Jobs::SetThreadNoParkGuard`. If a render command
  parks a fiber, the scheduler logs a loud error naming the guard. Parking
  strands the serial pump and can resume it on a different thread, breaking its
  thread-local state. The park still proceeds; the guard is a tripwire, not a
  block.
- When the system is down (before `Start`, after `Stop`), `Enqueue` runs the
  command inline on the caller.
- `FlushRenderingCommands()` blocks until the queue drains. It is reserved for
  level travel, screenshots, resource resizes, and shutdown. Calling it per frame
  serializes the game and render halves.
- `FRenderCommandFence` is the finer-grained version: `BeginFence()` captures
  the current queue counter, `Wait()` blocks until the drain reaches it.

Because a waiting external thread can become the drainer (the assist path), a
stranded armed drain job cannot lock out a `Flush`. The scheduler tracks
"armed" and "running" separately for exactly this reason.

## Physics

`FPhysicsThread` is a facade with the same `Enqueue` / `Flush` API it had when it
was a real thread. Each `Enqueue` submits a pool job; `Flush` waits the job
counter, assist-waiting on the calling thread.

The frame contract is unchanged and is enforced by the caller, not by the class:

- `FWorldManager::KickPhysics()` fires at the end of `FrameEnd`.
- `FWorldManager::WaitForPhysics()` joins at the start of the next
  `FrameStart`, immediately followed by `DispatchPhysicsEvents()`.

So physics results are always one frame old from gameplay's point of view, and
no game-thread ECS access overlaps the simulation.

## Audio

`Audio::Update()` runs on the main thread once per frame. The actual mixing
happens on miniaudio's device callback thread, which is owned by the audio
device and is not a Lumina thread. Do not touch engine state from a mixing
callback.

## Logging

`Logging::Init` starts a single backend thread. Log calls push into a lock-free
ring; the backend thread batches and dispatches to sinks. This keeps formatting
and I/O off the calling thread. See [Diagnostics](/internals/diagnostics/).

## Hang watchdog

A dedicated thread started before anything else in `LuminaMain`. The main thread
calls `HangWatchdog::Heartbeat()` at the top of every `FEngine::Update`. If the
heartbeat stops advancing, the watchdog dumps every thread's callstack.

Because the render drain has no dedicated thread, a stall dump cannot show it.
`FRenderThread` registers a reporter that logs the drain's flags, counters, and
the debug name of the in-flight command, so a hung render command is still
identifiable.

## Ownership rules

| State | May be touched from |
| --- | --- |
| GLFW window, `RHI::CreateSurface` | Main thread only |
| ECS registry (`CWorld` entity access) | Main thread during update stages; parallel jobs only through the system's declared access set |
| ImGui context | Main thread between `FrameStart` and `FrameEnd` |
| RHI command recording and submission | Render drain only |
| RHI resource creation | Any thread; shared creation paths are internally locked |
| `CObject` creation and destruction | Main thread |
| Asset registry reads | Any thread; writes are locked |

Entity systems declare which components they read and write, and the scheduler
validates that declaration at runtime in development builds. See
[ECS Internals](/internals/ecs-internals/).

## Frame arenas

`ResetThreadFrameAllocators()` runs at the top of `FEngine::Update`, before any
system gathers into a frame arena. It is safe there precisely because the frame
boundary is quiescent: a single game thread, and the previous frame's parallel
gathers have already joined and been consumed. Anything holding a frame-arena
pointer across a frame boundary is a use-after-free. See
[Memory](/internals/memory/).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Crash or corruption right after a `WaitForCounter` | A cached worker index, or `thread_local` state assumed to survive the wait. |
| "No-park guard" error in the log | A render command waited on a counter. Restructure so the wait happens on the game thread before enqueuing. |
| Deadlock during a large scene load | A wait loop with no assist. External-thread waits must go through `WaitForCounter` or `AssistOneJob`, never a bare spin. |
| Random crash creating a window or surface from a job | GLFW calls are main-thread only. |
| Physics reads look one frame stale | They are. That is the design; use the dispatched physics events for edge-triggered reactions. |
