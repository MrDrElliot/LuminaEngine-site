---
title: Introduction
description: What Lumina is, what you need, and what to expect.
---

Lumina is a modern C++ game engine built on Vulkan. It pairs a data-driven
editor with C# scripting, an EnTT-based entity component system, a reflection
system, and a forward+ renderer. It is built for learning real engine
architecture and for prototyping on a clean, modular codebase.

This section takes you from a fresh clone to the editor running with your first
project loaded.

## What you will do

1. Build the engine from source.
2. Run the editor and create a project from its project browser.
3. Launch the editor with your project loaded.

## Supported platforms

Lumina builds and runs on **64-bit Windows and 64-bit Linux**. There are no
macOS builds. Both platforms are built from the same sources by the same build
tool, and every entry-point script has a counterpart on the other: `Setup.bat`
and `Setup.sh`, `LuminaBuild.bat` and `LuminaBuild.sh`.

The differences that matter are the compiler, and what the IDE story looks like.
Windows generates a Visual Studio solution; Linux generates a
`compile_commands.json` for clangd-based tooling, because nothing there can open
a `.sln`.

### Every platform

| Requirement | Details |
| --- | --- |
| .NET | The .NET 10 SDK (x64), required to build the C# scripting layer |
| GPU | A GPU and driver supporting Vulkan 1.4 **and mesh shaders** (`VK_EXT_mesh_shader`) |
| Git | Any recent version |

The GPU requirement is a hard floor, not a recommendation: the renderer draws all
geometry through mesh shaders and is rejected at startup on a device that cannot
run them. That means NVIDIA Turing (GTX 16 / RTX 20) or newer, AMD
RDNA2 (RX 6000) or newer, or Intel Arc.

### Windows

| Requirement | Details |
| --- | --- |
| OS | Windows 10 (1803 or newer) or Windows 11, 64-bit |
| IDE | Visual Studio 2026 (18.0 or newer) with the MSVC v143 toolset |

:::caution[Visual Studio 2026 is required]
The C# scripting layer targets **.NET 10**, which only Visual Studio 2026
(MSBuild 18.0+) can build. VS 2022 fails with `NETSDK1209`. `Setup.bat` checks
for both the .NET 10 SDK and a new-enough Visual Studio and tells you what is
missing.
:::

### Linux

| Requirement | Details |
| --- | --- |
| Distribution | Any 64-bit distribution |
| Compiler | GCC 13 or newer, or Clang against a libstdc++ that new. Built and tested with GCC 13-15. |
| Window system | X11 development packages, which GLFW links directly. Wayland sessions work through XWayland. |
| Vulkan | The loader (`libvulkan1`) and your vendor's driver, at run time only |

:::note
The compiler floor is `<format>`, which landed in libstdc++ 13. The Vulkan
packages are a run-time requirement rather than a build one: the Vulkan headers
are vendored and entry points are resolved with `dlopen`, so a machine with no
driver still compiles a working editor it cannot launch. `Setup.sh` checks all
of it, including whether any installed GPU actually reports `VK_EXT_mesh_shader`.
:::

:::note
JetBrains Rider works on both platforms, but is not required. On Windows the
project templates ship Rider run configurations next to the Visual Studio ones,
and there is a [Rider plugin](/getting-started/installation/#rider-plugin) that
adds build actions and reflection macro highlighting.
:::

:::caution
Lumina is under active development, so APIs change. If you hit a build issue
these docs do not cover, ask on
[Discord](https://discord.gg/xQSB7CRzQE) or
[open an issue](https://github.com/MrDrElliot/LuminaEngine/issues).
:::

Ready? Continue to [Installation](/getting-started/installation/).
