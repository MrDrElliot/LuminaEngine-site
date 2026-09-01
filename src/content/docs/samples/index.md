---
title: Sample Applications
description: Three finished games built on Lumina as a library, with no editor, no world, and no scene renderer.
---

The [manual](/manual/overview/) describes Lumina the way most people will use it:
open the editor, build a scene from entities and components, write gameplay in C#,
press play. That is the supported path and it is the fastest one.

It is not the only one.

Lumina ships as a runtime library with a public C++ surface. Underneath the editor
sit a Vulkan RHI, a fiber job system, a sparse-set ECS, an allocator, a container
library, an audio device layer, and a Slang shader compiler. Every one of those is
usable on its own. Nothing forces you to create a `CWorld`, instantiate
`FApplication`, or go through the scene renderer.

These three applications take that route. Each is a complete, playable program with
its own render pipeline, written against the RHI directly. They exist to prove the
engine's parts hold up when you use them the way an engine programmer wants to, and
to give you a reference for doing the same.

## What they have in common

Each one is a console application that links the `Runtime` module and nothing else.

```cs
BinaryType = ModuleBinaryType.ConsoleApplication;
bEnableReflection = false;

PrivateDependencyModuleNames.AddRange(new[]
{
    "Runtime",
    "RPMalloc",
});
```

`main` brings up the pieces it wants and skips the rest:

```cpp
Memory::Initialize();
FApplicationGlobalState GlobalState("Umbral Main");
Task::Initialize();

FWindow Window(FWindowSpecs{ .Title = "Umbral", .Extent = { 1600, 900 } });

RHI::CreateDevice(RHI::FDeviceDesc{ .bValidation = true });
RHI::Core::Initialize();

FSpirVShaderCompiler ShaderCompiler;
GShaderCompiler = &ShaderCompiler;
```

There is no `FEngine`, no `CWorld`, no `FDefaultSceneRenderer`, and no asset
pipeline. Input arrives through the window's own delegates, so no application
object is needed to route it:

```cpp
Window.OnKey.AddLambda([&Game](FWindow*, const FKeyInput& Input)
{
    Game.OnKey(Input.Key, Input.bPressed);
});
```

Shaders are embedded in the binary as Slang source and compiled at startup through
`GShaderCompiler->CompilerShaderRaw`. None of them live in the engine's shader tree,
so a normal editor boot never compiles a single line of them.

## The three

| Sample | What it is | What it leans on |
| --- | --- | --- |
| **[Breakout](/samples/breakout/)** | A brick breaker with heavy effects work. | The ECS as a plain gameplay database, procedural audio, an embedded post chain. |
| **[Umbral](/samples/umbral/)** | A horde survival game at six figures of enemies. | The job system, structure-of-arrays data layout, bindless instancing. |
| **[Grain](/samples/grain/)** | A micro-voxel world, raymarched, simulated, destructible. | Buffer device address, compute, and a hand-written denoiser. |

## Building them

None of them build by default. Ask for one by name:

```bash
LuminaBuild.bat Build Umbral -TargetType=Editor -Configuration=Development
```

The result lands in `Binaries/Windows64/`, for example
`Umbral-Editor-Development.exe`. They are `bMonolithic = false`, so they draw
through the same `Runtime` DLL the editor loads rather than a separately linked
copy of it. Building one after touching engine code rebuilds only what changed.

## When this is the right approach

Reach for the editor path when you are building a game with content: levels,
prefabs, materials, animation, a team of people making assets. That is what it is
for, and reimplementing any of it by hand is a bad trade.

Reach for the library path when the thing you are making *is* the technology. A
voxel renderer, a simulation, a tool, a benchmark, a rendering experiment. When your
frame does not look like "draw a scene graph", the scene renderer is a constraint
rather than a service, and going straight to the RHI is both simpler and faster.

The two are not exclusive. `Engine/Applications/MinimalHost/` is the smallest
possible version of this, a reference host that brings up memory, tasks, a window,
the RHI, a swapchain and audio in about 200 lines. If you are adding a library entry
point, that is the target that proves it still works.
