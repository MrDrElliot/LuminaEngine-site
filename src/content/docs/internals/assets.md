---
title: Assets
description: The virtual file system, asset registry, asset manager, and cooking.
---

An asset in Lumina is a `CObject` saved in a `CPackage`. Three layers sit above
that:

- **VFS**, an alias-based virtual file system so nothing hard-codes a disk path.
- **`FAssetRegistry`**, the on-disk index: what exists, its GUID, its class, and
  what it depends on. Built without loading anything.
- **`FAssetManager`**, the loader: turns a GUID into a live object, deduplicating
  concurrent requests.

For the authoring view (importing, texture settings, referencing) see the
[Asset Pipeline](/manual/assets/) section of the manual.

## Virtual file system

`Lumina::VFS` (`FileSystem/FileSystem.h`) maps aliases to backends:

```cpp
VFS::Mount<VFS::FNativeFileSystem>("/Engine", EngineDirectory);
VFS::Mount<VFS::FNativeFileSystem>("/Intermediates", IntermediatesDirectory);
```

Standard aliases are `/Engine`, `/Game` (the project), `/Intermediates`, and one
per enabled plugin with content.

Two behaviors regularly bite:

- **The mount list is append-only** and directory iteration visits every entry.
  Re-mounting a project-scoped alias without `VFS::Unmount` first stacks
  duplicate mounts, so iteration returns everything twice. Always unmount before
  re-mounting on a project reload or switch.
- `VFS::ToVirtualPath` is best effort: a `/`-prefixed input is normalized as is,
  otherwise it is matched against each native mount's base path, and an
  unmatched path is returned **verbatim**. Do not assume the result is a valid
  virtual path.

In a packaged build, `FEngine::MountCookedRuntime` mounts the `.pak` next to the
executable plus a loose-file overlay, so patches can override packed content.

## The asset registry

`FAssetRegistry` walks engine, project, and plugin content and extracts an
`FAssetData` record per `.lasset` **without loading the asset**. It reads the
package header and import table only, which is what makes a full content scan
affordable.

```
FAssetData
    GUID
    AssetName
    Class
    PackagePath
    Flags        (EAssetFlags, including Primary)
    Dependencies (GUIDs, from the import table)
```

### Discovery

- Discovery runs asynchronously on the task system.
- It is **incremental**, backed by an `.assetdb` cache
  (`<EngineInstall>/Intermediates/AssetRegistry.assetdb`) keyed on modification
  time plus content hash. Unchanged assets are not reparsed.
- A reap pass removes cached entries under a walked root that were not visited
  this discovery, which is how externally deleted files disappear. **Content
  belonging to a disabled plugin survives**, because its mount is not a walked
  root.
- In a cooked runtime the cooker bundles a pre-baked binary registry into the
  `.pak`, so the runtime skips the filesystem scan entirely. The editor cache is
  JSON; the shipped one is compact binary.

### Dependencies

Dependencies come from the package import table, so they are exact rather than
heuristic. A lazily built reverse map (`dep -> referrers`) answers "what
references this asset" in O(1) average, which drives reference views, safe
delete, and the cooker's traversal.

### Text assets

Some loose text files are tracked as assets so references to them survive a
rename or a move. They are not packages, so they get identity from a hidden
`.lmeta` sidecar holding a GUID, and they live in a map entirely separate from
`FAssetData` and the cook dependency graph.

`ETextAssetKind` lists the tracked extensions: `.rml` (RmlUi document), `.rcss`
(RmlUi stylesheet), and `.luau`, which is a leftover from the previous scripting
layer. C# script files are **not** tracked this way; they are compiled by the
scripting host, not referenced as assets.

The registry can mint a sidecar on create or first touch, and remaps every
tracked text file under a directory when a folder is moved or renamed. This pass
is editor only; the shipped registry already carries the table.

### Broadcast coalescing

Every mutation fires `OnAssetRegistryUpdated`. A bulk operation (importing a
folder of meshes) would fire it thousands of times, so the registry supports
suspension:

```cpp
{
    FScopedAssetRegistryBatch Batch;   // reentrant, nests safely
    // import many assets
}   // one broadcast, and only if something actually changed
```

Broadcasts are always fired **outside** the registry's mutex, so a listener can
re-enter the (non-recursive) registry without deadlocking itself.

## The asset manager

`FAssetManager` turns GUIDs into objects:

| Call | Behavior |
| --- | --- |
| Async load | Kicks off, or joins, a load and returns a shared handle. |
| Sync load | Joins an in-flight async load with a **fiber-aware wait**, or loads inline on the caller. Null on failure. |
| Flush | Blocks until every in-flight load finishes. Fiber-aware. |

The `InFlight` map (asset GUID to shared handle) is what deduplicates concurrent
requests: ten systems asking for the same mesh in the same frame produce one
load.

Because the waits are fiber aware, a worker that blocks on an asset parks its
fiber and the worker keeps doing other work. See
[Task System](/internals/task-system/).

### Primary assets

`EAssetFlags::Primary` marks assets addressable by a `TPrimaryAssetId<T>`, which
is a name-based identity rather than a GUID. `FAssetManager` resolves an id to
the asset whose `AssetName` matches **and** which carries the `Primary` flag,
returning an invalid handle otherwise.

## Loading paths

Three entry points, and picking the wrong one is a common mistake:

| Call | Use for |
| --- | --- |
| `FindObject<T>(...)` | Something already loaded. Never triggers a load. |
| `StaticLoadObject` / `LoadObject<T>` | A single reference, including from inside another load. |
| `StaticLoadObjectGraph` / `CPackage::LoadAssetGraph` | A large fan-out open: a world, a level travel. Loads the whole dependency closure in parallel. |

The graph loader is built on top of the inline loader, not the other way around.
Calling it from inside a load to resolve one reference reenters the phased loader
and is wrong. See [Serialization](/internals/serialization/) for the phase rules,
in particular that `Serialize` must not dereference a dependency's data.

## Asset types

`Assets/AssetTypes` holds the engine's own asset classes:

`Animation`, `Audio`, `DataAsset`, `Font`, `GeometryCollection`,
`Material`, `MaterialFunction`, `Mesh`, `ParticleSystem`, `PhysicsAsset`,
`PhysicsMaterial`, `Prefabs`, `Textures`.

Adding a new asset type means: a `CObject` subclass with `IsAsset()` returning
true, reflection markers, a factory so the content browser can create it, and (if
it needs one) an editor tool. See
[Editor Architecture](/internals/editor-architecture/).

`CObject::IsBinary()` selects binary or structured (text) serialization for that
type.

## Importing

`Runtime/Tools/Import` holds the import pipeline. Third-party parsers are
vendored: **fastgltf** for glTF, **OpenFBX** for FBX, **tinyobjloader** for OBJ,
**basis_universal** for texture compression, **MeshOptimizer** for mesh
optimization and meshlet building, and **MikkTSpace** for tangents.

Imports run in parallel across the job system. Two details worth knowing:

- Texture cooking normalizes to RGBA8 before handing data to basis_universal,
  which requires exactly `Width * Height * 4` bytes. A source image with a
  different channel count that skips the normalize step produces a corrupt or
  crashing cook.
- Material import creates material instances from the source file's material
  definitions and wires texture references, so a re-import updates parameters
  without discarding user overrides.

## Cooking and packaging

The cooker walks the dependency graph from a set of **cook roots**, which are the
union of the project's roots and those of enabled plugins. `FEngine::GetCookRoots`
assembles that list; a legacy `GameStartupMap` auto-converts to a single root when
no explicit roots exist.

Traversal is transitive and distinguishes hard references (direct `CObject*`)
from soft ones (`FSoftObjectPath`, registered through
`FArchive::RegisterSoftAssetReference`). That classification decides what is
pulled into a chunk.

Output:

- Cooked packages, compressed through `CPackage::SavePackageForCook`.
- A pre-baked binary asset registry.
- The SPIR-V shader cache, so the packaged build never invokes Slang.
- A `.pak` archive (`Runtime/Pak`), mounted at startup with a loose-file overlay.

## Deleting assets and fixing up references

Deleting is not just removing a file. Every delete funnels through
`FContentBrowserEditorTool::RequestDeletion`, which asks the registry for the
referencers of everything in the delete set, minus edges internal to that set.

If anything outside the set still points at it, a modal
(`ReplaceReferencesModal`) offers a per-asset choice of a replacement or a null.
The referencing packages are then rewritten and saved **before** the asset is
removed. The same modal backs the standalone "Replace References..." action,
which retargets without deleting.

Below that, `CPackage::DestroyPackage` still nulls any remaining live references
across the object graph, removes prefab instances, and clears the package's
dirty flag so it cannot appear in the save prompt. An open world cannot be
deleted, and nothing can be deleted while playing.

### Why the fixup is an archive

Referencer edges come from `FAssetData::Dependencies`, which the package saver
builds in `FPackageSaver::operator<<(CObject*&)` during an ordinary `Serialize`
traversal. So every edge the registry can report is, by construction, reachable
by any other archive walking `Object->Serialize(Ar)`. `FObjectReferenceReplacerArchive`
is that archive.

A reflection property walk would be wrong here. World and prefab asset
references live in components, reached through `CWorld::Serialize` ->
`ECS::Utils::SerializeRegistry` -> `SerializeTaggedProperties`, not through
reflected properties on the `CObject`. A walk over `CStruct` properties sees
none of them.

Soft references needed a separate hook, because `FSoftObjectPath` serializes as
a raw `FString` plus `FGuid` with nothing for an archive to intercept.
`FArchive::RewriteSoftAssetReference` sits beside `RegisterSoftAssetReference`
and is called on the write side only; it defaults to returning false, so no
other archive is affected.

Replacement candidates are filtered to the original's class or a subclass.
`FObjectProperty::Serialize` performs no type check on assignment, so a wider
filter would be a latent crash rather than a warning.

## Common failure modes

| Symptom | Cause |
| --- | --- |
| Content appears twice in the browser | A duplicate mount from re-mounting an alias without unmounting. |
| Deleted file still listed | The reap pass did not run, or the file is under a mount that is not a walked root (disabled plugin content). |
| Editor stalls during a bulk import | Missing `FScopedAssetRegistryBatch`, so every asset fired a broadcast. |
| Deadlock in a registry listener | A listener re-entered the registry while the mutex was held. Broadcasts must fire outside the lock. |
| Asset loads twice | Two different GUIDs for the same content, usually a copied file that kept its sidecar or was re-minted. |
| An asset on disk is missing from the browser | Two `.lasset` files share a GUID, usually a file-level copy. `ProcessPackagePath` is keyed on GUID and the last one scanned wins. |
| A reference survived a delete | The referencer's edge is not in the import table, so the registry never listed it. Check for a `FStructOps` custom serializer bypassing the property walk. |
| Corrupt cooked texture | The source was not normalized to RGBA8 before basis_universal. |
| Asset missing from a package | Marked transient or marked for destroy at save time. |
