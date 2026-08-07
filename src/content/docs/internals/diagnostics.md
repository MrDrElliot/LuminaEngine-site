---
title: Diagnostics
description: Logging, console variables, profilers, and GPU debugging.
---

## Logging

`Runtime/Log`. The logger is in house (there is no spdlog dependency) and is
built around an asynchronous ring buffer with batched sink dispatch.

`Logging::Init()` runs from `FApplicationGlobalState`'s constructor and starts a
single backend thread. Log calls push into a lock-free ring; the backend thread
formats and dispatches to sinks. Formatting and I/O stay off the calling thread.

### Macros

| Macro | Level | Availability |
| --- | --- | --- |
| `LOG_CRITICAL` | Critical | Always |
| `LOG_ERROR` | Error | Always |
| `LOG_WARN` | Warn | Always |
| `LOG_DISPLAY` | Info | Always |
| `LOG_INFO` | Info | Non-Shipping |
| `LOG_DEBUG` | Debug | Non-Shipping |
| `LOG_TRACE` | Trace | Non-Shipping |

`LOG_DISPLAY` is the one to reach for when a message must survive into a Shipping
build; `LOG_INFO` compiles away. The formatting syntax is `std::format`:

```cpp
LOG_DISPLAY("Mesh/task shaders: {}", bSupported ? "supported" : "unavailable");
```

`Logging::GLevelThreshold` is an atomic checked before any formatting work, so a
filtered-out call costs one relaxed load. `Logging::SetLevel` changes it at
runtime.

### Sinks

`Log/Sinks` holds `StdoutSink`, `FileSink`, and `MemorySink`. The memory sink
backs the editor's Console panel, exposed as
`Logging::GetConsoleLogQueue()`.

`Logging::Flush()` drains the ring synchronously. Call it before a deliberate
abort, or the last messages are lost.

:::caution
Log macros inside a header parsed by the Reflector need care. The reflection
parser defines `REFLECTION_PARSER` and stubs out several macros; a header that
logs from an inline function pulls the full logging surface into the parse.
:::

## Console variables

`Core/Console/ConsoleVariable.h`.

```cpp
static TConsoleVar CVarMaxFrameRate("Core.MaxFPS", 165, "Changes the maximum frame-rate of your engine");
```

`TConsoleVar<T>` registers itself into `FConsoleRegistry` at construction, with a
name, a default, a hint string, and an optional change callback. `GetValue()`
reads the current value.

`FConsoleCommand` and `FAutoConsoleCommand` register callable commands the same
way.

`FConsoleRegistry::LoadFromConfig()` runs early in `FEngine::Init`, before
subsystems read their variables, so config-set values are visible from first use.
The editor's console panel enumerates the registry for autocomplete.

Variables used throughout the engine include the frame rate cap, the idle
renderer reclaim grace period, and the parallel world render toggle. Grep for
`TConsoleVar` to enumerate what a subsystem exposes.

## Configuration

`Runtime/Config` holds `FConfig` (`GConfig`) plus reflected settings classes such
as `CEngineSettings`, `CEditorSettings`, `CInputSettings`, and `CAudioSettings`.

Settings classes are `CObject`s, so they get the property grid for free and are
read through `GetDefault<T>()`, which returns the class default object. Saving one
broadcasts `FCoreDelegates::OnSettingsSaved(CClass*)`; subsystems subscribe and
react. The input action map and the audio settings are both rebuilt this way.

`GConfig->DiscoverAndLoadSettings()` runs during editor init and finds every
reflected settings class.

## Tracy

`Core/Profiler/Profile.h` wraps Tracy:

| Macro | Emits |
| --- | --- |
| `LUMINA_PROFILE_SCOPE()` | A zone named after the function. |
| `LUMINA_PROFILE_SECTION(Name)` | A named zone. |
| `LUMINA_PROFILE_SECTION_COLORED(Name, Color)` | A named, colored zone. |
| `LUMINA_PROFILE_FRAME()` | A frame mark. |
| `LUMINA_PROFILE_TAG(Text)` | Text attached to the current zone. |
| `LUMINA_PROFILE_VALUE(Name, Value)` | A plot sample. |
| `LUMINA_PROFILE_LOG(Text, Size)` | A message. |

Tracy is a build option; when it is off these compile away. Enable it through the
build option (see [Build System](/internals/build-system/)), which also adds the
Tracy third-party project.

Thread naming feeds Tracy's timeline grouping through
`Threading::SetThreadName(Name, GroupHint)` and the `EThreadGroup` values, so the
main thread pins to the top and workers group together.

**GPU zones** come from `SCENE_GPU_SCOPE(CL, "Name")` in the render scene, which
emits both a Tracy GPU zone and an RHI debug marker. Tracy Vulkan contexts are
created per queue.

Allocation tracing is wired through `LUMINA_PROFILE_ALLOC` /
`LUMINA_PROFILE_FREE` with a 12-frame callstack.

## The CPU profiler

`FCPUProfiler` (`Core/Profiler/CPUProfiler.h`) is the engine's own hierarchical
frame profiler, driving the editor's profiler panel. It brackets each frame from
`FEngine::Update` (`BeginFrame` / `EndFrame`).

Scopes are `FCPUProfileScope` records aggregated into an `FCPUProfileFrame`.
Profile targets (`FCPUProfileTarget`, `ECPUTargetKind`) let the editor separate
work by world, and cache world metadata (type, net mode) so the UI can badge a
frame's role and PIE state **without dereferencing a possibly-dead `CWorld*`**.

`FCPUProfileScopeRAII` is the scope guard.

## The gameplay profiler

`FGameplayProfiler` is a lighter, name-aggregated profiler aimed at gameplay
work: C# scripts, entity systems, and user `Profiler.Sample` scopes from C#.

Per frame it records, per name: call count, inclusive milliseconds (including
children), and exclusive milliseconds (self time). It keeps rolling history for
sparklines. Cost when disabled is a single atomic check.

`BeginScope` / `EndScope` are **concurrency safe**, because parallel C# entity
systems tick across job workers. The open-scope stack is thread local (each scope
opens and closes on the same thread or fiber) and the shared per-frame
aggregation is mutex guarded. `BeginFrame` / `EndFrame` stay on the game thread,
called at the frame boundary when no worker scope is open.

## The job profiler

`FJobProfiler` (editor builds only) records per-frame job timelines from the
scheduler and backs the editor's Task System panel. Job labels come from
`FJobDecl::Name` or the `Name` argument to `RunJob`.

`Jobs::FJobLiveStats` is a separate, always-compiled, on-demand snapshot of pool
occupancy with no standing cost.

## Memory tools

`Memory::Tracking` supports category scopes (`LUMINA_MEMORY_SCOPE("Name")`),
per-category live bytes, and optional callstack capture with symbol resolution.
The editor surfaces rpmalloc totals, the per-category breakdown, and the top call
sites in one Memory tool. See [Memory](/internals/memory/).

`FScriptDiagnostics` covers the managed heap separately; see
[Scripting Host](/internals/scripting-host/).

## GPU debugging

| Tool | How it is wired |
| --- | --- |
| **Validation layers** | Compiled in through `LUMINA_WITH_VALIDATION` and passed as `FDeviceDesc::bValidation`. `VK_EXT_debug_utils` is enabled in every non-Shipping build. |
| **Debug markers** | `RHI::CmdBeginMarker` / `CmdEndMarker`, used by `SCENE_GPU_SCOPE`. Every pass is named in captures and crash dumps. |
| **RenderDoc** | `Renderer/RenderDocImpl.cpp` integrates the in-application API for programmatic captures. |
| **Nsight Aftermath** | Enabled through `VK_NV_device_diagnostics_config` on NVIDIA. The Aftermath DLL is copied next to the executable by the Runtime module. |
| **Device fault** | `VK_EXT_device_fault` gives vendor-agnostic fault data on `VK_ERROR_DEVICE_LOST`. |
| **Nsight Perf** | An engine plugin (`Engine/Plugins/NsightPerf`) that requests its own device extensions through the native-access hook. |
| **Shader debug info** | Raised to `STANDARD` on non-AMD, non-Shipping builds for source-level debugging. |

An **unbalanced debug marker** corrupts the label stack for the rest of the
frame, so every `Begin` needs its `End` on every path including early returns.

## Crash and hang

- `CrashHandler::Install()` is the first call in `LuminaMain`; it writes a
  minidump plus a symbolized callstack to `CrashDumps/`.
- `HangWatchdog` dumps every thread's callstack when the main thread's heartbeat
  stops. Work that rides a pool worker rather than a thread of its own can
  register a reporter so it still appears.

Both are covered in [Platform Layer](/internals/platform/).

## Assertions

`Core/Assertions` provides `ASSERT`, `UNREACHABLE`, and friends. Assertions are
active in Debug and Development and compiled out in Shipping, so an assertion is
not a substitute for a runtime check on data that can legitimately be wrong at
runtime (asset contents, network input, user configuration).

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Last log lines missing after a crash | The ring was not flushed. Call `Logging::Flush()` before a deliberate abort. |
| A console variable does not take effect at startup | It was read before `FConsoleRegistry::LoadFromConfig()`. |
| A settings change does nothing | The subsystem is not subscribed to `OnSettingsSaved` for that class. |
| Tracy shows no GPU zones | Tracy Vulkan contexts are per queue; the work was submitted on a queue without one. |
| Profiler shows a dead world's name | Expected: metadata is cached deliberately so the UI never dereferences a dead `CWorld*`. |
| Garbled pass names in a capture | An unbalanced `SCENE_GPU_SCOPE`. |
| An assertion never fires in a shipped build | Assertions are compiled out in Shipping. Use a real check. |
