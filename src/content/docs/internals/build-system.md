---
title: Build System
description: Premake modules, feature options, the reflection step, and environment variables.
---

Lumina builds with **Premake 5** into a Visual Studio solution. There is no
CMake, and no in-house build tool beyond the Premake modules under
`BuildScripts`.

For first-time setup instructions see
[Installation](/getting-started/installation/). This page covers how the build is
put together.

## Layout

| File | Role |
| --- | --- |
| `premake5.lua` (root) | The workspace: groups, project includes, third-party list, plugin discovery. |
| `BuildScripts/Dependencies.lua` | `LuminaConfig`: paths, output directories, `LUMINA_DIR` resolution. |
| `BuildScripts/Workspace.lua` | `LuminaWorkspaceSettings`: configurations, per-config defines and flags. |
| `BuildScripts/Module.lua` | `LuminaModule`: the module declaration helper. |
| `BuildScripts/ThirdParty.lua` | Third-party library definitions and include resolution. |
| `BuildScripts/Options.lua` | Feature toggles (Tracy, validation, Aftermath, verbose logging). |
| `BuildScripts/BuildConfig.lua` | User-editable defaults for those toggles. |
| `BuildScripts/Plugin.lua`, `PluginDiscovery.lua` | Plugin projects and automatic discovery. |
| `BuildScripts/CSharpProject.lua` | C# project support (`dotnetrawprops`, `dotnetrawitems`). |
| `BuildScripts/GameProject.lua` | Standalone game project generation. |
| `BuildScripts/Actions/*.lua` | Custom Premake actions: `setup`, `Reflection`, `Clean`. |
| `BuildScripts/ReflectionGen.lua` | The `ReflectionGen` utility project. |
| `Setup.bat`, `GenerateProjectFiles.bat` | Entry points. |

## Setup

`Setup.bat`:

1. Sets `LUMINA_DIR` to the repository root and warns if a **different** value
   was previously persisted, because a stale value produces "wrong engine
   linked" errors. Tooling started before the change (Visual Studio, Rider, the
   taskbar) keeps the old value until restarted.
2. Runs `BuildScripts/CheckPrerequisites.ps1` unless `SKIP_PREREQ_CHECKS=1`.
3. Bootstraps `Tools/premake5.exe` (5.0.0-beta2) by downloading it if missing,
   using `curl.exe` and `tar.exe`, both present on Windows 10 1803 and later. No
   Python is required.
4. Runs `premake5 setup`, which fetches and verifies `External.zip`, configures
   git hooks, and persists `LUMINA_DIR` with `setx`.
5. Generates the solution.

`premake5 setup` is loaded before the workspace is evaluated and returns early,
so it works on a fresh clone where the engine tree does not exist yet:

```lua
include "BuildScripts/Actions/Setup"
if _ACTION == "setup" then return end
```

`LUMINA_SETUP_YES` (or `--yes`) skips the interactive confirmation, which is what
CI uses.

### Prerequisites

`CheckPrerequisites.ps1` distinguishes hard failures (blocking) from soft
warnings:

- Windows tooling (`curl.exe`, `tar.exe`, PowerShell).
- The required **.NET SDK** major version, for the C# projects.
- A **Visual Studio** version new enough to target `net10.0`.
- The **Vulkan SDK**, located through its environment variable.

### Regenerating

`GenerateProjectFiles.bat` runs `premake5 vs2026` and produces `Lumina.slnx`.
Extra arguments pass straight through to Premake:

```bash
GenerateProjectFiles.bat --tracy=off
```

**Regenerate after adding or removing any source file.** The reflection step's
input list comes from Premake, not from a directory scan, so a new header is
invisible to the Reflector until the solution is regenerated.

## Configurations

Three configurations, all 64-bit Windows:

| Configuration | Characteristics |
| --- | --- |
| `Debug` | Unoptimized. Defines `LE_DEBUG`, `LUMINA_DEBUG`, `_DEBUG`, `DEBUG`. Validation and Tracy on by default. |
| `Development` | Optimized with symbols. Target suffix `-Development`. The normal working configuration. |
| `Shipping` | Fully optimized. Defines `NDEBUG`, `LE_SHIPPING`, `LUMINA_SHIPPING`, and **`LUMINA_MONOLITHIC`**. |

`LUMINA_CONFIGURATION_NAME` is defined as the configuration string and is part of
the [module ABI signature](/internals/modules-and-plugins/), which is why mixing
configurations across module boundaries is refused rather than silently
corrupting the heap.

Shipping is **monolithic**: every module links statically into the executable.
`IMPLEMENT_MODULE` switches to intrusive static registration, the API macros
become empty, and interop thunks land in the executable's export table (which is
why `LUMINA_SCRIPT_API` is always `dllexport`).

## Feature options

`BuildScripts/Options.lua` resolves four toggles from three sources, in
increasing priority: the auto policy, `BuildConfig.lua`, then command-line flags.

| Option | Flag | Auto policy |
| --- | --- | --- |
| Tracy profiler | `--tracy=auto\|on\|off` | On in Debug and Development. |
| Vulkan validation and sync layers | `--validation=auto\|on\|off` | On in Debug only. |
| NVIDIA Aftermath crash dumps | `--aftermath=auto\|on\|off` | On in Debug and Development, **and only when an NVIDIA GPU is detected**. |
| Verbose logging (`LOG_TRACE` / `DEBUG` / `INFO`) | `--verbose-logging=auto\|on\|off` | Kept in Debug and Development, stripped in Shipping. Warn, error, and critical are always kept. |

The NVIDIA probe shells out to `Get-CimInstance Win32_VideoController`, falling
back to `wmic`, and the result is cached on `LuminaConfig` so it runs once per
generation.

`BuildConfig.lua` is the place to record a persistent preference:

```lua
return {
    Tracy          = "auto",
    Validation     = "auto",
    Aftermath      = "auto",
    VerboseLogging = "auto",
}
```

Toggles are baked in at generation time, so **regenerate after editing them**.
Turning Tracy on also adds the Tracy third-party project to the workspace.

`--with-tests` adds the Tests project and its GoogleTest dependency. It is off by
default because it costs roughly 22 seconds on a clean build.

## Declaring a module

```lua
LuminaModule({
    Name              = "MyModule",
    Kind              = "SharedLib",
    PCH               = { Header = "pch.h", Source = "pch.cpp" },
    Reflection        = true,
    PublicIncludeDirs = { "." },
    PublicDefines     = { },
    PrivateDefines    = { "SOMETHING" },
    ModuleDependencies = { "Runtime" },
    Dependencies       = { "EnTT", "glfw" },     -- third-party
    ExtraLinks         = { "slang" },
    LibDirs            = { ... },
    FatalWarnings      = { "4456" },
})
```

`LuminaModule` resolves public include directories and public defines
**transitively** through `ModuleDependencies`, including those of third-party
dependencies, so a dependent does not restate them.

Per-file build settings use Premake filters. The Runtime module pins one:

```lua
-- /GT (fiber-safe TLS) required or the scheduler reads stale TLS after fiber migration.
filter { "files:**/JobScheduler.cpp" }
    buildoptions { "/GT" }
filter {}
```

## Precompiled headers

`Engine/Source/Runtime/pch.h` carries the standard library, EASTL, EnTT, and
xxhash. `Engine/Editor/Source/EditorPCH.h` includes the Runtime PCH plus ImGui
and `ImGuiX`.

The selection rule is measured, not guessed: **only headers above roughly 85%
fan-in belong in a PCH**. The Reflector's `HeaderIncludeGraph` diagnostic
reports that fan-in. Editor-specific headers such as `EditorUI.h` and
`EditorTool.h` are deliberately kept out, so editing one does not invalidate the
PCH for every editor translation unit.

`ModuleAPI.h` is force-included **after** the PCH header, so PCH content that
depends on `RUNTIME_API` must include `ModuleAPI.h` explicitly up front, or the
macro is undefined while the PCH is parsed.

## The reflection step

```
Reflector (a normal C++ application project)
  |
ReflectionGen (Utility project, prebuild command)
  premake5 Reflection -> Intermediates/ReflectionData.json
  Reflector.exe       -> Intermediates/Reflection/<Project>/*.generated.{h,cpp}
                         Intermediates/Reflection/<Project>/ReflectionUnity_N.gen.cpp
                         Intermediates/CSharpBindings/**/*.generated.cs
  |
modules with Reflection = true compile
```

`ReflectionGen` declares `fastuptodate "Off"` because reflected headers are not
tracked inputs; the Reflector does its own dirty checking. It also declares
`dependson { "Reflector" }` so a clean build does not race.

The unity shard count is fixed and listed statically in the Premake scripts,
because Premake must name the files before they exist.

See [Reflection and Code Generation](/internals/reflection-codegen/).

## C# projects

`CSharpProject.lua` adds raw-MSBuild escape hatches (`dotnetrawprops`,
`dotnetrawitems`, `dotnetrawtail`) so the managed projects can express things
Premake does not model.

- **`LuminaSharp.Generators`** is a `netstandard2.0` Roslyn source generator
  (the `[NativeCall]` generator), referenced as an analyzer.
- **`LuminaSharp`** targets `net10.0`, depends on `Runtime` (which emits the
  bindings) and on the generator, and globs
  `Intermediates/CSharpBindings/**/*.generated.cs` with an MSBuild `<Compile
  Include>` expanded at build time, since those files do not exist when Premake
  runs.
- A post-build target copies the generator DLL next to `LuminaSharp.dll` so the
  runtime script compiler can load it.

## Third-party libraries

Everything is vendored under `Engine/Source/ThirdParty` and built from source as
part of the workspace: EA (EASTL), EnTT, glfw, imgui, Tracy (optional),
MiniAudio, JoltPhysics, Recast, enet, RPMalloc, XXHash, miniz,
VulkanMemoryAllocator, Volk, tinyobjloader, MeshOptimizer, MikkTSpace, json,
fastgltf, OpenFBX, basis_universal, SLang, FreeType, RmlUi, msdfgen, and
GoogleTest when tests are enabled.

Prebuilt binaries and SDKs live under `External/`, fetched by `premake5 setup`
from `External.zip` with checksum verification. Slang is linked from
`External/SLang/lib`.

Vendored libraries that expose an allocator hook are routed through the
`LmThirdParty*` C-ABI shim so their allocations appear in engine memory
tracking. See [Memory](/internals/memory/).

## Plugins

`LuminaDiscoverEnginePlugins()` turns every `Engine/Plugins/<Name>/<Name>.lua`
into a project automatically. A project's own plugins are discovered the same
way. Adding a plugin therefore requires no edit to the root script.

## Output layout

| Path | Contents |
| --- | --- |
| `Binaries/` | Executables and DLLs, per configuration. |
| `Intermediates/Obj/` | Object files. |
| `Intermediates/Reflection/` | Generated reflection sources. |
| `Intermediates/CSharpBindings/` | Generated C# bindings. |
| `Intermediates/ShaderCache/` | Compiled SPIR-V (`.lsc`). |
| `Intermediates/AssetRegistry.assetdb` | Asset discovery cache. |
| `Intermediates/ThumbnailCache/` | Asset thumbnails. |

`premake5 Clean` removes generated output.

## Game projects

A game project has its own solution and links the **prebuilt** engine rather than
building it. That is why `LUMINA_DIR` must be set: `Dependencies.lua` prefers the
environment variable and only falls back to the workspace location, which is
correct for engine builds and wrong for game projects. If `LUMINA_DIR` is unset
or points somewhere that is not an engine root, generation fails with an
explanatory message rather than a confusing link error.

The Sandbox project is intentionally outside the engine workspace for the same
reason: it is a standalone game project with its own solution.

## Build times

The dominant cost is header parsing, roughly 70% of a clean build. When measuring
a change, measure **CPU seconds** (`CL=-Bt+`), not wall clock: wall clock varies
by up to 40 seconds run to run on the same machine and will mislead you.

Levers that actually move the number: PCH contents (fan-in measured, not guessed),
the reflection unity shard count, and the amalgamated reflection parse.

If the linker reports `LNK1140` (too many sections), the PDB has grown past its
limit. Delete the oversized `.pdb` and relink.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| New file does not compile or reflect | Project files not regenerated. |
| "Wrong engine linked" in a game project | A stale persisted `LUMINA_DIR`. Tools started before the change keep the old value. |
| Feature toggle has no effect | Toggles are baked in at generation time. Regenerate. |
| Module refuses to load at runtime | ABI signature mismatch from mixing configurations or compilers. |
| Reflection output is stale | The prebuild did not run. `ReflectionGen` must stay `fastuptodate "Off"`. |
| `LNK1140` | Oversized PDB. Delete it and relink. |
| Undefined `RUNTIME_API` while compiling the PCH | `ModuleAPI.h` not included up front in the PCH header. |
| Setup fails on a fresh clone | Missing prerequisites, or `External.zip` could not be fetched or verified. |
