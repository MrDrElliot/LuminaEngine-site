---
title: Documentation Gaps
description: Systems that exist in the engine but are not documented yet.
sidebar:
  order: 3
---

This page tracks systems that are implemented in the engine but are not yet
covered, or are only covered indirectly. It exists so gaps are visible rather
than silently absent. Remove an entry when its page lands.

If you are looking for something to contribute, this is the list.

## Missing manual pages

| Topic | Where the source is | What a page needs to cover |
| --- | --- | --- |
| **User Interface (authoring)** | `Runtime/UI`, `Editor/.../RmlUiEditor` | Authoring RmlUi documents and stylesheets in the editor, the world widget component versus screen-space UI, UI material brushes, and world text. [The C# API](/manual/scripting/ui/) is documented; the authoring side is not. |
| **Input modes and contexts** | `Runtime/Input/InputMode.h`, `InputContext`, `InputViewport` | How UI versus Game input mode and mouse capture are chosen, and how input is routed per viewport. Actions and their bindings are covered in [Input](/manual/scripting/input/). |
| **Project and editor settings** | `Runtime/Config`, `Editor/Source/Settings` | What each settings class controls, where values are stored, and which ones require a restart. |
| **Foliage** | `Runtime/World/Entity/Components/FoliageComponent.h`, `Editor/.../FoliageEditMode` | Painting instanced foliage, density and scale, and how foliage re-projects after terrain edits. Currently only mentioned in passing on the [Terrain](/manual/terrain/) page. |
| **Blackboards (authoring)** | `Runtime/Assets/AssetTypes/Blackboard`, `Editor/.../Blackboard` | Authoring a blackboard asset and its keys. [The C# API](/manual/scripting/blackboard/) is documented; the asset editor is not. |
| **Audio streams and procedural audio** | `Runtime/Assets/AssetTypes/Audio`, `ProceduralAudioComponent` | Streaming audio assets and the procedural audio component. The [Audio](/manual/audio/) section covers sources, buses, and settings. |
| **Camera shakes** | `Runtime/World/Entity/Components`, camera rig system | Authoring shakes and playing them. [Cameras](/manual/cameras/) covers components and rigs. |
| **Geometry collections and destruction** | `Runtime/Assets/AssetTypes/GeometryCollection`, `DestructibleComponent` | Authoring destructible assets end to end. [Materials & Destruction](/manual/physics/materials-destruction/) covers part of this. |
| **Console variables reference** | `grep TConsoleVar` across `Engine/Source` | A user-facing list of the console variables worth setting. The mechanism is documented in [Diagnostics](/internals/diagnostics/). |

## Missing internals pages

| Topic | Where the source is | What a page needs to cover |
| --- | --- | --- |
| **UI internals** | `Runtime/UI`, `RmlUiBridge`, `RmlUiRenderer` | The RmlUi integration: document and context lifetime, the world widget render path, material brushes, and the editor context tick. |

## Documented behavior the engine no longer has

Removed from the docs because the feature is not currently reachable, rather than
because the page was missing. Restore the documentation when the gap closes.

| Topic | What happened |
| --- | --- |
| **`[Instanced]` script properties** | A `[Property]`'s value lives in native memory and the C# side reaches it through an accessor. `FInstancedStruct` properties are appended natively (`Scripting::AppendScriptPropertiesToClass`), but a script cannot yet declare or read one, so the "Instanced properties" section was removed from [Entities & Components](/manual/scripting/entities-components/). The C++ workflow on the [Reflection](/manual/reflection/) page is unaffected. |
| **Nested C# structs as script properties** | Same cause. The native planner mints a sub-struct for one, but there is no C# marshalling for it, so it is a `LUM0101` build error. |
| **Non-blittable list and map elements** | `NativeList<T>` and `NativeMap<K, V>` require unmanaged element types, so `NativeList<string>` is not expressible. The native container supports string elements already; only the C# view is missing. |

## Deferred

| Topic | Status |
| --- | --- |
| **Generated API reference** | Deferred. A class reference generated from the reflection database is the intended eventual home for per-type and per-property documentation. The hand-written manual comes first. |

## Ground rules for filling a gap

- Verify against the source. Do not describe intended behavior, describe what the
  code does.
- Distinguish implemented, partially implemented, and planned explicitly. If a
  system has a role or a flag reserved for future work, say so rather than
  implying the feature exists.
- Keep code examples in step with the real API. Never invent a call to round out
  an example.
- No em dashes.
- Add the page to the sidebar in `astro.config.mjs`, and remove its row here.
