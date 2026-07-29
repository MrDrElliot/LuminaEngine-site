---
title: Application Lifecycle
description: From WinMain to the first frame, and back out through shutdown.
---

Lumina has no `main()` you write. The executable
(`Engine/Applications/Lumina`) owns the entry point, constructs a fixed set of
globals in a fixed order, and hands control to `FApplication::Run`. The editor
and the packaged game share this path; the differences are compile-time
(`WITH_EDITOR`) and command-line driven.

## Entry point

`Engine/Applications/Lumina/Source/Platform/LaunchWindows.cpp` provides
`WinMain`, which forwards `__argc` / `__argv` to `LuminaMain` in `Launch.cpp`.
Windows is the only implemented platform target today.

`LuminaMain` does, in order:

1. `CrashHandler::Install()`, a structured-exception handler that writes a
   minidump plus a symbolized callstack. See [Diagnostics](/internals/diagnostics/).
2. `HangWatchdog::Start()`, a background thread that dumps every thread's
   callstack if the main thread stops issuing heartbeats.
3. `FApplicationGlobalState`, a scoped object whose constructor calls
   `Threading::Initialize` (names the main thread, sets up thread-local state)
   and `Logging::Init`. Its destructor tears both down. Nothing that logs may run
   outside its lifetime.
4. `FCommandLine` (published as `GCommandLine`).
5. `FApplication` (published as `GApp`).
6. `FConfig` (published as `GConfig`).
7. The engine object. In an editor build this is `FEditorEngine`, published both
   as `GEditorEngine` and `GEngine`. In a game build it is a plain `FEngine`,
   and `GIsHeadless` is set from the `-server` switch.
8. `Application.Run(ArgC, ArgV)`.

In a game build, `LuminaMain` also subscribes to two core delegates so the
cooked runtime mounts itself at the right moments:

- `FCoreDelegates::OnPreEngineInit` calls `FEngine::MountCookedRuntime`, which
  mounts the `.pak` next to the executable plus a loose-file overlay, so virtual
  file system reads work for the rest of engine init.
- `FCoreDelegates::OnPostEngineInit` calls `FEngine::StartCookedGame`, which
  runs asset discovery, loads the project DLL, creates the game instance, and
  opens the startup map.

`DECLARE_MODULE_ALLOCATOR_OVERRIDES()` at file scope routes the executable's
`new` / `delete` through the engine allocator. Every module that allocates needs
this; see [Memory](/internals/memory/).

## FApplication::Run

`FApplication` (`Core/Application/Application.h`) owns the OS window and the
event pump. It is deliberately thin.

```cpp
int32 FApplication::Run(int argc, char** argv)
{
    PreInitStartup();                  // InitializeCObjectSystem + Paths::InitializePaths
    if (!GIsHeadless) CreateApplicationWindow();

    EventProcessor.RegisterEventHandler(&FInputViewportRegistry::Get(), EInputLayer::Viewport);
    // game builds also create the primary FInputViewport here

    GEngine->Init();

    bool bEngineWantsExit = false;
    while (!bEngineWantsExit)
    {
        if (!GIsHeadless) MainWindow->ProcessMessages();
        bEngineWantsExit = !GEngine->Update(ShouldExit());
        if (!GIsHeadless) FInputViewportRegistry::Get().EndFrame(GEngine->GetDeltaTime());
    }

    GEngine->Shutdown();
    Shutdown();
    return 0;
}
```

Points worth knowing:

- `PreInitStartup` calls `InitializeCObjectSystem()` before anything else. The
  object system must exist before any reflected static registers itself.
- Exit is cooperative. `ShouldExit()` returns true when the window was closed or
  `FApplication::RequestExit()` was called, but the engine can veto by returning
  `bEngineReadyToClose == false` from `Update`, which is how the editor blocks
  shutdown on an unsaved-changes prompt. `FApplication::CancelExit()` clears both
  the request flag and the window's close flag.
- In editor builds there is no primary `FInputViewport`. Each editor tool owns
  its own viewport and registers it with `FInputViewportRegistry`.
- A headless dedicated server (`-server`) creates no window, no RHI, no audio,
  and no UI. `GIsHeadless` is always false in `WITH_EDITOR` builds; the in-editor
  dedicated server is chosen per world by net mode instead.

## FEngine::Init

`FEngine::Init` (`Core/Engine/Engine.cpp`) is the ordering document for the
whole engine. Abridged, with the reason each step sits where it does:

| Step | Why here |
| --- | --- |
| `Platform::EnableHighResolutionTiming` | The frame limiter needs a 1 ms timer resolution. |
| `FPluginManager::DiscoverEnginePlugins` | Must precede everything so `Earliest`-phase plugins can wedge in first. |
| Preload project plugin overrides | Reads the `.lproj` named by `--Project` (or the stashed `CEditorSettings::StartupProject`) so enable/disable decisions apply before any module loads. |
| `LoadModulesForPhase(Earliest)` | Third-party wrappers the engine itself depends on. |
| Mount `/Engine` and `/Intermediates` | Virtual file system roots, needed by every later step that reads a file. |
| `FCoreDelegates::OnPreEngineInit` | In a packaged game this is where the `.pak` is mounted. |
| `FConsoleRegistry::LoadFromConfig` | Console variable values from config, before subsystems read them. |
| `Audio::Initialize`, `Network::Initialize`, `Task::Initialize`, `Physics::Initialize` | Core services. Audio is skipped when headless. |
| `LoadModulesForPhase(Core)` | Plugins that extend those services. |
| `FPhysicsThread` start | Physics runs on its own thread from here on. |
| `FRenderManager::Initialize` | Creates the RHI device, swapchain, shader library, material manager. Skipped when headless. |
| `DotNet::Initialize` | Boots CoreCLR. Non-fatal if the runtime is absent. |
| `ProcessNewlyLoadedCObjects` | Registers reflected types that came in with the modules loaded so far. |
| `LoadModulesForPhase(PreEngineInit)` | Most gameplay extensions. Followed by another `ProcessNewlyLoadedCObjects`. |
| `CPrimitiveManager::Get()` | Built-in meshes must exist before any world deserializes. |
| `CFontManager::Get()` | Skipped when headless. |
| `FWorldManager` construction | Worlds can exist from here on. |
| `LoadModulesForPhase(EngineInit)` | Plugins that need the world manager. |
| `LoadProject(--Project)` | Loads the project's DLL and content roots. |
| Editor only: `GConfig->DiscoverAndLoadSettings`, `CreateDevelopmentTools`, `LoadModulesForPhase(EditorInit)` | The editor UI comes up last so it can enumerate everything registered before it. |
| `RmlUi::Initialize` | Skipped when headless. |
| `LoadModulesForPhase(PostEngineInit)` | Final plugin phase. |
| `FCoreDelegates::OnPostEngineInit` | In a packaged game this starts the cooked game. |

`ProcessNewlyLoadedCObjects()` runs after each module-loading phase. Reflected
types register themselves into a deferred queue at static-initialization time;
this call drains that queue and builds the `CClass` objects. Calling it too late
means a module's static initializers see a null class pointer.

`FCoreDelegates::OnPreEngineInit` and `OnPostEngineInit` are
`BroadcastAndClear`, so a late subscriber never fires. Subscribe from a module
constructor or `StartupModule`, not from a lazily created singleton.

## The frame

`FEngine::Update` runs one frame and returns false when the engine is ready to
close. The shape is:

```
MarkFrameStart                       delta time is computed here
HangWatchdog::Heartbeat              proves the main thread is alive
ResetThreadFrameAllocators           reclaim every thread's frame arena
profilers BeginFrame
Audio::Update, Network::Update
  (skipped entirely while the window is minimized)
  stage FrameStart
    WaitForPhysics + DispatchPhysicsEvents
    MainThread::ProcessQueue
    ProcessPendingOpenLevel, ProcessPendingTravel
    FRenderManager::FrameStart          ImGui::NewFrame
    editor: DeveloperToolUI StartFrame + Update
    ReclaimIdleRenderers
    FWorldManager::UpdateWorlds
  stage Paused
  stage PrePhysics
  stage DuringPhysics
  stage PostPhysics
  stage FrameEnd
    FWorldManager::UpdateWorlds
    editor: DeveloperToolUI EndFrame
    RmlUi::TickEditorContexts
    FWorldManager::ExtractWorlds        game -> render snapshot
    FRenderManager::FrameEnd            enqueue render-thread work
    DotNet::Tick
    FWorldManager::KickPhysics          physics for next frame starts now
profilers EndFrame
MarkFrameEnd
frame rate limiter
```

### Update stages

`EUpdateStage` (`Core/UpdateStage.h`) is the frame's spine. Every world system
declares which stages it runs in and at what priority:

| Stage | Intended use |
| --- | --- |
| `FrameStart` | Input, travel, per-frame setup. Physics results from last frame are already joined. |
| `Paused` | Runs only while the world is paused. Editor tooling uses it to keep ticking. |
| `PrePhysics` | Gameplay that wants to write transforms before the physics kick. |
| `DuringPhysics` | Work that can overlap the physics job. |
| `PostPhysics` | Reactions to physics output. |
| `FrameEnd` | Extraction, rendering hand-off, anything that must be last. |

Priorities are `EUpdatePriority` values (`Highest` = 0 through `Low` = 192, and
`Disabled` = 255). Systems sort ascending, so lower numbers tick first. A system
declares its participation with an `FUpdatePriorityList`, built from
`RequiresUpdate(Stage)` or `RequiresUpdate(Stage, Priority)` entries.

Physics is deliberately one frame behind: `KickPhysics` fires at the end of
`FrameEnd`, and the results are joined at the start of the next frame's
`FrameStart`. That is why gameplay reads physics state from the previous
simulation step.

### Frame rate limiting

`Core.MaxFPS` (default 165) caps the frame rate. The limiter sleeps for the bulk
of the remaining time, leaving a 1 ms margin for scheduler overshoot, then spins
with `std::this_thread::yield()` until the target time. Set the console variable
to 0 to disable it. This is separate from vsync, which is an RHI present-mode
setting.

### Time

`FUpdateContext` carries the frame clock. `DeltaTime` is the wall time between
consecutive `MarkFrameStart` calls, seeded to 1/60 for the first frame. `Frame`
is a monotonic counter used for frame-in-flight slot selection and for
deferred-free bookkeeping.

## Level travel and net URLs

`FEngine` owns level transitions. Requests are queued and drained at
`FrameStart`, never applied mid-tick.

| Call | Effect |
| --- | --- |
| `Travel(WorldPath)` | Queue a world swap. Prefers the PIE game world; the editor proxy world is preserved on PIE exit. |
| `OpenLevel(FURL)` | The general entry point: host a level, open standalone, or connect to `URL.Host`. |
| `HostLevel(Map, Port)` | Listen server. |
| `HostDedicatedLevel(Map, Port)` | Dedicated (clientless, non-rendered) server. |
| `ConnectToServer(Host, Port)` | Client. The server's Welcome message decides which level loads. |
| `RequestExitGame()` | Ends the PIE session in the editor, exits the process in a packaged game. Safe to call inside a world tick. |

A Welcome-driven client travel carries the live `INetworkTransport` across the
world swap rather than disconnecting and reconnecting. `TakeCarriedConnection`
moves it into the new world's net system.

## Shutdown

`FEngine::Shutdown` unwinds in a specific order. The dependencies are real;
reordering these tends to produce use-after-free at exit.

1. `FCoreDelegates::OnPreEngineShutdown`.
2. `FlushRenderingCommands()` then `RHI::WaitDeviceIdle()`, then `RmlUi::Shutdown()`.
   Nothing may destroy a GPU resource before the device is idle.
3. Editor: deinitialize and delete the development tool UI.
4. `DestroyGameInstance()`.
5. Delete `GWorldManager`. Worlds must die before the object system.
6. `ShutdownCObjectSystem()`.
7. `DotNet::Shutdown()`.
8. Delete `GRenderManager`, then stop and delete `GPhysicsThread`.
9. `Physics::Shutdown`, `Audio::Shutdown`, `Network::Shutdown`, `Task::Shutdown`.
   The task system goes last because earlier shutdowns may still schedule work.
10. `FPluginManager::ShutdownAllPlugins`, `FModuleManager::UnloadAllModules`.
11. `Platform::DisableHighResolutionTiming`.

Back in `LuminaMain`, the globals are nulled, the hang watchdog and crash handler
stop, and `FApplicationGlobalState`'s destructor shuts down logging and
threading.

## Common failure modes

| Symptom | Usual cause |
| --- | --- |
| Null `CClass*` in a module's static initializer | `ProcessNewlyLoadedCObjects` has not run for that module's phase yet. Move the work into `StartupModule` or a later phase. |
| A core delegate callback never fires | `OnPreEngineInit` / `OnPostEngineInit` are broadcast-and-clear. The subscription was made after the broadcast. |
| Hang at exit with the render drain named in the watchdog dump | A render command is waiting on something the game thread will never signal. See [Frame Pipeline](/internals/frame-pipeline/). |
| Editor will not close | Something left `bEngineReadyToClose` false. `FEngine::Update` sets it true at the top of every frame, so the culprit cleared it during this frame's stages. |
| Crash destroying a GPU resource at shutdown | Destruction ran before `WaitDeviceIdle`, or after the RHI device was freed. |
