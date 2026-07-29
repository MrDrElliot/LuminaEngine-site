---
title: The Object System
description: CObject, CClass, packages, handles, and object lifetime.
---

`CObject` is the base for every reflected engine type: assets, settings,
components' data classes, the world, the game instance. If a type needs
reflection, serialization, an editor property grid, or a path you can reference
by name, it is a `CObject`.

The system is deliberately close to Unreal's shape (classes, class default
objects, packages, path names), but the lifetime model is different: **Lumina
reference counts objects, it does not trace them**. There is no mark and sweep
pass.

## The pieces

| Type | Role |
| --- | --- |
| `CObjectBase` | Storage-level base: flags, internal index, name, package, GUID, registration. |
| `CObject` | The public base: serialization, lifecycle hooks, duplication. |
| `CStruct` | Reflected type layout: properties, super, size. |
| `CClass` | A `CStruct` for a `CObject` type: adds functions, the class default object, and a factory. |
| `CEnum` | Reflected enum: names, values, metadata. |
| `CPackage` | A named container of objects, and the unit of on-disk storage. |
| `FCObjectArray` | The global object table (`GObjectArray`): chunked, index-addressed, refcount-owning. |

Object paths are `<package-path>.<object-name>`, for example
`/Game/Materials/Rock.Rock`.

## Declaring a class

```cpp
// MyThing.h
#pragma once
#include "Core/Object/Object.h"
#include "MyThing.generated.h"

namespace Lumina
{
    REFLECT()
    class MYMODULE_API CMyThing : public CObject
    {
        GENERATED_BODY()
    public:

        PROPERTY(Editable, Category = "General")
        float Radius = 1.0f;

        FUNCTION()
        void Recalculate();
    };
}
```

`GENERATED_BODY()` expands to code the [Reflector](/internals/reflection-codegen/)
emits into `MyThing.generated.h`. The include must be last, and the file must be
named after the header.

`DECLARE_CLASS(Namespace, Class, BaseClass, Package, API)` (emitted for you)
gives the type `StaticClass()`, `StaticName()`, `StaticPackage()`, `ThisClass`,
and `Super`. Engine classes live in the `/Script/Engine` package.

## Registration

Reflected types register themselves at static initialization time into a
deferred queue, because a `CClass` cannot be built before the object system
exists. `ProcessNewlyLoadedCObjects()` drains that queue and constructs the
classes.

`FEngine::Init` calls it after every module loading phase. This is why a module's
static initializer must not dereference `StaticClass()` for a type from another
module: the registration may not have been processed yet. Do that work in
`StartupModule` instead.

The registration entry points are `RegisterCompiledInInfo` overloads for
classes, structs, and enums; the generated code calls them. You never call them
by hand.

### Class default objects

Every `CClass` owns a **class default object** (CDO), an instance carrying the
declared default property values. It is flagged `OF_DefaultObject`. The CDO is
what:

- Property initialization copies from when a new instance is constructed.
- Serialization diffs against, so only changed properties are written.
- `GetDefault<T>()` returns, which is how settings classes are read.

`PostCreateCDO()` runs once when the CDO is created. Use it for class-level setup
that needs the defaults populated. Do not put per-instance work there.

## Creating objects

```cpp
CMyThing* Thing = NewObject<CMyThing>(Package, "Name");
```

Construction order:

1. `StaticAllocateObject` allocates from the object allocator and assigns an
   internal index in `GObjectArray`.
2. The C++ constructor runs.
3. Reflected properties are initialized from the CDO.
4. `PostInitProperties()` is called.

Look-ups:

| Function | Behavior |
| --- | --- |
| `FindObject<T>(Name)` / `FindObject<T>(GUID)` | Returns an already-loaded object, or null. Never loads. |
| `StaticLoadObject(GUID)` / `LoadObject<T>(Name)` | Loads inline if needed. This is the right call to resolve a single reference from inside a load. |
| `StaticLoadObjectGraph(GUID or Name)` | Loads the target **and its whole dependency closure in parallel**. Use for big fan-out opens (worlds, level travel). Do not call it from inside a load to resolve one reference. |
| `AsyncLoadObject(GUID, Callback)` | Fires the callback when the object is available. |

## Lifetime

`GObjectArray` is a chunked fixed array of `FCObjectEntry` records. Each entry
holds the object pointer plus a **strong** and a **weak** reference count. The
array owns the counts, not the object, which is what makes the weak-to-strong
upgrade safe.

### Pointer types

| Type | Semantics |
| --- | --- |
| `TObjectPtr<T>` | Strong, owning. While any `TObjectPtr` holds an object it stays alive, so dereferencing is always safe. The last release triggers destruction. |
| `TWeakObjectPtr<T>` | Non-owning. Validates on access and returns null once the object is gone. |
| `TSubclassOf<T>` | A `CClass*` constrained to a subclass of `T`. |
| `TSoftObjectPtr<T>` | A path reference that does not force a load. |
| `T*` | A raw pointer. Valid only for as long as something else keeps the object alive. |

Two invariants worth knowing before you touch `TObjectPtr`:

- **Layout**: exactly one `T*`, pointer-sized. `FObjectProperty` serialization
  and the script bindings read a `TObjectPtr<T>` member as a raw `T*` at offset
  zero. Do not add members to it.
- **Weak upgrade is atomic**: `TWeakObjectPtr::Pin()` (backed by
  `FCObjectArray::TryAddStrongRef`) validates and acquires the strong reference
  together, inside the object array. Calling `Get()` and then wrapping the raw
  pointer races a concurrent destroy into a use-after-free; the pin path does
  not.

### Roots

`AddToRoot()` / `RemoveFromRoot()` set and clear `OF_Rooted`, which keeps an
object alive independent of references. Use it for objects that must outlive the
thing that created them, and pair every add with a remove.
`FObjectScopeGuard` (`ObjectScopeGuard.h`) is the RAII form.

### Destruction

- `ConditionalBeginDestroy()` destroys the object if nothing references it.
- `ForceDestroyNow()` destroys it regardless. Anything still holding a raw
  pointer is now holding a dangling one.
- Both funnel into `DestroyInternal`, which marks the entry, calls `OnDestroy()`,
  and frees. It is the single teardown path.
- `IsValid(Object)` is the safe check; it validates against the object array
  rather than just testing for null.

At shutdown, `FCObjectArray` arms a guard so releasing the root set stops
destroying objects one at a time, and `ShutdownCObjectSystem()` does a single
ordered pass instead.

## Flags

`EObjectFlags` (`ObjectFlags.h`):

| Flag | Meaning |
| --- | --- |
| `OF_Transient` | Never saved. |
| `OF_Rooted` | In the root set. |
| `OF_DefaultObject` | This is a CDO. |
| `OF_NeedsLoad` | Declared by the package but not yet loaded. |
| `OF_Loading` | Currently loading. |
| `OF_NeedsPostLoad` | Loaded, `PostLoad` not yet run. |
| `OF_WasLoaded` | Came from disk rather than being constructed. |
| `OF_Public` | Referenceable from outside its package. |
| `OF_MarkedDestroy` | Scheduled for destruction. Package save skips these. |

`LexToString(EObjectFlags)` produces a pipe-joined string, which is what the
editor's object debugging views show.

## Lifecycle hooks

| Hook | When |
| --- | --- |
| `PostInitProperties()` | After the constructor and property initialization, for both constructed and loaded objects. |
| `PostCreateCDO()` | Once, when the class default object is created. |
| `PreLoad()` / `PostLoad()` | Around deserialization. `PostLoad` is where you fix up loaded data. |
| `PostPropertyChange(FProperty*)` | A property was edited externally, typically from the editor property grid. |
| `OnDestroy()` | During teardown. |

`Serialize(FArchive&)` handles binary serialization;
`Serialize(IStructuredArchive::FRecord)` handles the structured path used for
text assets and networking. `IsBinary()` selects which one an asset uses. See
[Serialization](/internals/serialization/).

## Packages

`CPackage` is both a namespace for objects and the unit of storage. One package
maps to one file on disk. Key behaviors:

- Objects created with a package parent belong to it, and their path is
  `<package>.<name>`.
- Saving a package writes every owned object that is not `OF_Transient` and not
  `OF_MarkedDestroy`. An object marked for destruction is silently skipped, so
  "my object did not save" usually means it was marked.
- `Rename(NewName, NewPackage)` moves an object between packages and updates the
  object hash.
- `CPackage::LoadAssetGraph` is the parallel dependency-closure loader behind
  `StaticLoadObjectGraph`.

## Duplication

`Duplicate()` templates a new object from an existing one, copying **reflected
properties only**. Anything held in a non-reflected member is not carried over.
`CopyPropertiesTo(Other)` does the same into an existing instance.

## Structs and instanced structs

Reflected non-object structs are `CStruct`s with an `S` name prefix
(`SPostProcessSettings`). They have properties but no CDO, no functions table,
and no lifetime management; they are plain value types the reflection system can
walk.

`FInstancedStruct` holds a `CStruct*` plus its instance data, which gives you a
polymorphic, editable value inside a property. The editor renders it as a type
picker plus the chosen type's properties.

**`CScriptStruct`'s `StructOps` is null.** Always null-check
`GetStructOps()` before using it; script-defined structs do not have the native
operations table that compiled structs do.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Null `CClass*` in a static initializer | `ProcessNewlyLoadedCObjects` has not processed that module yet. |
| Use-after-free from a weak pointer | `Get()` followed by wrapping the raw pointer. Use the atomic pin instead. |
| Object silently missing from a saved package | It was `OF_Transient`, or `OF_MarkedDestroy`. |
| Property lost after `Duplicate()` | The member is not reflected. Only `PROPERTY` members are copied. |
| Crash walking a `CScriptStruct` | `GetStructOps()` returned null and was dereferenced. |
| Object leaks until shutdown | An `AddToRoot()` with no matching `RemoveFromRoot()`. |
