---
title: User Interface
description: Authoring UI in Lumina with RmlUi. Documents, stylesheets, and the two places UI can appear.
---

Lumina's UI is built on **[RmlUi](https://mikke89.github.io/RmlUiDoc/)**, a
retained-mode UI library that reads like HTML and CSS. You author two kinds of
file:

- **`.rml`**, the **document**: the markup that says what elements exist.
- **`.rcss`**, the **stylesheet**: the rules that say how they look and lay out.

Both are plain text, both live in your project's content folder, and both are
edited in the [UI editor](/manual/ui/editor/) with a live preview.

:::caution[RmlUi is not a browser]
RML and RCSS look like HTML and CSS, and most of what you know transfers. But
RmlUi has **no user-agent stylesheet**, so an unstyled `<div>` is `display: inline`
and a panel will silently collapse. This one difference accounts for most of the
"why is my UI broken" time a new author loses. See
[The one rule that bites everyone](/manual/ui/rcss/#the-one-rule-that-bites-everyone).
:::

## Where UI appears

There are two separate paths, and picking the wrong one is a common first
mistake.

| | Screen-space UI | World-space UI |
| --- | --- | --- |
| **What it is** | A document drawn flat over the viewport: menus, HUDs, dialogs. | A document rasterized onto a quad that lives in the level: a console panel, a floating name plate. |
| **How you use it** | [`World.UI`](/manual/scripting/ui/) from a script. | The **Widget Component** on an entity. See [World Widgets](/manual/ui/world-widgets/). |
| **Input** | Receives mouse and keyboard through the viewport. | Not interactive. |

Each world owns its own screen-space UI context, created with the world and
destroyed with it. Documents you load in one world never appear in another.

## Quick start

Five minutes from nothing to a menu on screen.

### 1. Create a document

In the [Content Browser](/manual/editor/content-browser/), right-click a folder
and choose **New UI Widget**. You get `NewWidget.rml` with a working skeleton.
Double-click it to open the [UI editor](/manual/ui/editor/).

```html
<rml>
<head>
    <title>New Widget</title>
    <style>
        /* RmlUi has no HTML-like default stylesheet: EVERY element starts as
           display:inline, so containers must be made block (or flex) or they
           collapse and ignore width/padding/margin. */
        div { display: block; box-sizing: border-box; }

        /* Fill the view and center the panel. 'dp' scales with the display. */
        body { width: 100%; height: 100%; display: flex;
               align-items: center; justify-content: center;
               color: #cdd6f4; font-size: 16dp; }

        .panel { padding: 24dp; background-color: #1e1e2e;
                 border-width: 1dp; border-color: #45475a; border-radius: 8dp; }
    </style>
</head>
<body>
    <div class="panel">
        <div>Hello from RmlUi.</div>
    </div>
</body>
</rml>
```

The preview pane shows it immediately. You do not need to run the game to
iterate on layout.

### 2. Give it something to show

Replace the panel with a button and a status line, and bind both to data instead
of hard-coding them:

```html
<body data-model="menu">
    <div class="panel">
        <div class="button" data-event-click="Play()">Play</div>
        <div class="status">{{ Status }}</div>
    </div>
</body>
```

`data-model` names the view-model this subtree binds to, `{{ Status }}`
interpolates a value from it, and `data-event-click` calls a method on it. This
is [data binding](/manual/ui/rml/#data-binding), and it is the way to drive UI in
Lumina.

### 3. Drive it from a script

A script registers the view-model, then loads and shows the document.

```csharp
using LuminaSharp;
using Lumina;

namespace Game;

public sealed class MainMenu : EntityScript
{
    [Property(Tooltip = "RML document shown on screen.")]
    public string Document = "/Game/Content/UI/Menu.rml";

    private sealed class MenuModel : ViewModel
    {
        private string _Status = "Click Play to begin.";

        [Bind] public string Status { get => _Status; set => Set(ref _Status, value); }

        [BindCommand] public void Play() => Status = "Starting...";
    }

    private MenuModel _Model = null!;
    private UIDataModel? _Binding;
    private UIDocument _Menu;

    public override void OnReady()
    {
        _Model = new MenuModel();
        _Binding = World.UI.AddModel("menu", _Model);   // BEFORE LoadDocument

        _Menu = World.UI.LoadDocument(Document);
        _Menu.Show();                                    // documents load hidden
        World.UI.EnableCursor();                         // so the button is clickable
    }

    public override void OnDetach()
    {
        _Menu.Close();
        _Binding?.Dispose();
        World.UI.DisableCursor();
    }
}
```

Add a **C# Script** component to any entity in the world, point it at
`Game.MainMenu`, and press Play.

:::note[Order matters]
`AddModel` must run **before** `LoadDocument`. RmlUi resolves data bindings when
the document is parsed, so a document loaded before its model binds to nothing
and never recovers. If your `{{ }}` render as literal braces, this is why.
:::

## Where files live

Documents are loaded by **virtual path**, the same paths the rest of the engine
uses:

| Path | Resolves to |
| --- | --- |
| `/Game/Content/UI/Menu.rml` | Your project's content. |
| `/Engine/Resources/Content/UI/...` | Engine content, including the bundled examples. |
| `/MyPlugin/...` | A mounted plugin's content. |

Inside a document, `href` and `src` accept either an absolute virtual path or a
path relative to the document's own folder. Prefer absolute paths for anything
shared between folders, and relative paths for a stylesheet that sits beside its
document.

## Bundled examples

The engine ships working examples under
`Engine/Resources/Content/UI/Examples/`, each with a matching script in
`Engine/Resources/Scripts/`. Attach the script to an entity and press Play.

| Example | Script | Shows |
| --- | --- | --- |
| `Menu.rml` | `Lumina.Examples.MenuExample` | Commands, computed values, toggling a class from a bound bool. |
| `Composition/HudComposed.rml` | `Lumina.Examples.HudExample` | One model driving three composed `<template>` widgets. |
| `Composition/Settings.rml` | `Lumina.Examples.SettingsExample` | Two-way form binding and a command with an argument. |
| `Composition/Roster.rml` | `Lumina.Examples.RosterExample` | List binding with `data-for`. |
| `Composition/Hud.rml` | (open in the editor) | The same HUD with empty slots, to fill in with the [composition designer](/manual/ui/editor/#composing-widgets). |

## The rest of this section

- **[RML Syntax](/manual/ui/rml/)**, document structure, elements, templates, and the full data binding reference.
- **[RCSS Styling](/manual/ui/rcss/)**, selectors, units, fonts, layout, and exactly which properties Lumina's renderer supports.
- **[The UI Editor](/manual/ui/editor/)**, editing, previewing, and composing documents without leaving the editor.
- **[World Widgets](/manual/ui/world-widgets/)**, putting a document on a surface in the level.
- **[Driving UI from C#](/manual/scripting/ui/)**, the `World.UI` API: view-models, documents, elements, events, and cursor control.
