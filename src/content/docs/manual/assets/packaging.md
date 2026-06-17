---
title: Cooking & Packaging
description: Building a shipped game from your assets.
---

When you ship, your loose assets are **cooked** into a compact, runtime-ready
form. You do not run the cooker by hand, **File > Package Project** does it all.

## What packaging does

1. **Cook.** Starting from your startup maps, the cooker follows every asset
   dependency and bundles only the assets your game actually reaches. Editor-only
   data is stripped out, and a cache skips re-cooking assets that have not
   changed.
2. **Bundle.** Cooked assets are written into `.pak` archives.
3. **Build.** Your game module is compiled (Shipping by default), and the
   executable and archives are copied to the output folder.

The result is a self-contained build you can distribute.

## Options

The Package Project dialog lets you set the following.

- **Output Directory**, where the build is written. Defaults to a `Build/` folder in your project.
- **Configuration**, the build configuration, Shipping by default.
- **Loose scripts**, mirror your `Game/Scripts` next to the executable instead of
  inside the archive, handy for tweaking gameplay scripts after a build.

## How the shipped game loads

The packaged executable mounts its `.pak` archives at startup and runs against
them. If no archive is present, it falls back to a loose `/Game` folder next to
the executable. Either way, your content resolves by the same content paths it
used in the editor.
