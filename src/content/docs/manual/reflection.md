---
title: Reflection
description: How Lumina knows its own types at runtime, and how to mark up your own.
---

**Reflection** is the system that makes Lumina's C++ types known at runtime. You
annotate a class, struct, enum, property, or function in C++, and a build-time
tool generates the metadata that describes it. That metadata is the foundation
the editor, serialization, networking, and C# scripting are all built on. Write
your type once, and every one of those systems understands it with no extra glue.

## Marking a type

Three macros do the work.

- **`REFLECT(...)`** annotates a class, struct, enum, class template, or type alias.
- **`GENERATED_BODY()`** goes inside the type and is replaced with the generated
  boilerplate (its `StaticClass()`/`StaticStruct()` accessor, constructors, and
  so on).
- The header **includes its own `*.generated.h`** as the **last** include.

A reflected component struct looks like this.

```cpp
#pragma once
#include "Core/Object/ObjectMacros.h"
#include "HealthComponent.generated.h"   // always last

namespace Lumina
{
    REFLECT(Component, Category = "Gameplay")
    struct RUNTIME_API SHealthComponent
    {
        GENERATED_BODY()

        PROPERTY(Editable, Category = "Health", ClampMin = 0)
        float Max = 100.0f;

        PROPERTY(ReadOnly)
        float Current = 100.0f;
    };
}
```

A reflected **class** derives from `CObject` (these are the `C`-prefixed asset and
object types).

```cpp
REFLECT()
class RUNTIME_API CMyAsset : public CObject
{
    GENERATED_BODY()
public:
    PROPERTY(Editable)
    FString DisplayName;
};
```

Enums reflect too, `REFLECT()` for a plain enum, `REFLECT(BitMask)` for a flags
enum so the editor shows checkboxes.

```cpp
REFLECT()
enum class EDoorState : uint8 { Closed, Opening, Open };
```

If you only need the macros and not the whole object system (a low-level math
header, for example), include `Core/Reflection/ReflectionMacros.h` instead of
`ObjectMacros.h`. It is a leaf header with no dependencies, so it can be included
from anywhere without creating a cycle.

## Supported property types

`PROPERTY(...)` accepts the following. Anything else is a build error, not a
silent skip.

### Scalars and text

| Type | Notes |
| --- | --- |
| `bool` | |
| `int8` `int16` `int32` `int64` | |
| `uint8` `uint16` `uint32` `uint64` | |
| `float` `double` | |
| `FString`, `FFixedString` | Both reflect as a string property. |
| `FName` | Interned name, reflects as its own property kind. |
| A reflected `enum class` | Any underlying width is preserved, so a `uint8` enum stays one byte. |
| `ECS::FEntity` | Reflects as a 32-bit integer, surfaces in C# as an `Entity` handle. |

### Structs

Any struct with `REFLECT()` + `GENERATED_BODY()`, including the built-in math
types (`FVector2/3/4`, `FIntVector2/3`, `FUIntVector2/3`, `FQuat`, `FTransform`)
and any instantiation of a reflected class template.

### Object and type references

| Type | Meaning |
| --- | --- |
| `TObjectPtr<T>` | Strong reference to a `CObject`. |
| `TWeakObjectPtr<T>` | Weak reference. |
| `TSubclassOf<T>` | A `CClass` picker constrained to `T` and its subclasses. |
| `TSubStructOf<T>` | A `CStruct` picker constrained to `T`. |
| `TSoftObjectPtr<T>`, `FSoftObjectPath` | Path reference resolved on demand, so the asset is not loaded with the owner. |

A **raw pointer is not reflectable**. Use `TObjectPtr<T>`.

### Value polymorphism

`TInstancedStruct<TBase>` and bare `FInstancedStruct` own a struct instance whose
concrete type is chosen per instance. See [Instanced struct
properties](#instanced-struct-properties).

### Containers

| Type | Editor |
| --- | --- |
| `TVector<T>`, `TFixedVector<T>` | Resizable list with Add and Clear. |
| `THashMap<K, V>` | Key/value map, keys must be unique. |
| `TOptional<T>` | Value that may be unset. |

The element, key, and value types can be anything in this section, so
`TVector<TObjectPtr<CTexture>>` and `THashMap<FName, FVector3>` both work.

### Delegates

`TScriptDelegate<T>` and `FScriptDelegate` reflect so a script or the editor can
bind to them.

## Properties

`PROPERTY(...)` exposes a field. The specifiers control what each system may do
with it.

| Specifier | Effect |
| --- | --- |
| `Editable` | Shown and editable in the Details panel; serialized. |
| `ReadOnly` | Shown in the Details panel but not editable; serialized. |
| `Replicated` | Participates in [network replication](/manual/scripting/networking/). |
| `EditorOnly` | Kept for editor tooling; stripped from cooked/packaged builds. |
| `NoSerialize` | Not saved or loaded. |
| `DuplicateTransient` | Reset to its default when the owning object is duplicated. |
| `SkipHotReload` | Excluded from script hot-reload state migration. |
| `ScriptReadOnly` / `ScriptWritable` / `ScriptHidden` | Shape the C# wrapper independently of the editor flags. Make an editor-hidden field writable from script, or hide a public field from C#. `NotScriptable` is an alias for `ScriptHidden`. |
| `Getter` / `Setter` | Route access through accessor functions. Bare `Getter` means `Get<Name>`, bare `Setter` means `Set<Name>`, or pass a name. |

Every reflected property is exposed to C# by default, so there is no opt-in
keyword. Use `ScriptHidden` when a field should stay out of script.

Some combinations contradict each other and are rejected at build time with
`LRT1008`, which names the specifier to delete: `Editable` with `ReadOnly`,
`ScriptReadOnly` with `ScriptWritable`, and `ScriptHidden` with either script
access specifier.

A specifier can take a value, and the value-carrying ones are stored as
**metadata** the editor reads. The set of specifiers is closed: one the Reflector
does not know is ignored with an `LRT1009` warning that names the nearest match,
so a misspelling never quietly does nothing. The common editor hints follow.

| Metadata | Effect |
| --- | --- |
| `Category = "..."` | Group the property under a header in the Details panel. |
| `DisplayName = "..."` | Override the label shown in the editor. |
| `ClampMin` / `ClampMax` | Numeric bounds on the drag/slider. |
| `Delta` | Drag sensitivity. |
| `Units = "..."` | Unit suffix shown after the value (e.g. `"m/s"`). |
| `Color` | Draw a color picker for a vector value. |
| `Multiline` | Multi-line text box for a string. |
| `DefaultCollapsed` | Start a nested struct or container collapsed. |
| `NoDrag` / `NoResize` / `NoReorder` | Remove drag editing, or the resize and reorder controls on a container. |
| `FilePath` | Draw a file browser for a string. |
| `Entity` | Draw an entity reference picker. |
| `AssetType = "..."` | Restrict an asset reference picker to one asset class. |
| `RequiresRecook` | Editing the value triggers a recook of the owning asset. |
| `ToolTip = "..."` | Hover text. A `/** ... */` comment above the property becomes this automatically. |

There are also pickers that constrain a value to something the owning asset
knows about: `BonePicker`, `SocketPicker`, `CurvePicker`, `InputAction`,
`ParameterPicker`, `ObjectParameterPicker`, and `RowType` for a data table row.

```cpp
PROPERTY(Editable, Category = "Movement", ClampMin = 0, Units = "m/s")
float MoveSpeed = 5.0f;

PROPERTY(Editable, Color)
FVector4 Tint = FVector4(1.0f);
```

### Instanced struct properties

A `TInstancedStruct<TBase>` property owns a struct instance whose concrete type
you pick in the Details panel, from `TBase` or any reflected struct deriving
from it. The picker sits on the property's row, and the chosen struct's own
properties edit inline beneath it. It is the value-type form of an instanced
object: store a different behavior struct per instance and edit it in place.

```cpp
#include "Core/Object/InstancedStruct.h"

REFLECT()
struct RUNTIME_API SCommand
{
    GENERATED_BODY()
};

REFLECT()
struct RUNTIME_API SWaitCommand : public SCommand
{
    GENERATED_BODY()

    PROPERTY(Editable, ClampMin = 0, Units = "s")
    float Seconds = 1.0f;
};

REFLECT(Component)
struct RUNTIME_API SAIComponent
{
    GENERATED_BODY()

    // The picker offers SCommand and every struct derived from it.
    PROPERTY(Editable)
    TInstancedStruct<SCommand> Command;
};
```

A bare `FInstancedStruct` accepts any reflected struct. Constrain it with
`PROPERTY(Editable, StructBase = "SCommand")` to get the same filtered picker
without naming the base in the C++ type.

Read the stored value with `Command.GetPtr<SWaitCommand>()` (null unless the
stored type is `SWaitCommand` or derived), and replace it with
`Command.InitializeAs<SWaitCommand>()`. The value serializes inline by the
chosen struct's name. The base `SCommand` only needs `REFLECT()` +
`GENERATED_BODY()`. This is a C++ workflow; a C# script cannot declare an
instanced property today.

### Container properties

A `TVector<T>` property is a resizable list, and a `THashMap<K, V>` property is a
key/value map. Both are `Editable`, serialize by walking their elements, and get
a built-in editor in the Details panel with no extra work.

```cpp
REFLECT(Component, Category = "Gameplay")
struct RUNTIME_API SLootComponent
{
    GENERATED_BODY()

    PROPERTY(Editable)
    TVector<FName> Drops;

    // Item id to spawn weight.
    PROPERTY(Editable)
    THashMap<FName, float> Weights;
};
```

In the Details panel a list shows **Add** and **Clear** on its header with a
numbered row per element; a map shows the same controls with one row per entry,
the **key** edited inline on the left and the **value** on the right. A struct
element or value expands to a nested table. **Map keys must be unique**, editing
a key to one that already exists is rejected and reverts. The same containers are
available to C# scripts as `List<T>` and `Dictionary<K, V>`; see
[Collections](/manual/scripting/entities-components/#collections).

## Functions

`FUNCTION()` exposes a member function to C#, so a script can call it on
the reflected type's wrapper (this is how `Transform.AddYaw(...)` or
`Controller.Jump()` reach native code, no binding written by hand).

```cpp
REFLECT(Component, Category = "Gameplay")
struct RUNTIME_API SDoorComponent
{
    GENERATED_BODY()

    PROPERTY(Editable)
    bool bOpen = false;

    FUNCTION()
    void Toggle() { bOpen = !bOpen; }
};
```

`FUNCTION(SuppressGCTransition)` skips the garbage collector transition on the
generated call. That is worth it for a short leaf function and wrong for anything
that blocks or calls back into managed code. `REFLECT(ScriptFastCalls)` applies it
to every function on the type, and `FUNCTION(NoSuppressGCTransition)` opts a
single one back out, for a function that may exceed the fast managed to native
budget (e.g. one that walks a hierarchy).

An argument whose type is not reflectable is dropped with a warning and the
function is skipped by the C# binder, because a generated thunk would call it
with too few arguments. Fix the argument type rather than ignoring the warning.

## Type specifiers

`REFLECT(...)` itself takes specifiers that classify the type.

| Specifier | Meaning |
| --- | --- |
| `Component` | The struct is an ECS component (shows up in the Add Component menu and gets a C# wrapper). |
| `System` / `Event` | Register the struct as an ECS system or an event type. |
| `Category = "..."` | The component's group in the Add Component menu. |
| `BitMask` | (Enums) treat the enum as flags, so the editor draws checkboxes. |
| `MinimalAPI` | Export `StaticStruct()`/`StaticClass()` across module boundaries without force-exporting the whole type. |
| `Scriptable` | (Classes) reflected virtuals become overridable from C#. |
| `ScriptFastCalls` | Apply `SuppressGCTransition` to every generated binding on the type. |
| `ConfigFile = "..."` | Back the class with a config file the settings system loads and saves. |
| `DisplayName = "..."` | Override the label shown for the type in the editor. |
| `HideInComponentList` | Keep the component out of the Add Component menu. |
| `HideInDetails` | Keep the type out of the Details panel. |
| `NotPlaceable` | (Classes) exclude from the node graph's placeable node list. |
| `ReflectedName = "..."` | Register the type under a different name. See [Reflecting a type under another name](#reflecting-a-type-under-another-name). |
| `NoCSharp` | Do not emit a C# type for this. |
| `CSharpValueMirror` | LuminaSharp hand-writes a blittable value mirror; bind properties of this type by value. |

`NoCSharp` and `CSharpValueMirror` are normally used together, and only by the
core math types whose C# side is hand-written to match an exact byte layout.

## The full specifier list

The tables above cover what you reach for day to day. Every specifier the four
macros accept is declared in one file,
`Engine/Applications/Reflector/Source/Reflector/ReflectionSpecifiers.h`, one line
each, with the macro it belongs to, whether it is a bare keyword or takes a
value, which system reads it, and what it does.

That file is the authority rather than a copy of one. The Reflector validates
every call site against it, so a specifier that is not listed there is reported
as `LRT1009` instead of being quietly ignored, and adding a new specifier means
adding its line to that file.

## Reflecting a type under another name

`ReflectedName` registers a type under a name other than its C++ identifier. The
engine uses this for `FTransform`, whose real type is the SIMD-backed
`VTransform`.

```cpp
REFLECT(ReflectedName = "FTransform")
struct alignas(16) VTransform
{
    GENERATED_BODY()
    ...
};
```

The type registers, serializes, and appears in the editor as `FTransform`, while
the generated code still uses `VTransform` wherever a real C++ declaration is
required.

The property-level counterpart is `ReflectAs`, which reflects a member **as a
different struct type** at the same offset. `VTransform` stores three 16-byte
SIMD vectors, but presents them as the scalar types a user expects:

```cpp
PROPERTY(Editable, ReflectAs = "FVector3")
SIMD::VFloat4 Location;

PROPERTY(Editable, ReflectAs = "FQuat")
SIMD::VFloat4 Rotation;
```

The offset stays the real member's, so nothing about the layout is written by
hand. `ReflectAs` only reinterprets one struct as another; using it on a
non-struct member is an error.

## Reflecting an alias

`REFLECT()` also works on a type alias, which reflects whatever record the alias
names, under the alias's own name. This is how the math types reflect: `FVector3`
is `TVec<float, 3>`, and the reflector walks the real template members rather
than a hand-written description of them.

```cpp
REFLECT(NoCSharp, CSharpValueMirror)
using FVector3 = TVec<float, 3>;
```

The aliased type's members still need `PROPERTY()` markers, and members inside an
anonymous union are supported, which is what lets `TVec` expose `x`, `y`, `z`
without also reflecting its `r`/`g`/`b` and `Data` aliases.

An alias never requires its target to be complete, so a template used nowhere
else is never instantiated and the reflector cannot see its members. That is
reported as `LRT2006`; add `static_assert(sizeof(FMyAlias) > 0);` after the alias
or use the type somewhere that requires it to be complete.

A type reflected through an alias has no `GENERATED_BODY()` and therefore no
`StaticStruct()` member. Properties of it work normally, but generic code that
calls `T::StaticStruct()` needs `TBaseStructure<T>::Get()` instead.

## Reflecting templates

`REFLECT()` on a class template makes **every instantiation a property names**
reflectable. You mark the template once, and each instantiation is registered
automatically the first time a reflected property uses it.

```cpp
REFLECT()
template<typename T>
struct TRange
{
    PROPERTY(Editable)
    T Min;

    PROPERTY(Editable)
    T Max;
};

REFLECT(Component)
struct RUNTIME_API SSpawnerComponent
{
    GENERATED_BODY()

    PROPERTY(Editable)
    TRange<float> Delay;          // registers as TRange_float

    PROPERTY(Editable)
    TRange<FVector3> Bounds;      // registers as TRange_FVector3

    PROPERTY(Editable)
    TVector<TRange<float>> Waves; // arrays of instantiations work too
};
```

Because `TRange<float>` is not a valid identifier, an instantiation registers
under a **mangled name**: the template's name, then each argument, joined with
underscores. Namespaces are dropped from the arguments, so
`TPair<int32, Lumina::FVector3>` becomes `TPair_int_FVector3`. That mangled name
is what appears in the editor and in saved data, so treat it as part of your
serialized format.

Multiple parameters, container members, and templates nested inside other
instantiations all work. Two things do not yet:

- **Template `CObject`s.** Each instantiation would need its own `CClass` and
  registration; only structs are supported.
- **`FUNCTION()` on a template.** Only fields are walked, so member functions of
  a template are not exposed.

## Naming prefixes

Reflection is also why Lumina's type names carry a one-letter prefix.

| Prefix | Meaning | Example |
| --- | --- | --- |
| `C` | A reflected class (a `CObject`, usually an asset or object type) | `CMaterial`, `CPrefab` |
| `S` | A reflected struct, including all components | `STransformComponent`, `SRigidBodyComponent` |
| `E` | An enum | `EDoorState` |
| `T` | A template | `TRange`, `TObjectPtr` |
| `F` | Everything else, whether reflected or not | `FVector3` (reflected), `FEngine` (not) |

When you see an `S`- or `C`-prefixed name in the editor or a script, it is a
reflected type, and the same name works in C#.

## How the metadata is generated

You never write the metadata by hand. A build-time tool, the **Reflector**
(`Engine/Applications/Reflector`), parses your headers with libclang and emits
two things per module.

- the `*.generated.h` files each header includes, and
- a generated source file that registers every type's `CClass`/`CStruct` at
  module load, plus the C# wrappers for its reflected members.

This runs as a **prebuild step before each module compiles**, so the generated
code is always in sync with your headers. The output lands in
`Intermediates/Reflection/`. It is generated, so don't edit it.

:::note
When you **add or remove** a reflected header, regenerate the project
(`GenerateProject.bat` / `.sh`, or `GenerateProjectFiles.bat` / `.sh` for the engine) so the new
file is picked up, then build. Editing an existing reflected header just needs a
rebuild. If the editor reports a missing `*.generated.h`, build again, the
prebuild sometimes needs a second pass.
:::

## Build errors

The Reflector reports through MSBuild, so its errors appear in the build log and
the IDE problem list with a stable `LRT` code.

| Code | Meaning | Usual fix |
| --- | --- | --- |
| `LRT1000` | A `PROPERTY` has a type the reflector cannot map. | Use a type from [Supported property types](#supported-property-types), or drop the `PROPERTY`. |
| `LRT1001` | A `PROPERTY` is a raw pointer. | Use `TObjectPtr<T>`. |
| `LRT1002` | A `TVector<T>` element type is not reflectable. | Same as `LRT1000`, applied to `T`. |
| `LRT1003` | A `TOptional<T>` payload type is not reflectable. | Same, applied to `T`. |
| `LRT1004` | Clang could not name the property's type. | Usually a missing include in the header. |
| `LRT1005` | A `FUNCTION` argument or return type is not reflectable (warning). | Change the signature, or the C# binding is skipped. |
| `LRT1006` | Header A includes B which includes A. | Break the cycle, often with a forward declaration. |
| `LRT1007` | A `PROPERTY` names a struct or class that is not reflected. | Add `REFLECT()` + `GENERATED_BODY()` to that type. |
| `LRT1008` | Two `PROPERTY` specifiers contradict each other. | The message names which one to delete. |
| `LRT1009` | A macro carries a specifier the Reflector does not know (warning). | Check the spelling against the tables above; the message suggests the nearest match. |
| `LRT2000` | A header has reflection macros but no `*.generated.h` include. | Add it as the last include. |
| `LRT2001` | The `*.generated.h` include is not last. | Move it to the end of the include block. |
| `LRT2002` | A `REFLECT`'d type has no `GENERATED_BODY()`. | Add it as the first line of the body. |
| `LRT2003` | The header includes a different file's `*.generated.h`. | Copy-paste mistake, fix the file name. |
| `LRT2004` | A reflected type lacks its `C`/`S`/`E` prefix. | Rename the type. |
| `LRT2005` | A `REFLECT`'d alias or class template does not name a usable record. | Only records can be reflected this way. |
| `LRT2006` | A `REFLECT`'d alias names a template that is never instantiated. | Add `static_assert(sizeof(TheAlias) > 0);` after it. |
| `LRT2007` | A `REFLECT`'d alias resolved a record with no members. | The target's fields need `PROPERTY()` markers. |
| `LRT9000`-`LRT9005` | Reflector driver problems (bad input file, libclang parse failure). | See [Reflection and Codegen](/internals/reflection-codegen/). |

Two errors come from the C++ compiler rather than the Reflector, and both mean
generation is out of date with the header:

- `..._GENERATED_BODY` is an undeclared identifier: the `GENERATED_BODY()` line
  moved, because the macro name embeds its line number. Rebuild.
- "Already included, missing `#pragma once`": two generated headers reached one
  translation unit, or the header is missing `#pragma once`.

## Struct operations

Alongside its properties, every reflected struct gets a small table of operations
called `FStructOps`. The codegen wires each struct's `StructOps` to
`MakeStructOps<T>()`, which inspects the type at compile time and fills in only
the operations the type actually supports. You register nothing. If your struct
defines one of these functions, the reflection system finds it and uses it.

These are the functions it looks for, each detected by whether your type provides
it.

| If your struct defines | `FStructOps` fills in | Used for |
| --- | --- | --- |
| `bool Serialize(FArchive&)` | `Serialize` | Disk serialization, replacing the default per-property path |
| `void NetSerialize(FNetArchive&)` | `NetSerialize` | Network/wire serialization, so a type can quantize itself |
| `void CopyFrom(const T&)` | `Copy` | Copying the value |
| `operator==` | `Equals` | Equality and editor diffing |
| `FString ToString() const` | `ToString` | Text display |
| `operator<` | `LessThan` | Sorting |

Two more come straight from the type. A `Construct` is filled in when the struct
is default-constructible, and a `Destruct` from its destructor, so the engine can
build and tear down instances (for example the default instance the editor diffs
against when you reset a property to its default).

When a struct provides none of the optional functions, the reflection system
falls back to its default behavior and walks the struct's reflected properties one
by one. So a custom `Serialize` or `NetSerialize` is an opt-in fast path or
special case, not a requirement. The quantized math types, for instance, define
`NetSerialize` to pack themselves tightly on the wire.

## What reflection powers

| System | How it uses reflection |
| --- | --- |
| **Editor** | The Details panel builds itself from a type's `Editable`/`ReadOnly` properties and their metadata, with no hand-written UI per component. |
| **Serialization** | Reflected properties are what gets written into worlds, prefabs, and assets; `EditorOnly` properties are stripped when cooking. |
| **Networking** | `Replicated` properties are collected and sent server to client, see [Networking](/manual/scripting/networking/). |
| **Scripting** | Every `Component` struct and every reflected property and function is exposed to C# by name, see [C# Scripting](/manual/scripting/). |
| **Object system** | `CClass`/`CStruct`, `StaticClass()`, type-safe casts, and object construction all run on the generated type info. |
