---
title: Threading Model
description: Which threads exist, what each may touch, and where the hand-offs are.
---

Lumina has far fewer OS threads than its subsystem list suggests. There is no
render thread and no physics thread: rendering and physics both run on the game
thread, and the work inside them fans out to **jobs on the fiber pool**. The
threads that actually exist are:

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

Each worker owns a set of lock-free MPMC queues, one per priority band
(`High` / `Normal` / `Low` / `Background`), drains its own first, and steals from
other workers when they run dry. Each job runs on a pooled user-mode fiber. When
a job waits on a counter it does **not** block its worker: the fiber parks and
the worker picks up other runnable work. The fiber resumes later, possibly on a
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

## Rendering

There is no render thread, and no render command queue. `FRenderManager::FrameEnd`
runs on the game thread and does the whole frame inline: fence the frame slot,
record every world, acquire the swapchain, composite, present.

What is parallel is the **recording**, not the submission point.
`FWorldManager::RenderWorlds` calls `PrepareRender` for every scene serially,
then records each scene's `RenderView` — under `Task::ParallelFor` when more than
one world is live (the editor's multi-view case), serially otherwise. Each scene
owns its own command list, which is what makes that safe.

The naming convention follows the *phase*, not a thread:

| Suffix | Meaning |
| --- | --- |
| `_Extract` | Runs during extract. Reads live ECS, writes the snapshot. |
| `_Render` | Runs during recording. Reads only the snapshot, records commands. |

`CompileDrawCommands_Extract` and `CompileDrawCommands_Render` are the pair to
look at. A `_Render` function that reaches back into the ECS is a bug even though
both now run on the same thread, because recording may be running for several
worlds at once.

## Physics

There is no physics thread and no async physics. `FWorldManager::TickPhysics()`
steps every live world and dispatches that world's contact events immediately
after, synchronously on the game thread, from a block sitting **between the
DuringPhysics and PostPhysics stages**.

So `PostPhysics` reads the step that just ran, in the same frame, and contact
events land before it.

Jolt still parallelises the step internally: with
`Physics.Jolt.UseEngineJobSystem` (default on) its jobs go to the same worker
pool, so a synchronous call still uses every core. Because those callbacks are
raised from Jolt's own jobs, `FJoltPhysicsScene` still *records* contacts and
sleep/wake transitions into staging buffers and drains them after `Update()`
returns rather than dispatching inline — the queue just no longer outlives the
frame that filled it.

:::note[Removed 2026-08-07]
Physics used to run one frame behind, kicked at the end of `FrameEnd` and joined
at the top of the next `FrameStart`. That bought overlap only with the frame tail
(the `Core.MaxFPS` limiter sleep and the window poll), which is time you only have
when you are *not* CPU-bound, and the join assist-waited anyway. It cost a frame
of latency and a hard "no game-thread ECS access in the kick/join window"
contract, so it was deleted.
:::

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

Because rendering happens inline on the game thread, a stall inside it shows up
directly in the main thread's callstack in the dump.

## Ownership rules

| State | May be touched from |
| --- | --- |
| GLFW window, `RHI::CreateSurface` | Main thread only |
| ECS registry (`CWorld` entity access) | Main thread during update stages; parallel jobs only through the system's declared access set |
| ImGui context | Main thread between `FrameStart` and `FrameEnd` |
| RHI command recording and submission | Game thread inside `FRenderManager::FrameEnd`; per-world recording may run on workers, one command list each |
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
| "No-park guard" error in the log | A fiber parked on a thread that had marked itself a serial pump with `Jobs::SetThreadNoParkGuard`. Restructure so the wait happens outside the guarded region. |
| Deadlock during a large scene load | A wait loop with no assist. External-thread waits must go through `WaitForCounter` or `AssistOneJob`, never a bare spin. |
| Random crash creating a window or surface from a job | GLFW calls are main-thread only. |
| Physics reads look stale in `PrePhysics` or `DuringPhysics` | Those stages run *before* the step. Read results in `PostPhysics` or later. |
