---
title: Scripting Host
description: Embedding CoreCLR, the native to managed boundary, and hot reload.
---

Gameplay scripting is C#. The runtime embeds **CoreCLR** through `hostfxr`,
loads the `LuminaSharp` managed assembly, and compiles the project's `.cs` files
in process with Roslyn.

For the scripting API itself see the manual's [Scripting](/manual/scripting/)
section. This page is the host and interop layer.

## Boot

`DotNet::Initialize()` runs from `FEngine::Init`, after the renderer and before
`ProcessNewlyLoadedCObjects`. It is **non-fatal**: if the bundled runtime is
missing, scripting is disabled with a log message and the engine continues.

The sequence:

1. Locate `host/fxr/<version>/hostfxr.<ext>` under the bundled runtime root
   (`External/DotNet`). Not finding it disables scripting.
2. Resolve `hostfxr_initialize_for_runtime_config`,
   `hostfxr_get_runtime_delegate`, and `hostfxr_close`.
3. Initialize a runtime context from the config, then get the
   `load_assembly_and_get_function_pointer` delegate.
4. Load the `LuminaSharp` bootstrap assembly and resolve two
   `UnmanagedCallersOnly` entry points: `Bootstrap` and `ResolveManagedExport`.
5. Run the managed handshake, which checks the ABI version.

`DotNet::Tick()` runs once per frame at `FrameEnd`. `DotNet::Shutdown()` runs
during engine shutdown, before the render manager is destroyed.

## ABI versioning

The native to managed boundary carries an explicit version, bumped whenever the
boundary changes. Its history is a useful record of what the boundary carries:

- v4, `LoadScripts` takes per-unit assembly buckets.
- v5, native to managed exports resolved **by name** through
  `ResolveManagedExport` rather than through a mirrored struct and hash.
- v6, the managed system descriptor sink carries declared read and write
  component tokens, enabling parallel C# systems.
- v7, delegate properties replace hardcoded collision and perception dispatch,
  adding `OnNativeDelegateDestroyed`.
- v8, a managed render scene bridge, so a C# type can be installed through
  `RenderSceneFactory`.
- v9, the Scriptable sink carries each class's update phase, so `[UpdatePhase]`
  reaches the native tick.
- v10, a script struct's schema carries its managed size, which the minted layout
  is checked against, and a minted enum property takes its underlying type's width
  rather than always 8 bytes.

A mismatch is reported at the handshake rather than crashing later.

## Native to managed

`ResolveManagedExport(Name)` returns a raw function pointer for a managed export,
or null.

The lifetime rule matters: **engine exports are stable for the process, but
script and plugin exports are not.** A `[ManagedExport]` in a plugin's scripts
belongs to a script generation, and its pointer dangles once that generation
unloads. Any caller holding one must re-resolve when `GetScriptGeneration()`
changes. Game thread only.

## Managed to native

Two mechanisms, both resolved by name at runtime:

**Hand-written exports** use `LUMINA_DOTNET_EXPORT`
(`Scripting/DotNet/DotNetExport.h`):

```cpp
LUMINA_DOTNET_EXPORT(FVector3, Physics_GetLinearVelocity)(uint64 World, uint32 Entity)
{
    // ...
}
```

expands to `extern "C" LUMINA_SCRIPT_API FVector3
LuminaSharp_Physics_GetLinearVelocity(...)`. The C# side binds it with
`[NativeCall(Module = "Runtime", EntryPoint = "LuminaSharp_Physics_GetLinearVelocity")]`.

Conventions in that surface:

- `World` is an opaque `CWorld*` passed as `uint64`.
- `Entity` is a packed entity handle passed as `uint32`.
- **Game thread only.**
- MSVC warning C4190 ("UDT returned with C linkage") is expected and harmless:
  every export returning `FVector3`, `FQuat`, or a wire struct does so
  deliberately, mirroring a blittable C# struct byte for byte.

**Generated exports** come from the [Reflector](/internals/reflection-codegen/):
`SCRIPT_EXPORT(Class = "Namespace.Class")` on a namespace-scope free function
emits both the native thunk and the C# binding.

`LUMINA_SCRIPT_API` is always `dllexport`, in every build configuration, because
C# resolves these by name through `NativeLibrary.TryGetExport` rather than
linking them. In monolithic Shipping they land in the executable's export table;
in modular builds they land in their module's DLL.

The interop implementation is split by area:
`DotNetGameplay.cpp`, `DotNetAnimation.cpp`, `DotNetAudio.cpp`,
`DotNetPerception.cpp`, `DotNetProperty.cpp`, `DotNetRHI.cpp`,
`DotNetTask.cpp`, `DotNetTimer.cpp`, `DotNetView.cpp`,
`DotNetDynamicMesh.cpp`.

## Blittable layout checks

`CSharpLayoutChecks.cpp` and `LayoutRegistry.cpp` verify that every struct
mirrored across the boundary has matching size and field offsets on both sides.
A mismatch is caught at startup with a named error instead of producing silently
corrupted data.

Whenever you add or change a struct that crosses the boundary, add it to the
layout registry. This is the single highest-value guard in the interop layer.

## Compilation and hot reload

In the editor, scripts are compiled **in process** with Roslyn. CoreCLR keeps
`LuminaSharp.dll` and the Roslyn assemblies the compiler pulls in loaded for the
life of the process; only the script assemblies are collectible.

Each script unit compiles into its own **collectible `AssemblyLoadContext`**,
emitted to `<root>/Binaries/DotNet/<Name>.dll`. `FSourceAssembly` buckets group
source files per unit, and each unit declares the sibling units it references,
which drives managed load order.

`DotNet::ReloadScripts()` unloads the current generation and loads a new one.
The ordering is delicate:

- Managed render scenes are torn down **first**, so nothing dispatches into a
  dead load context.
- Script systems are removed from every world's system set before the unload, so
  stale GC handle slots are never ticked.
- **Every static holder of a user type or a GC handle must be cleared during
  unload.** A single surviving reference pins the load context and the unload
  silently fails, which shows up later as two generations of a type coexisting.

`GetScriptGeneration()` returns the current generation number. Anything caching
managed pointers keys off it.

### Rebuilding a class whose properties changed

A C# script's `[Property]` members are appended to its minted `CClass` as real
`FProperty`s, in a trailing block past the C++ shim. The class is reused by name
across reloads and keeps its identity, but `StaticAllocateObject` bakes
`Class->GetSize()` into every object when it is created, so a changed property
set cannot be patched in place.

`Scripting::MigrateMintedClassLayout` rebuilds the block: retire the layout
record, discard the CDO, `CStruct::Unlink`, restore the shim's size, re-append,
create a fresh CDO. It **refuses while live instances exist**, because they are
laid out at the old size.

So `FScriptableRegistry::RefreshMintedClasses` runs a round trip.

1. Compare each type's new schema against the block it was built from,
   `ScriptClassLayoutMatches`. A reload that changed no layout does nothing here,
   which is the common case.
2. `EntityScripts::Evacuate` serializes every affected entity's
   `SEntityScriptComponent` and drops its scripts.
3. Rebuild the layouts.
4. Apply the C# declared defaults to the new CDOs.
5. `EntityScripts::Restore`, **after** the defaults, so a property added by this
   reload comes back carrying its initializer rather than zero.

The carrier is `SEntityScriptComponent::Serialize`, unchanged and already used
for scene saving: class name plus tagged properties per script. Being name-keyed
is what makes the round trip a migration rather than a copy.

Old layout records are retired to a graveyard rather than freed, and the old
`FProperty`s are not freed either. They point into that record's element
descriptions, so retiring the pair together means a stale cached pointer is
merely stale, never dangling.

### Renames

Property renames ride the tagged serializer's `Aliases` metadata, which the C#
`[Alias]` list is folded into.

Class renames go through a redirect registry on `FScriptableRegistry`:
`RegisterClassRedirect`, `ResolveClass`, `GatherRenamedClasses`. It maps name to
name rather than name to `CClass*`, because a redirect is registered before its
target has necessarily been minted. `ResolveClass` consults redirects **before**
the name itself: during the reload that renames a type both classes briefly
exist, and preferring the live old class would strand instances on it.

`SEntityScriptComponent`'s load path resolves through the registry, so a scene
saved before a rename loads too.

The pairs come from C# through `EnumerateScriptableAliases`, a separate managed
export from `EnumerateScriptables` because that sink's arity is part of the ABI.

## Cooked games

A packaged game does not run Roslyn.

- `GatherScriptUnitsForPackaging` recompiles scripts so every unit's DLL is
  freshly emitted, and returns the unit graph (`FPackagedScriptUnit`: name, DLL
  path, dependencies) for the packager.
- The packager stages those DLLs under `<exeDir>/DotNet/Scripts/` with a
  `scripts.manifest.json`.
- `DotNet::LoadCookedScripts()` loads the prebuilt assemblies from that manifest.
  It is a safe no-op when no manifest exists.

`GenerateScriptProjects()` writes the `.csproj` files used for IDE editing; it is
not part of the runtime path.

## Script structs and scriptable objects

- `CScriptStruct` (`Scripting/ScriptStruct.cpp`) represents a C#-defined struct
  as a reflected type, so it can appear in the editor property grid and be
  serialized. **Its `StructOps` is null**; always null-check `GetStructOps()`
  before using it, unlike a natively compiled `CStruct`.
- `CScriptableObject` lets a C# type derive from a `CObject`, giving scripts
  access to assets and settings objects.
- `ScriptValueBridge` and `ScriptValueStore` marshal reflected property values
  across the boundary.

## Diagnostics

`FScriptDiagnostics` surfaces the managed runtime's state to the editor:

| Field | Source |
| --- | --- |
| `ManagedHeapBytes` | `GC.GetTotalMemory(false)` |
| `HeapSizeBytes`, `FragmentedBytes`, `CommittedBytes` | `GCMemoryInfo` |
| `TotalAllocatedBytes` | `GC.GetTotalAllocatedBytes()`, lifetime; drives the churn rate |
| `WorkingSetBytes` | `Environment.WorkingSet`, whole process |
| `PauseTimePercentage`, `LastPauseMs` | `GCMemoryInfo` |
| `PinnedObjects` | `GCMemoryInfo.PinnedObjectsCount` |
| `Generation` | Current script generation |

Allocation churn is the number to watch. Per-frame allocation in a script drives
GC pause percentage up, and the pause lands on the game thread.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| "C# scripting disabled" at startup | `hostfxr` not found under the bundled runtime, or missing expected exports. |
| ABI handshake failure | Native and managed built from different revisions. Rebuild both. |
| Crash after a script reload | A cached managed export pointer used across a generation change, or a static holder that pinned the old load context. |
| Reload appears to work but old code still runs | The load context did not actually unload. Something still references a user type. |
| Corrupt values across the boundary | A blittable struct changed on one side only. Add it to the layout registry. |
| `[NativeCall]` throws at runtime | The export is not in the export table. Check that it uses `LUMINA_SCRIPT_API`, not a module API macro. |
| Frame hitches attributed to scripting | GC pauses from per-frame allocation. Check `TotalAllocatedBytes` churn. |
