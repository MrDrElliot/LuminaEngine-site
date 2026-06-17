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

- **`REFLECT(...)`** annotates a class, struct, or enum for reflection.
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

        PROPERTY(Script, Editable, Category = "Health", ClampMin = 0)
        float Max = 100.0f;

        PROPERTY(Script, ReadOnly)
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

## Properties

`PROPERTY(...)` exposes a field. The specifiers control what each system may do
with it.

| Specifier | Effect |
| --- | --- |
| `Editable` | Shown and editable in the Details panel; serialized. |
| `ReadOnly` | Shown in the Details panel but not editable; serialized. |
| `Script` | Exposed to C# (readable/writable per the editor flags above). |
| `Replicated` | Participates in [network replication](/manual/scripting/networking/). |
| `EditorOnly` | Kept for editor tooling; stripped from cooked/packaged builds. |
| `NoSerialize` | Not saved or loaded. |
| `ScriptReadOnly` / `ScriptWritable` / `ScriptHidden` | Shape the C# wrapper independently of the editor flags. Make an editor-hidden field writable from script, or hide a public field from C#. |

A specifier can take a value, and any `Key = Value` the macro doesn't recognize
is stored as **metadata** the editor reads. The common editor hints follow.

| Metadata | Effect |
| --- | --- |
| `Category = "..."` | Group the property under a header in the Details panel. |
| `ClampMin` / `ClampMax` | Numeric bounds on the drag/slider. |
| `Units = "..."` | Unit suffix shown after the value (e.g. `"m/s"`). |
| `Color` | Draw a color picker for a vector value. |

```cpp
PROPERTY(Editable, Category = "Movement", ClampMin = 0, Units = "m/s")
float MoveSpeed = 5.0f;

PROPERTY(Editable, Color)
FVector4 Tint = FVector4(1.0f);
```

## Functions

`FUNCTION(Script)` exposes a member function to C#, so a script can call it on
the reflected type's wrapper (this is how `Transform.AddYaw(...)` or
`Controller.Jump()` reach native code, no binding written by hand).

```cpp
REFLECT(Component, Category = "Gameplay")
struct RUNTIME_API SDoorComponent
{
    GENERATED_BODY()

    PROPERTY(Editable)
    bool bOpen = false;

    FUNCTION(Script)
    void Toggle() { bOpen = !bOpen; }
};
```

`FUNCTION(Script, NoSuppressGCTransition)` is a variant for a function that may
exceed the fast managed→native budget (e.g. one that walks a hierarchy).

## Type specifiers

`REFLECT(...)` itself takes specifiers that classify the type.

| Specifier | Meaning |
| --- | --- |
| `Component` | The struct is an ECS component (shows up in the Add Component menu and gets a C# wrapper). |
| `System` / `Event` | Register the struct as an ECS system or an event type. |
| `Category = "..."` | The component's group in the Add Component menu. |
| `BitMask` | (Enums) treat the enum as flags. |
| `MinimalAPI` | Export only the reflection plumbing across modules, not the whole type. |

There are also opt-outs for the C# layer (`NoCSharp` / `ManualStub`) for types
whose bindings are hand-written instead of generated (the core math types use
these).

## Naming prefixes

Reflection is also why Lumina's type names carry a one-letter prefix.

| Prefix | Meaning | Example |
| --- | --- | --- |
| `C` | A reflected class (a `CObject`, usually an asset or object type) | `CMaterial`, `CPrefab` |
| `S` | A reflected struct, including all components | `STransformComponent`, `SRigidBodyComponent` |
| `F` | A plain (non-reflected) engine type | `FVector3`, `FName` |

When you see an `S`- or `C`-prefixed name in the editor or a script, it is a
reflected type, and the same name works in C#.

## How the metadata is generated

You never write the metadata by hand. A build-time tool, the **Reflector**
(`Engine/Applications/Reflector`), parses your headers with libclang (the
`REFLECT`/`PROPERTY`/`FUNCTION` macros expand to clang annotations it reads) and
emits two things per module.

- the `*.generated.h` files each header includes, and
- a generated source file that registers every type's `CClass`/`CStruct` at
  module load, plus the C# wrappers for `Script`-flagged members.

This runs as a **prebuild step before each module compiles**, so the generated
code is always in sync with your headers. The output lands in
`Intermediates/Reflection/`. It is generated, so don't edit it.

:::note
When you **add or remove** a reflected header, regenerate the project
(`GenerateProject.bat`, or `GenerateProjectFiles.bat` for the engine) so the new
file is picked up, then build. Editing an existing reflected header just needs a
rebuild. If the editor reports a missing `*.generated.h`, build again, the
prebuild sometimes needs a second pass.
:::

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
| **Networking** | `Replicated` properties are collected and sent server→client, see [Networking](/manual/scripting/networking/). |
| **Scripting** | Every `Component` struct and `Script` property/function is exposed to C# by name, see [C# Scripting](/manual/scripting/). |
| **Object system** | `CClass`/`CStruct`, `StaticClass()`, type-safe casts, and object construction all run on the generated type info. |
