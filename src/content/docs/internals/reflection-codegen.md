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
  runs the Reflector     -> Intermediates/Reflection/<Module>/*.generated.{h,cpp}
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
`Core/Reflection/ReflectionMacros.h` expand:

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

`ReflectionMacros.h` is a **leaf header on purpose**. `ObjectMacros.h` includes it
and adds the object-system macros on top, so a low-level header like
`Core/Math/VectorTypes.h` can be reflected without reaching up into
`Core/Object` and forming a cycle.

The markers collapse to nothing for the parser, and the specifier text is
recovered from the **macro records** in the translation unit rather than from
attributes. That is why a macro is matched to a declaration **by source line**:
the closest record on the same line before the cursor, else the line directly
above. `ModuleAPI.h` likewise blanks the export macros, because the libclang
frontend does not model `__declspec`.

Visitors under `Clang/Visitors` handle the shapes:

| Visitor | Handles |
| --- | --- |
| `ClangVisitor_Struct.cpp` | Classes, structs, type aliases, class templates, and `SCRIPT_EXPORT` free functions. |
| `ClangVisitor_Enum.cpp` | Enums, including the underlying integer width and signedness. |
| `ClangVisitor_Macro.cpp` | Recovers the specifier strings from macro records. |

The parse is **amalgamated**: the tool writes a single `ReflectHeaders.gen.h` that
`#include`s every reflected header, and parses that as one translation unit. This
is the single largest win in reflection build time, and it has two consequences
worth knowing.

- A header is effectively parsed standalone, so it must be self-sufficient. Some
  includes that look redundant for a normal compile are load-bearing here.
- The amalgamation is deleted right after parsing, and libclang's own diagnostics
  are only surfaced for errors. A parse that half-fails can produce locally wrong
  reflection with no message.

## Reflecting aliases and templates

Beyond ordinary declarations, `VisitTypeAlias` and `VisitClassTemplate` cover the
cases where the type the user names is not the type clang declares.

**Aliases.** `REFLECT()` on `using FVector3 = TVec<float, 3>;` reflects the
aliased record under the alias's name. The reflected type is registered with
`bIsAlias`, which suppresses the forward declaration, the `GENERATED_BODY` macro,
and the `StaticStruct()` definition, since none of those have anywhere to live.
A header whose reflected types are all aliases is also exempt from the
"must include its `*.generated.h`" rule.

**Templates.** `REFLECT()` on a class template records it in
`FClangParserContext::ReflectedTemplates`. When a `PROPERTY` names an
instantiation of a recorded template, `TryResolveTemplateInstantiation` registers
that instantiation on the spot, under a mangled name (`TRange<float>` becomes
`TRange_float`). The instantiation is added to the database **before** its fields
are walked, so a type that reaches itself terminates.

Four details make this work, and each is easy to get wrong:

- **libclang exposes no children for an implicitly instantiated specialization.**
  `clang_visitChildren` on the cursor returns nothing even though the type is
  complete. Members must be reached with `clang_Type_visitFields` on the
  `CXType`, which also recurses into anonymous unions.
- **An alias never requires its target to be complete.** A template used nowhere
  else is never instantiated, so its members are invisible. That is detected with
  `clang_Type_getSizeOf` returning `CXTypeLayoutError_Incomplete` and reported as
  `LRT2006` rather than silently reflecting an empty type.
- **A substituted parameter carries no alias sugar.** Inside `TRange<FVector3>`,
  the member type arrives as the canonical `TVec<float, 3>`.
  `FClangParserContext::AliasedInstantiations` maps a canonical spelling back to
  the name a `REFLECT`'d alias gave it, which both fixes the property type and
  keeps the mangled name stable however the author spelled the argument.
- **Macro lookup for an alias target is non-consuming.** Seven aliases share
  `TVec<T, N>`'s `PROPERTY` records, so consuming them would starve all but the
  first.

### Reflected name versus C++ name

Once a type can register under a name that is not its C++ identifier, the two
have to be tracked separately. `FReflectedType` carries both:

| Field | Used for |
| --- | --- |
| `QualifiedName` | The reflected name. The database key, and the source of every generated symbol (`Construct_CStruct_Lumina_FTransform`, metadata array names). |
| `CppName` / `CppQualifiedName`, via `EmittedCppName()` / `EmittedCppQualifiedName()` | The real C++ spelling. Required for every **type expression**: `sizeof`, `alignof`, `MakeStructOps<T>`, `offsetof`, the `StaticStruct()` definition, and the forward declaration. |

Getting that split wrong is the failure mode to watch for. Emitting the reflected
name where a type expression belongs produces "is not a member of Lumina" on a
name that only exists in the reflection database.

Two more codegen consequences of template instantiations:

- `offsetof` is a **preprocessor macro**, so a comma inside a template argument
  list reads as an extra argument. Codegen emits
  `using LRT_Owner_<Friendly> = Lumina::TRange<...>;` and takes the offset against
  that alias.
- Accessor wrappers for containers and `Getter`/`Setter` are normally static
  members declared by `GENERATED_BODY`, which a bodyless type does not have. For
  those types they are emitted as **free functions inside the owner's namespace**,
  so unqualified member type names still resolve. Hence a property carries both
  `AccessorScope` (how the params table refers to it) and
  `AccessorDefinitionScope` (how the definition spells it).

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

`SCRIPT_EXPORT` is fully wired but has no call site in the engine today. The
hand-written `LUMINA_DOTNET_EXPORT` functions in `DotNetGameplay.cpp` are the
conversion target it was built for.

### GC transitions

`SuppressGCTransition` on a `FUNCTION` or `SCRIPT_EXPORT` emits the C# call
without the runtime's managed to native transition, which is a real win on a
short leaf call and unsound on anything that blocks, allocates managed memory,
or reenters the runtime. `REFLECT(ScriptFastCalls)` turns it on for every
binding on a type, and `FUNCTION(NoSuppressGCTransition)` opts one back out.
The emitter resolves this as `(bStructFastCalls || SuppressGCTransition) &&
!NoSuppressGCTransition`, so the per-function opt-out always wins.

See [Scripting Host](/internals/scripting-host/) for the runtime half.

## Markers and specifiers

| Marker | Applies to |
| --- | --- |
| `REFLECT(...)` | A class, struct, enum, class template, or namespace-scope type alias. |
| `GENERATED_BODY()` | Inside a reflected class or struct body. Alias- and template-reflected types have none. |
| `PROPERTY(...)` | A member variable, including one inside a class template or an anonymous union. |
| `FUNCTION(...)` | A member function. Not walked on templates. |
| `SCRIPT_EXPORT(...)` | A namespace-scope free function, for C# export. |

### The specifier registry

`Reflector/ReflectionSpecifiers.h` is the single source of truth for the specifier
vocabulary. Before it existed the accepted set was spread across
`ReflectedProperty.cpp`, `PropertyFlags.h`, `ReflectedStruct.cpp`,
`CSharpBindingEmitter.cpp`, and a few dozen `HasMeta("...")` string literals in
runtime and editor code, so nothing listed what was legal and a typo did nothing
at all.

The file holds one X-macro table per target: `LUMINA_REFLECT_SPECIFIERS`,
`LUMINA_PROPERTY_SPECIFIERS`, `LUMINA_FUNCTION_SPECIFIERS`, and
`LUMINA_SCRIPT_EXPORT_SPECIFIERS`. Each row is `Name, Form, Consumer, Doc`.

- **Form** is `Flag` (a bare keyword), `Value` (`Key = "Value"`), or `Either`.
- **Consumer** is `Reflector` (changes the generated C++), `Runtime` (read through
  `CStruct`/`FProperty` metadata), `Editor` (a property grid hint), or `Script`
  (shapes the C# binding).

One row generates both the table and its own documentation, so the two cannot
drift apart. A fifth table, `LUMINA_RUNTIME_INJECTED_METADATA`, documents the keys
the scripting host writes at runtime (`Aliases`, `ScriptTypeName`,
`ScriptInstanceBase`). Those are excluded from validation because no macro
authors them.

`ValidateSpecifiers()` runs at every macro call site in the clang visitors and
reports `LRT1009` for a key absent from its target's table, with a Levenshtein
suggestion:

```
FontManager.h(30,27): warning LRT1009: PROPERTY specifier 'NotSerialized' is not
recognized and will be ignored. Did you mean 'NoSerialize'?
```

**Adding a specifier means adding its row.** Parsing a key somewhere without
listing it here makes every call site that uses it warn.

`FReflectedProperty::FindConflictingSpecifiers` runs alongside and rejects pairs
that contradict each other (`Editable` with `ReadOnly`, `ScriptReadOnly` with
`ScriptWritable`, `ScriptHidden` with either script access specifier), naming the
one to delete as `LRT1008`.

Specifiers that map onto `EPropertyFlags` bits are parsed in
`FReflectedProperty::GenerateMetadata`. The rest stay as free-form metadata and
reach the editor through the property's metadata table. A `/** ... */` comment
above a declaration is captured through `clang_Cursor_getBriefCommentText` and
stored as `ToolTip`.

`CSharpValueMirror` means LuminaSharp hand-writes a blittable value mirror of the
type, so properties of it bind by value instead of through a generated wrapper. It
replaced the old `ManualStub` specifier, which was deleted along with the
hand-written parser-only shim structs for the math types.

### Everything is scriptable by default

There is no per-member opt-in to C#. A reflected function is bound whenever
`ClassifyFunction` can marshal its signature, and a reflected property is bound
unless it is `ScriptHidden`. The old `FUNCTION(Script)` and `PROPERTY(Script)`
markers had no consumer at all, so they were deleted along with the
`EPropertyFlags::Script` bit and `FProperty::IsScript()`.

`FUNCTION(ScriptEvent)` is gone for the same reason. Overridability is decided by
`IsScriptEvent()`, which is `bIsVirtual && Type.HasMetadata("Scriptable")`: on a
`REFLECT(Scriptable)` class every reflected virtual is overridable from C#, so the
author marks the class and does not have to predict which methods someone will
want to override.

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
6. **Declare a new specifier in `ReflectionSpecifiers.h`.** It is validated
   against, not merely documented by, so an unlisted specifier warns `LRT1009` at
   every call site that uses it.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| `..._GENERATED_BODY` undeclared | The `GENERATED_BODY()` line moved, or the header is new and generation has not run. |
| "Already included, missing `#pragma once`" | Two generated headers pulled into one translation unit, or a missing `#pragma once`. |
| Linker error on `Construct_CClass_...` | The header is not under a reflected module's directory, or that module sets `bEnableReflection = false`. |
| A new type is invisible to the editor | Missing `REFLECT()`, or the module sets `bEnableReflection = false`. |
| A C# binding does not appear | The property is `ScriptHidden`, the function's signature did not classify (see `LRT1005`), or `LuminaSharp` compiled before the bindings were emitted. Check the project dependency order. |
| Stale generated file referencing a deleted type | The expected-output sweep should remove it; if the build was interrupted, delete `Intermediates/Reflection` and rebuild. |
| `LRT2007`, an alias reflected no members | The aliased type's fields have no `PROPERTY()` markers, or they sit in an anonymous union the walk did not enter. |
| `LRT2006`, an alias names an uninstantiated template | Nothing in the amalgamation requires the type to be complete. Add a `static_assert(sizeof(...) > 0)`. |
| "`X` is not a member of `Lumina`" on a generated name | A codegen site emitted `QualifiedName` where a C++ type expression belongs. Use `EmittedCppQualifiedName()`. |
| "too many arguments for function-like macro `offsetof`" | An `offsetof` was emitted against a template instantiation directly instead of through its `LRT_Owner_` alias. |
| A phantom property appears on a type with the same name as one of its member types | The amalgamation lost a declaration and clang error-recovered into an implicit `int`. An include was removed from a widely reached header. |
