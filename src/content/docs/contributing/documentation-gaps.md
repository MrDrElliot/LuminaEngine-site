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

## The manual

The game developer manual is being rewritten from scratch, because the old pages
had fallen behind the engine. Only [Reflection](/manual/reflection/) and
[Logging](/manual/logging/) remain.

| Topic | Where the source is | What a page needs to cover |
| --- | --- | --- |
| **Console variables reference** | `grep TConsoleVar` across `Engine/Source` | A user-facing list of the console variables worth setting. The mechanism is documented in [Diagnostics](/internals/diagnostics/). |

## Missing internals pages

| Topic | Where the source is | What a page needs to cover |
| --- | --- | --- |
| **UI internals** | `Runtime/UI`, `RmlUiBridge`, `RmlUiRenderer` | The RmlUi integration: document and context lifetime, the world widget render path, material brushes, and the editor context tick. |
