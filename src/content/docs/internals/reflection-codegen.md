---
title: Reflection and Code Generation
description: The Clang-based Reflector, generated headers, and C# binding emission.
---

Lumina's reflection data is generated at build time by a standalone tool
(`Engine/Applications/Reflector`) that parses engine headers with **libclang**
and writes C++ registration code plus C# interop bindings. Nothing is reflected
by macro trickery alone: the macros are markers the parser looks for.

This page is the toolchain view. For the authoring view (what specifiers exist,
how properties show up in the editor) see the manual's
[Reflection](/manual/reflection/) page.

## What runs when

```
Reflector (a prebuild target, built first)
  |
LuminaBuildTool's reflection step
  writes <Intermediate>/Reflection_Files.json (per-module header lists + include dirs)
  runs Reflector.exe     -> Intermediates/Reflection/<Module>/*.generated.{h,cpp}
                            Intermediates/Reflection/<Module>/ReflectionUnity_N.gen.cpp
                            Intermediates/CSharpBindings/**/*.generated.cs
  |
Runtime / Editor / plugin modules compile, including the generated headers
  |
LuminaSharp compiles, globbing the emitted .generated.cs files
```

LuminaBuildTool plans one reflection action per target, covering every module with
`bEnableReflection`. Like any other action it declares its inputs (the reflected
headers) and its outputs (the generated unity shards), so it reruns when a
reflected header changes and is skipped when none did.

The action never runs in parallel with itself: the generator holds every header in
memory at once and is already internally parallel, so a second instance would only
fight it for cores.

`Reflector` is a prebuild target of anything that reflects, otherwise a clean build
would race reflection against the tool's own compilation.

## Discovering what to parse

The build tool writes `Reflection_Files.json` into the target's intermediate
directory. For every module with `bEnableReflection` it records:

- the module base directory,
- every header file,
- the module's resolved include directories,
- the C# bindings output directory,
- the generated code directory and the module's precompiled header.

The Reflector reads that file. Its contents come from the same source scan the
compile itself uses, so a new header is picked up on the next build with nothing to
regenerate first. The file is written per target, because an Editor and a Game
build reflect different module sets and a shared file would make each look like a
changed input to the other.

## Parsing

`Reflector/Clang` drives libclang. The important detail is that the tool defines
`REFLECTION_PARSER` while parsing, which changes how the macros in
`ObjectMacros.h` expand:

```cpp
#if defined(REFLECTION_PARSER)
    #define GENERATED_BODY(...)
    #define REFLECT(...)
    #define PROPERTY(...)
    #define FUNCTION(...)
    #define SCRIPT_EXPORT(...)
#else
    #define GENERATED_BODY(...) CONCAT4(CURRENT_FILE_ID, _, __LINE__, _GENERATED_BODY)
    ...
#endif
```

The markers collapse to nothing for the parser, and the specifier text is
recovered from the **macro records** in the translation unit rather than from
attributes. `ModuleAPI.h` likewise blanks the export macros, because the libclang
frontend does not model `__declspec`.

Visitors under `Clang/Visitors` handle the three shapes:
`ClangVisitor_Struct.cpp` (classes and structs), `ClangVisitor_Enum.cpp`, and
`ClangVisitor_Macro.cpp` (recovering the specifier strings).

The parse is amalgamated: headers are batched into translation units rather than
parsed one at a time, which is the single largest win in reflection build time.

## Generated output

For a reflected header `Foo.h` in project `Runtime`, the Reflector writes:

| File | Contents |
| --- | --- |
| `Intermediates/Reflection/Runtime/Foo.generated.h` | Include guard, forward declarations, `Construct_C*` prototypes, and the `GENERATED_BODY` expansion for each type. |
| `Intermediates/Reflection/Runtime/Foo.generated.cpp` | The registration code: property tables, function thunks, `CClass` / `CStruct` / `CEnum` construction. |

A generated header looks like this:

```cpp
#pragma once
#include "Core/Reflection/ReflectedTypeAccessors.h"

#ifdef LuminaEngine_Engine_Source_Runtime_Core_Math_AABB_h_generated_h
#error Already included, missing #pragma once
#endif
#define LuminaEngine_Engine_Source_Runtime_Core_Math_AABB_h_generated_h

namespace Lumina { struct FAABB; }
RUNTIME_API Lumina::CStruct* Construct_CStruct_Lumina_FAABB();

#define LuminaEngine_Engine_Source_Runtime_Core_Math_AABB_h_17_GENERATED_BODY \
static class Lumina::CStruct* StaticStruct();

#undef CURRENT_FILE_ID
    #define CURRENT_FILE_ID LuminaEngine_Engine_Source_Runtime_Core_Math_AABB_h
```

Two mechanics fall out of that:

- **`CURRENT_FILE_ID` plus `__LINE__`** is how `GENERATED_BODY()` resolves to the
  right macro. The line number of the `GENERATED_BODY()` call is baked into the
  macro name (`..._h_17_GENERATED_BODY`). Move the macro to a different line
  without rerunning the Reflector and you get an "undeclared identifier" error.
- **The generated include must be last** in your header's include list, because
  it redefines `CURRENT_FILE_ID`. Including two generated headers from one file
  without the intervening `#pragma once` triggers the explicit
  "Already included" error.

### Unity shards

Compiling thousands of tiny `.generated.cpp` files is slow, so the Reflector also
emits `ReflectionUnity_0.gen.cpp` through `ReflectionUnity_7.gen.cpp` per
module, each `#include`-ing a share of the generated sources. The shard **count is
fixed** and mirrored in the build tool as `ReflectionStep.UnityShardCount`, because
the tool has to name those files as build outputs before they exist. It must match
`kUnityShardCount` in `CodeGenerator.cpp`, so changing the count means editing both
sides.

### C# bindings

`CSharpBindingEmitter` writes `.generated.cs` files into
`Intermediates/CSharpBindings/`. `LuminaSharp.csproj` globs them with an MSBuild
`<Compile Include=...>` pattern, expanded at build time since the files do not
exist until the Reflector has run.

`SCRIPT_EXPORT(Class = "Namespace.Class")` on a namespace-scope free function
makes the Reflector emit a native `extern "C"` thunk plus a C# `[NativeCall]`
binding on the named class. The macro generates nothing at the call site; it is
purely a marker the parser detects through the macro record. The thunks are
declared `LUMINA_SCRIPT_API`, which is always `dllexport`, because they are
resolved by name at runtime rather than linked.

See [Scripting Host](/internals/scripting-host/) for the runtime half.

## Markers and specifiers

| Marker | Applies to |
| --- | --- |
| `REFLECT(...)` | A class, struct, or enum. |
| `GENERATED_BODY()` | Inside a reflected class or struct body. |
| `PROPERTY(...)` | A member variable. |
| `FUNCTION(...)` | A member function. |
| `SCRIPT_EXPORT(...)` | A namespace-scope free function, for C# export. |

Property specifiers recognized by `FReflectedProperty::GenerateMetadata`:

| Specifier | Effect |
| --- | --- |
| `Editable` | Appears in the editor property grid. |
| `ReadOnly` | Shown but not editable. |
| `NoSerialize` | Excluded from serialization. |
| `EditorOnly` | Editor builds only. |
| `Replicated` | Participates in network replication. |
| `Script` | Exposed to C#. |
| `ScriptReadOnly` / `ScriptWritable` | Narrows script access. |
| `ScriptHidden` (alias `NotScriptable`) | Hidden from C#. |
| `Getter` / `Setter` | Route access through accessor functions. Bare `Getter` means `Get<Name>`, bare `Setter` means `Set<Name>`. |

Any other `Key = Value` pair is kept as free-form metadata (`Category`,
`ClampMin`, tooltips, and so on) and reaches the editor through the property's
metadata table.

## Diagnostics

`Reflector/Diagnostics` contains two useful tools:

- `LRTDiagnostics`, the tool's own error and warning reporting, including
  detection of stale generated files (an expected-output set is compared against
  what is on disk, so renamed or deleted headers do not leave orphans behind).
- `HeaderIncludeGraph`, which reports include fan-in. This is what identifies
  which headers are worth putting in the precompiled header: only headers above
  roughly 85% fan-in belong in `pch.h`.

## Practical rules

1. **Add a header and build.** The Reflector's file list is rebuilt from the
   module's own sources every build, so there is nothing to regenerate first.
2. **`#include "Foo.generated.h"` last.**
3. **One `GENERATED_BODY()` per reflected type**, and rerun generation after
   moving it.
4. **Do not edit anything under `Intermediates/Reflection`.** It is regenerated
   on every build.
5. **Variadic macro expansion is unreliable under libclang**, which is why the
   markers are stubbed out during parsing and specifiers are recovered from macro
   records. If you add a new marker macro, add it to the `REFLECTION_PARSER`
   branch too, or the parser will choke on it.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| `..._GENERATED_BODY` undeclared | The `GENERATED_BODY()` line moved, or the header is new and generation has not run. |
| "Already included, missing `#pragma once`" | Two generated headers pulled into one translation unit, or a missing `#pragma once`. |
| Linker error on `Construct_CClass_...` | The header is not under a reflected module's directory, or that module sets `bEnableReflection = false`. |
| A new type is invisible to the editor | Missing `REFLECT()`, or the module sets `bEnableReflection = false`. |
| A C# binding does not appear | The property lacks `Script` (or is `ScriptHidden`), or `LuminaSharp` compiled before the bindings were emitted. Check the project dependency order. |
| Stale generated file referencing a deleted type | The expected-output sweep should remove it; if the build was interrupted, delete `Intermediates/Reflection` and rebuild. |
