---
title: Engine Internals
description: How Lumina is put together, for people working on the engine itself.
---

The [manual](/manual/overview/) describes the engine from a game developer's seat.
This section describes it from the inside: the C++ subsystems, the threading
model, the render pipeline, and the tooling that generates half of the code you
will read.

It assumes you have written C++ engine code before and are new to this codebase.
It does not re-explain what a command buffer or an ECS is; it explains what
Lumina's version of them does differently and why.

## Reading order

If you are landing in the repository for the first time, read these in order.

1. **[Application Lifecycle](/internals/application-lifecycle/)**, from `WinMain`
   to the first rendered frame, and back out through shutdown.
2. **[Threading Model](/internals/threading-model/)**, which threads exist, what
   each may touch, and where the hand-offs are.
3. **[The Object System](/internals/cobject/)**, `CObject`, classes, packages,
   and object lifetime. Almost every asset and settings type is one.
4. **[Reflection and Code Generation](/internals/reflection-codegen/)**, the
   Clang-based Reflector that produces `.generated.h` files and C# bindings.
5. **[RHI](/internals/rhi/)** and **[Frame Pipeline](/internals/frame-pipeline/)**,
   the rendering half.

## Subsystem map

```
LuminaMain (Launch.cpp)
  FApplicationGlobalState        threading + logging
  FCommandLine, FConfig
  FEngine / FEditorEngine        the engine singleton (GEngine)
  FApplication::Run              window creation, then the main loop
    FEngine::Init                subsystems come up here
    while (!exit)
      FWindow::ProcessMessages   GLFW event pump
      FEngine::Update            one frame, six update stages
    FEngine::Shutdown
```

`FEngine::Update` drives everything else:

```
FEngine::Update
  FWorldManager::UpdateWorlds          per stage: FrameStart .. FrameEnd
    CWorld::Update                     entity systems, scripts, transforms
  FWorldManager::TickPhysics           step + contact events (between the
                                       DuringPhysics and PostPhysics stages)
  CWorld::Extract                      live state -> render snapshot (FrameEnd)
  FRenderManager::FrameEnd             record and present, inline
```

and the render half, which runs inside that last call on the same thread:

```
FRenderManager::FrameEnd
  RHI::Core::BeginFrame(slot)          wait the frame timeline, recycle lists
  IRenderScene::PrepareRender          serial, device-wide reconciliation
  IRenderScene::RenderView             per scene, records + submits
                                       (parallel across worlds when >1 is live)
  ImGui / RmlUi composite
  RHI::Core::Present                   acquire, blit, present
```

## The pieces, by directory

| Directory | What lives there |
| --- | --- |
| `Engine/Source/Runtime/Core` | Object system, reflection runtime, serialization, delegates, math, threading primitives, console variables, profilers |
| `Engine/Source/Runtime/Containers` | EASTL aliases, `FString`, `FName`, and the engine-specific container types |
| `Engine/Source/Runtime/Memory` | Allocator facade over rpmalloc, frame and linear allocators, memory tracking |
| `Engine/Source/Runtime/TaskSystem` | Fiber job scheduler, `ParallelFor`, task graph, futures, fiber-aware sync |
| `Engine/Source/Runtime/Renderer` | RHI declaration, Vulkan backend, shader compiler and cache, material manager |
| `Engine/Source/Runtime/World` | `CWorld`, the EnTT registry facade, entity systems, and the render scene |
| `Engine/Source/Runtime/Assets` | Asset registry, asset manager, asset types |
| `Engine/Source/Runtime/Scripting` | .NET host, interop surface, script structs |
| `Engine/Source/Runtime/Physics` | Physics facade and the Jolt backend |
| `Engine/Source/Runtime/UI` | RmlUi integration |
| `Engine/Source/Runtime/Tools` | ImGui plumbing, importers, transactions, primitives, fonts |
| `Engine/Editor` | Everything editor-only: tools, panels, property grid, node graphs |
| `Engine/Applications/Lumina` | The executable entry point |
| `Engine/Applications/Reflector` | The code generator |
| `Engine/Source/LuminaSharp` | The managed (C#) engine API |
| `Engine/Tools/LuminaBuildTool` | The build tool: rules compilation, the module graph, the reflection step, project generation |
| `Engine/Build` | Shared build rules (`*.BuildRules.cs`) and `BuildConfiguration.json` |

## What this section covers

| Page | Subject |
| --- | --- |
| [Application Lifecycle](/internals/application-lifecycle/) | Startup, the main loop, update stages, shutdown |
| [Modules and Plugins](/internals/modules-and-plugins/) | Module manager, DLL boundaries, plugin load phases |
| [Threading Model](/internals/threading-model/) | Threads, ownership rules, hand-off points |
| [Task System](/internals/task-system/) | Fiber scheduler, counters, `ParallelFor`, task graph |
| [Memory](/internals/memory/) | Allocators, frame arenas, tracking |
| [Math and Containers](/internals/math-and-containers/) | The in-house math library, SIMD, EASTL aliases, `FName` |
| [Delegates and Events](/internals/delegates-and-events/) | Delegates, reentrancy, core delegates, input events |
| [Configuration and Settings](/internals/config-and-settings/) | `FConfig`, developer settings classes, live refresh |
| [The Object System](/internals/cobject/) | `CObject`, `CClass`, packages, handles, lifetime |
| [Reflection and Code Generation](/internals/reflection-codegen/) | Reflector, generated headers, C# binding emission |
| [Serialization](/internals/serialization/) | Archives, package format, the phased loader |
| [Assets](/internals/assets/) | Registry, manager, VFS, cooking |
| [ECS Internals](/internals/ecs-internals/) | Registry facade, systems, execution and validation |
| [Physics Internals](/internals/physics-internals/) | Jolt facade, bodies, constraints, queries, the job bridge |
| [Animation Internals](/internals/animation-internals/) | Poses, the graph VM, the task system, root motion, notifies |
| [Networking Internals](/internals/networking-internals/) | Transport, net GUIDs, the replication graph, the wire protocol |
| [Audio Internals](/internals/audio-internals/) | The audio context, command queue, voices, buses, spatialization |
| [RHI](/internals/rhi/) | The graphics abstraction |
| [Vulkan Backend](/internals/vulkan-backend/) | Device, queues, memory, descriptors, swapchain |
| [Frame Pipeline](/internals/frame-pipeline/) | Extract, recording, frames in flight |
| [Render Passes](/internals/render-passes/) | The scene renderer, pass by pass |
| [Shaders](/internals/shaders/) | Slang compilation, cache, conventions |
| [Scripting Host](/internals/scripting-host/) | CoreCLR hosting and interop |
| [Editor Architecture](/internals/editor-architecture/) | Editor engine, tools, panels, transactions |
| [Platform Layer](/internals/platform/) | Windowing, input, filesystem, process, crash handling |
| [Diagnostics](/internals/diagnostics/) | Logging, console variables, profilers, GPU debugging |
| [Build System](/internals/build-system/) | LuminaBuildTool, targets, modules, plugins, rules files |

## Conventions used in the code

- `F` prefix for plain structs and classes (`FEngine`, `FRenderManager`).
- `C` prefix for reflected `CObject` classes (`CWorld`, `CTexture`).
- `S` prefix for reflected non-object structs (`SPostProcessSettings`).
- `E` prefix for enums, `I` prefix for interfaces.
- `G` prefix for globals (`GEngine`, `GRenderManager`, `GWorldManager`).
- Allman braces, PascalCase members, no Hungarian notation beyond the prefixes
  above except `b` for booleans.
- `_Extract` / `_Render` suffixes mark which half of the frame a render-side
  function belongs to; `_GameThread` marks a hard game-thread affinity.
