---
title: Introduction
description: What Lumina is, what you need, and what to expect.
---

Lumina is a modern C++ game engine built on Vulkan. It pairs a data-driven
editor with Luau scripting, an EnTT-based entity component system, a reflection
system, and a forward+ renderer. It is built for learning real engine
architecture and for prototyping on a clean, modular codebase.

This section takes you from a fresh clone to the editor running with your first
project loaded.

## What you will do

1. Build the engine from source.
2. Run the editor and create a project from its project browser.
3. Open the generated solution and launch the editor with your project loaded.

## Supported platforms

Lumina is Windows only. There are no macOS or Linux builds, and none are
planned. Everything below assumes a 64-bit Windows machine.

| Requirement | Details |
| --- | --- |
| OS | Windows 10 (1803 or newer) or Windows 11, 64-bit |
| IDE | Visual Studio 2022 with the MSVC v143 toolset (17.8 or newer) |
| GPU | A GPU and driver supporting Vulkan 1.4 |
| Git | Any recent version |

:::note
JetBrains Rider also works, but it is not required. The project templates ship
Rider run configurations next to the Visual Studio ones.
:::

:::caution
Lumina is under active development, so APIs change. If you hit a build issue
these docs do not cover, ask on
[Discord](https://discord.gg/xQSB7CRzQE) or
[open an issue](https://github.com/MrDrElliot/LuminaEngine/issues).
:::

Ready? Continue to [Installation](/getting-started/installation/).
