---
title: Serialization
description: Archives, the package file format, and the phased dependency loader.
---

Lumina has two serialization paths that share the same `Serialize` entry points
on `CObject`:

- **`FArchive`**, a flat binary reader/writer. This is what packages use.
- **`IStructuredArchive`**, a named-field hierarchical writer with a JSON
  backend. Used for text assets and for network snapshots.

`CObject::IsBinary()` selects which one an asset type uses.

## FArchive

`Core/Serialization/Archiver.h`. A single class handles both directions; the
direction is a flag, and `operator<<` means "serialize", not "write".

```cpp
void CMyThing::Serialize(FArchive& Ar)
{
    Super::Serialize(Ar);
    Ar << Radius;
    Ar << Name;
    Ar << TargetObject;   // CObject*, becomes a package index
}
```

| Query | Meaning |
| --- | --- |
| `IsWriting()` | Serializing out. |
| `IsReading()` | Serializing in. |
| `HasError()` | The stream failed. Check this after bulk reads. |
| `Tell()` / `Seek()` / `TotalSize()` | Positional access, where the backend supports it. |

Overloads exist for every integral type, `float`, `double`, `bool`, `FString`,
`FFixedString`, `FName`, `CObject*`, `FObjectHandle`, and `FField*`.

### FName on the wire

`FName` serialization has one trap worth knowing. `None`'s wire form is the
**empty string**. Its `c_str()` renders `"NAME_None"`, which is a display string
and must never round-trip back into a real name. The archive decodes both forms:
files older than the `FNAME_NONE_EMPTY_STRING` version stored `None` as its
display rendering, and those are mapped back to `None` on load.

### Soft references

`RegisterSoftAssetReference(GUID)` is how an `FSoftObjectPath` records a
dependency without forcing a load. The cook dependency graph classifies these
edges as `EDependencyType::Soft`, while direct `CObject*` references are `Hard`.
That distinction drives what the cooker pulls into a chunk.

### Derived archives

| Archive | Use |
| --- | --- |
| `FMemoryArchiver` | In-memory buffer. |
| `FObjectArchiver` | Adds object-reference resolution over a byte stream. |
| `FProxyArchive` | Forwards to another archive; the base for filters. |
| `FNetArchive` | Network serialization, with `NetQuantize` helpers for compressed vectors and rotations. |
| `FPackageLoader` / `FPackageSaver` | The package format, below. |
| `FObjectReferenceReplacerArchive` | Walks an object graph swapping references, used by asset rename and prefab reparenting. |

## Structured archives

`Core/Serialization/Structured`. `IStructuredArchive` exposes records, fields,
and arrays instead of a flat byte stream:

```cpp
void CMyThing::Serialize(IStructuredArchive::FRecord Record)
{
    Super::Serialize(Record);
    Record << SA_VALUE("Radius", Radius);
}
```

`JsonStructuredArchive` is the concrete backend. Text assets use it, which is
what makes them diff-friendly in version control.

## The package format

A package file is one `CPackage` and every object it owns. The layout is a
header, an import table, an export table, and a blob of object data.

```
FPackageHeader
    uint32 Tag                 PACKAGE_FILE_TAG (0x9E2A83C1)
    int32  Version
    int64  ImportTableOffset
    int32  ImportCount
    int64  ExportTableOffset
    int32  ExportCount
    int64  ObjectDataOffset
    int64  ThumbnailDataOffset
[import table]
[export table]
[object data]
[thumbnail]
```

`FPackageHeader` is asserted standard-layout and trivially copyable, so it can be
read as a block.

### Exports

An `FObjectExport` describes one object stored in this package:

| Field | Purpose |
| --- | --- |
| `ObjectGUID` | Stable identity across renames. |
| `ObjectName` | Name within the package. |
| `ClassName` | Resolved to a `CClass` at load. |
| `Offset` / `Size` | Where the object's data lives in the data blob. |
| `Object` | Weak pointer, populated at load time. |

Because each export records its own offset and size, an export can be loaded
without reading the others. That is what makes partial loads possible.

### Imports

An `FObjectImport` is a reference to an object in another package, stored as a
GUID plus a dependency classification (`Hard` or `Soft`).

### Package indices

References inside object data are stored as `FObjectPackageIndex`, a signed
integer where **negative is an import, positive is an export, and zero is null**.
The encoding is `Import: -(i + 1)`, `Export: i + 1`. `CPackage::IndexToObject`
resolves one.

## Loading

`CPackage` is itself a `CObject` (in a deliberately empty package). The entry
points:

| Call | Behavior |
| --- | --- |
| `CPackage::LoadPackage(Path)` | Opens the file, reads the header and tables. Objects are not necessarily resident. |
| `CPackage::FullyLoad()` | Loads every export. |
| `CPackage::LoadObject(GUID / Name)` | Loads one export. |
| `CPackage::LoadAssetGraph(RootGUID)` | The parallel dependency-closure loader. |

### The phased graph loader

`LoadAssetGraph` is the path used for large fan-out opens (worlds, level travel).
Rather than recursing through references (which serializes the whole load behind
one thread), it runs three phases over each package's entire export table, and
gets its parallelism by running packages concurrently:

1. **Create shells.** For every export, create or find the object with
   `OF_NeedsLoad` set. No data is read. After this phase, every cross-package
   reference can resolve to a live pointer.
2. **Serialize.** Read each export's data. References resolve to already-created
   shells, so nothing triggers a nested load. `PostLoad` is deferred; objects
   come out marked `OF_NeedsPostLoad`.
3. **PostLoad.** Run the deferred `PostLoad` for every object that owes one,
   **leaf first** across packages, so a `PostLoad` sees its dependencies already
   post-loaded.

The critical rule that falls out of phase 2:

> **Do not dereference a dependency's data inside `Serialize`.** During a graph
> load the referenced object exists but its properties may not be populated yet.
> Move that work to `PostLoad`.

Violating it produces bugs that only reproduce when an asset is opened through
the graph loader and not through a plain inline load, which makes them
miserable to track down.

`StaticLoadObject` (the inline path) is still the right call to resolve a single
reference from inside a load. The graph loader is built on top of it, not the
other way around.

### Loader byte caching

A package caches its uncompressed file bytes while loads are in flight and frees
them once every export is resident. If an export is still unloaded, the bytes are
kept, and `EnsureLoader` re-reads them lazily if they were dropped. A transient
or never-saved package has no backing file, so `EnsureLoader` returns false and
leaves the loader null.

`LoadDepth` tracks reentrancy of object loads sharing one loader, so the byte
cache is only dropped when the outermost load finishes.

## Saving

`CPackage::SavePackage(Package, Path)` builds an `FSaveContext`, writes the
tables, then the object data.

Rules that surprise people:

- Objects flagged `OF_Transient` are skipped.
- Objects flagged `OF_MarkedDestroy` are skipped. If an object "did not save",
  check whether something marked it for destruction first.
- `SavePackageForCook` produces the compressed cooked form into a buffer instead
  of writing a file.
- `MarkDirty()` / `IsDirty()` drive the editor's save prompt. Saving clears it.

## Versioning

`FPackageHeader::Version` is the format version. Loaders branch on it for
backward compatibility, as the `FName` `None` case above shows. Version constants
live in `Core/Versioning`. When you change a serialized layout, bump the version
and handle the old shape on read; there is no automatic upgrade pass.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Data reads back as garbage only when opening a world | A `Serialize` dereferenced a dependency's data during a graph load. Move it to `PostLoad`. |
| An `FName` loads as a real name called `NAME_None` | Something wrote `c_str()` instead of going through the archive's `FName` operator. |
| Object missing from a saved package | `OF_Transient` or `OF_MarkedDestroy`. |
| Old assets fail to load after a layout change | The version was not bumped, or the read path does not handle the old shape. |
| Reference resolves to null after a rename | The reference was stored by name rather than GUID. Exports carry a GUID precisely so renames survive. |
