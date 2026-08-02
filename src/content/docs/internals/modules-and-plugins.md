---
title: Modules and Plugins
description: DLL boundaries, the module manager, and plugin load phases.
---

Lumina is built from **modules**. A module is one build target (usually a DLL)
with an API macro, a public include surface, and an optional
`IModuleInterface` object that receives startup and shutdown callbacks. A
**plugin** is a versioned folder that owns one or more modules plus a descriptor
telling the engine when to load them.

The engine ships two first-party modules (`Runtime` and `Editor`), a set of
third-party static libraries, two applications (`Lumina` and `Reflector`), and
any number of plugins discovered at startup.

## Declaring a module

A module is a directory containing a `<Name>.Build.cs`, a C# rules file that
LuminaBuildTool compiles and executes:

```csharp
using LuminaBuildTool.Configuration;

public class Runtime : LuminaModuleRules
{
    public Runtime(TargetInfo Target)
        : base(Target)
    {
        BinaryType = ModuleBinaryType.SharedLibrary;

        PrecompiledHeader = new PrecompiledHeaderRules("RuntimePCH.h", "Source/RuntimePCH.cpp");

        PublicIncludePaths.Add("Source");

        PrivateDefinitions.AddRange(new[] { "LUMINA_RENDERER_VULKAN", "VK_NO_PROTOTYPES" });

        PublicDependencyModuleNames.AddRange(new[] { "EA", "Entt", "Vulkan" });
    }
}
```

There is no source list. Every `.cpp` and `.h` under the rules file's directory is
the module's source, discovered at build time. The tool handles the parts that are
easy to get wrong:

- Defines the module's `<NAME>_API` macro, resolving export versus import from the
  dependency graph.
- Propagates public include paths and public definitions transitively through
  `PublicDependencyModuleNames`, while private settings stop at the declaring
  module.
- Wires the reflection step for modules with reflected types.

See [Build System](/internals/build-system/) for the full option set.

## API macros

Mark anything other modules need with your module's API macro:

```cpp
class RUNTIME_API FRenderManager
{
    ...
};
```

LuminaBuildTool defines `<NAME>_API` on the compiler command line, for the module
being compiled and for every shared library in its dependency closure, resolving
`DLL_EXPORT` versus `DLL_IMPORT` from the graph. There is no header to edit and
nothing to register, which is what lets an out-of-tree game or plugin module have
an API macro at all. Third-party modules are skipped, because a vendored library
is entitled to that name for its own purposes.

`Engine/Source/Runtime/Source/ModuleAPI.h` is force-included in every translation
unit and holds only what cannot be derived that way. Two things are worth
remembering:

- In a monolithic build (`LUMINA_MONOLITHIC`) the per-module macros are defined
  empty, so everything links statically.
- `LUMINA_SCRIPT_API` is **always** `DLL_EXPORT`, in every build mode. The C#
  interop thunks are resolved by name at runtime through `GetProcAddress` /
  `NativeLibrary.TryGetExport`, never linked, so they must appear in an export
  table even when the module is compiled into the executable.

While the [Reflector](/internals/reflection-codegen/) parses headers,
`REFLECTION_PARSER` is defined and these macros collapse to nothing, because the
libclang frontend does not model `__declspec`.

## Implementing a module

```cpp
class FMyModule : public IModuleInterface
{
public:
    void StartupModule() override  { /* register types, subscribe delegates */ }
    void ShutdownModule() override { /* unwind in reverse */ }
};

IMPLEMENT_MODULE(FMyModule, MyModule)
```

`IMPLEMENT_MODULE` expands differently depending on the build:

- **Modular** (the default): exports `InitializeModule` and `ShutdownModule` for
  `GetProcAddress`, plus `LuminaModuleABISignature`. It also emits
  `DECLARE_MODULE_ALLOCATOR_OVERRIDES()` and calls
  `Memory::InitializeThreadHeap()` on load, so the DLL gets its own rpmalloc
  thread heap. See [Memory](/internals/memory/).
- **Monolithic**: registers an `FStaticModuleRegistration` into an intrusive
  linked list during static initialization, drained on first lookup. The
  constructor deliberately touches no runtime state, because static
  initialization order across translation units is undefined.

### The ABI guard

Every modular DLL exports `LuminaModuleABISignature()`, returning a compile-time
fingerprint of the form:

```
LMABI/1|Development|Editor|MSC1944
```

That is the ABI version, the build configuration, whether the module was built
for editor or game, and the MSVC compiler version. The module manager compares
it against the engine's own signature before calling anything else in the DLL. A
mismatch is refused with a clear message instead of the usual silent heap
corruption from mixing configurations. Bump `LUMINA_MODULE_ABI_VERSION` when a
change breaks binary compatibility across the module boundary.

## Plugins

A plugin is a folder under `Engine/Plugins/<Name>` (engine plugins) or under a
project's `Plugins` folder, containing:

- `<Name>.lplugin`, a JSON descriptor.
- `Source/<Module>/<Module>.Build.cs` for each module the descriptor lists.
- Optionally `Content/` and `Binaries/`.

A descriptor looks like this:

```json
{
    "FormatVersion": 1,
    "Name": "GameplayExtras",
    "Version": 1,
    "VersionName": "0.1.0",
    "Category": "Gameplay",
    "EnabledByDefault": false,
    "EditorOnly": false,
    "ContainsContent": false,
    "SupportedPlatforms": [],
    "Dependencies": [],
    "Modules": [
        { "Name": "GameplayExtrasRuntime", "Type": "Runtime", "LoadingPhase": "PreEngineInit" }
    ]
}
```

LuminaBuildTool discovers plugins by scanning for `.lplugin` descriptors, so
adding a plugin needs no edit to anything above it. The descriptor is the single
source of truth for the plugin's identity and its module list, and every module it
names needs a matching `.Build.cs` under `Source/`.

At runtime, `FPluginManager::DiscoverEnginePlugins()` runs first in
`FEngine::Init`, before any subsystem. A project's `.lproj` may override the
enabled state of any plugin; those overrides are preloaded before module loading
begins, so a disabled plugin never loads at all.

### Load phases

`FPluginManager::LoadModulesForPhase` is called at fixed points in
`FEngine::Init`. `EPluginLoadingPhase` (`Core/Plugin/PluginLoadingPhase.h`):

| Phase | Runs | Use for |
| --- | --- | --- |
| `Earliest` | Before any engine subsystem | Wrappers for third-party libraries the engine itself depends on. Engine plugins only. |
| `Core` | After memory, log, task, and physics init, before the renderer | Extensions to those core services. |
| `PreEngineInit` | After the renderer, scripting host, and the first `ProcessNewlyLoadedCObjects`, before any world exists | Most gameplay extensions. |
| `EngineInit` | After `FWorldManager` exists, before the project DLL loads | Anything needing the world manager. |
| `PostEngineInit` | After all engine init, before the main loop | Late registration. |
| `PostProjectLoad` | After the project DLL loads | Modules that build on project-defined types. |
| `EditorInit` | After the editor UI is initialized | Editor tooling. Skipped entirely in non-editor builds. |

`ProcessNewlyLoadedCObjects()` runs after each phase, so reflected types
introduced by a plugin are registered before the next phase starts.

## The module manager

`FModuleManager` (`Core/Module/ModuleManager.h`) owns loaded modules as
`FModuleInfo` records: the module name, the `IModuleInterface` instance, and the
raw DLL handle (null in monolithic builds, so `UnloadModule` must guard the
free). `FEngine::Shutdown` calls `UnloadAllModules` after every subsystem is
down.

Ordering rules that matter in practice:

- Do not register reflected types from a module constructor. Do it in
  `StartupModule`, which runs after the DLL is fully loaded.
- Do not assume another plugin's module has loaded unless you declared it in
  `Dependencies` or your phase is strictly later than theirs.
- `ShutdownModule` runs while the engine is already partly torn down. Anything
  that touches the renderer, the world manager, or the object system is already
  gone by then; do that work in a shutdown delegate instead.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Module refuses to load with an ABI message | The DLL was built with a different configuration, editor flag, or compiler version than the engine binary. Rebuild it. |
| `GetProcAddress` for an interop thunk returns null | The symbol was declared with a module API macro instead of `LUMINA_SCRIPT_API`. |
| Crash freeing memory allocated in another module | The module is missing `DECLARE_MODULE_ALLOCATOR_OVERRIDES()`, so it has its own CRT heap. |
| A plugin's types are missing from the editor | Its loading phase is later than the code that enumerates them, or the plugin is disabled by the project's `.lproj`. |
