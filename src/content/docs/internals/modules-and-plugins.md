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

Modules are declared in Premake with `LuminaModule` (`BuildScripts/Module.lua`):

```lua
LuminaModule({
    Name = "Runtime",
    Kind = "SharedLib",
    PCH = { Header = "pch.h", Source = "pch.cpp" },
    Reflection = true,
    PublicIncludeDirs = { "." },
    PrivateDefines = { "LUMINA_RENDERER_VULKAN", "VK_NO_PROTOTYPES" },
    Dependencies = LuminaThirdParty.RuntimePublicDeps,
})
```

`LuminaModule` handles the parts that are easy to get wrong:

- Defines `<NAME>_EXPORTS` for the module itself, so its API macro resolves to
  `__declspec(dllexport)` when compiling it and `dllimport` everywhere else.
- Propagates public include directories and public defines transitively through
  `ModuleDependencies`, including the include directories of third-party
  dependencies.
- Registers the module in the global `LuminaModules` table so dependents can
  resolve it.
- Wires the reflection step when `Reflection = true`.

See [Build System](/internals/build-system/) for the full option set.

## API macros

`Engine/Source/Runtime/ModuleAPI.h` is force-included in every translation unit
and resolves the per-module export macros from the `*_EXPORTS` define. Adding a
module means adding a block here:

```cpp
#ifndef RUNTIME_API
    #ifdef RUNTIME_EXPORTS
        #define RUNTIME_API DLL_EXPORT
    #else
        #define RUNTIME_API DLL_IMPORT
    #endif
#endif
```

Two exceptions are worth remembering:

- In a monolithic build (`LUMINA_MONOLITHIC`) the macros are defined empty
  before the per-module blocks run, so everything links statically.
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
- `<Name>.lua`, the Premake declaration for its modules.
- `Source/`, and optionally `Content/` and `Binaries/`.

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

`LuminaDiscoverEnginePlugins()` in the root `premake5.lua` turns every
`Engine/Plugins/<Name>/<Name>.lua` into a project automatically, so adding a
plugin needs no edit to the root script.

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
