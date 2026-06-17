---
title: User Interface
description: Screen-space UI with RmlUi. Load documents, drive the DOM, and handle events from C#.
---

Lumina's screen UI is built on **[RmlUi](https://mikke89.github.io/RmlUiDoc/)**,
an HTML/CSS-style retained-mode UI library. You author the look as **`.rml`**
markup and **`.rcss`** stylesheet assets, then load, show, and drive them from a
script through `World.UI`. Documents render full-screen over the world's view.

:::note
`World.UI` is screen-space UI for a world's viewport. For UI that lives *in* the
world (a panel on a control console, a floating health bar), use a world-space
`SWidgetComponent` instead.
:::

## Authoring a document

An RML document is markup with an attached stylesheet. Create one from the
Content Browser and edit it in the [UI asset editor](/manual/editor/asset-editors/).
Here is a minimal menu.

```html
<rml>
<head>
    <title>Lumina Menu</title>
    <link type="text/rcss" href="Menu.rcss"/>
</head>
<body>
    <div id="panel">
        <div class="title">LUMINA</div>
        <div id="play" class="button">Play</div>
        <div id="toggle" class="button secondary">Toggle Theme</div>
        <div id="status" class="status">Click Play to begin.</div>
    </div>
</body>
</rml>
```

Elements are matched from script by their `id` (`#play`) or CSS classes, and
`.rcss` styles them with familiar CSS-like properties (`color`, `width`,
`background-color`, flexbox layout, transitions). See the
[RmlUi RCSS reference](https://mikke89.github.io/RmlUiDoc/pages/rcss.html).

## Loading and showing

Load a document by its virtual asset path. It starts hidden, call `Show` to
present it. A common pattern is to expose the path as a `[Property]` so it's
editable.

```csharp
public sealed class Menu : EntityScript
{
    [Property(Tooltip = "RML document shown on screen.", AssetType = "rml")]
    public string Document = "/Game/Content/UI/Menu.rml";

    private UIDocument _Doc;

    public override void OnReady()
    {
        _Doc = World.UI.LoadDocument(Document);
        if (!_Doc.IsValid)
        {
            Debug.LogError($"Failed to load UI document '{Document}'.");
            return;
        }

        _Doc.Show();
        World.UI.EnableCursor();   // free the cursor so buttons are clickable
    }

    public override void OnDetach()
    {
        _Doc.Close();              // unload before the world tears down
        World.UI.DisableCursor();
    }
}
```

| `World.UI` member | Does |
| --- | --- |
| `LoadDocument(path)` | Loads an `.rml` asset; returns a `UIDocument` (hidden until shown). |
| `LoadDocumentFromMemory(rml, sourceUrl)` | Loads a document from an in-memory RML string. |
| `SetInputMode(mode)` / `SetCursorMode(mode)` | Route input and set cursor visibility (below). |
| `EnableCursor()` / `DisableCursor()` | Shortcuts for menu-open / menu-close cursor state. |

| `UIDocument` member | Does |
| --- | --- |
| `Show(modal, autoFocus)` | Make it visible. `modal` blocks focus to other documents. |
| `Hide()` | Hide without unloading (handles + listeners stay valid). |
| `Close()` | Unload and destroy. Element handles from it become invalid. |
| `BringToFront()` | Raise above other documents in z-order. |
| `Root` | The document's body element. |

## Finding and changing elements

Reach an element by `id` (the indexer or `GetElementById`) or a CSS selector
with `Query`. The returned `UIElement` is a lightweight handle, calls on a
missing element are safe no-ops.

```csharp
UIElement Score = _Doc["score"];        // by id, shorthand for GetElementById
UIElement Fill = _Doc.Query(".bar > .fill");

Score.SetText($"Score: {_Points}");     // escaped plain text
Fill.SetStyle("width", "75%");          // inline CSS
Fill.AddClass("full");
```

| `UIElement` member | Does |
| --- | --- |
| `SetText(value)` / `Text` | Set plain text (HTML-escaped). |
| `Rml` | Get/set the element's inner RML markup (not escaped). |
| `SetStyle(prop, value)` / `ClearStyle(prop)` | Set or remove an inline CSS property. |
| `AddClass` / `RemoveClass` / `ToggleClass(c, on)` / `HasClass` | CSS class control. |
| `GetAttribute(name)` / `SetAttribute(name, value)` | Read/write an attribute. |
| `SetVisible(bool)` / `Visible` | Show/hide via CSS `display`. |
| `Focus()` / `Blur()` / `Click()` | Focus control and synthesizing a click. |
| `Query(selector)` | First descendant matching a CSS selector. |

:::note[Property vs method form]
`Text` and `Visible` are property setters, so they work on a stored variable
(`var e = _Doc["x"]; e.Visible = false;`). On a chained call off the indexer
(`_Doc["x"]`), use the method form (`SetText`, `SetVisible`); you can't assign a
struct property on an rvalue.
:::

## Events

Subscribe to an RmlUi event on an element with `On` (or the `OnClick` shorthand).
The handler runs on the game thread. `On` returns a `UIEventSubscription`, so
**dispose it before the world tears down** (in `OnDetach`).

```csharp
private UIEventSubscription? _PlayClick;

public override void OnReady()
{
    // Wire callbacks BEFORE Show so the first click is handled.
    _PlayClick = _Doc["play"].OnClick(() => StartGame());
    _Doc.Show();
}

public override void OnDetach()
{
    _PlayClick?.Dispose();
    _Doc.Close();
}
```

`OnClick` accepts a no-argument handler or one that takes a `UIEvent`; `On` takes
an event-type string and a `UIEvent` handler. Common event types are `"click"`,
`"mousedown"`, `"mouseup"`, `"mouseover"`, `"mouseout"`, `"mousemove"`,
`"keydown"`, `"keyup"`, `"textinput"`, `"change"`, `"submit"`, `"focus"`,
`"blur"`.

The `UIEvent` passed to a handler.

| Field | Meaning |
| --- | --- |
| `Type` | The `UIEventType` (e.g. `Click`, `MouseDown`, `Change`). |
| `Target` | The deepest element the event originated on. |
| `Current` | The element the listener is attached to. |
| `MouseButton` | 0 = left, 1 = right, 2 = middle; -1 if not a mouse event. |
| `MouseX` / `MouseY` | Cursor position in the document's layout space. |
| `KeyIdentifier` | The RmlUi key id, for key events. |
| `Ctrl` / `Shift` / `Alt` / `Meta` | Modifier keys held with the event. |

## Cursor and input routing

While a menu is open you usually want a visible cursor and the UI to receive
clicks; during gameplay you want the cursor captured for mouselook. `World.UI`
controls both.

```csharp
World.UI.EnableCursor();    // GameAndUI input + a free, visible cursor
World.UI.DisableCursor();   // Game-only input + a captured (hidden, locked) cursor
```

For finer control, set the modes directly.

| `UIInputMode` | Routing |
| --- | --- |
| `Game` | Input drives gameplay only; the UI gets nothing. |
| `UI` | Input drives the UI only; gameplay input is gated off. |
| `GameAndUI` | UI gets first refusal, the rest reaches gameplay. |

| `UICursorMode` | Cursor |
| --- | --- |
| `Normal` | Visible and free, for menus and pointer UI. |
| `Hidden` | Hidden but free to move. |
| `Captured` | Hidden and locked to the window, for mouselook. |

```csharp
World.UI.SetInputMode(UIInputMode.UI);
World.UI.SetCursorMode(UICursorMode.Normal);
```

## Full example

This script loads a menu, wires two buttons back to C#, and mutates the live DOM
in response, the end-to-end shape of a `World.UI` screen.

```csharp
using System;
using LuminaSharp;
using Lumina;

namespace Game;

public sealed class MenuExample : EntityScript
{
    [Property(Tooltip = "RML document shown on screen.", AssetType = "rml")]
    public string Document = "/Game/Content/UI/Menu.rml";

    private UIDocument _Menu;
    private UIEventSubscription? _PlayClick;
    private UIEventSubscription? _ToggleClick;
    private int _PlayCount;
    private bool _DarkTheme = true;

    public override void OnReady()
    {
        _Menu = World.UI.LoadDocument(Document);
        if (!_Menu.IsValid)
        {
            Debug.LogError($"Failed to load UI document '{Document}'.");
            return;
        }

        _PlayClick = _Menu["play"].OnClick(OnPlay);
        _ToggleClick = _Menu["toggle"].OnClick(OnToggleTheme);

        _Menu.Show();
        World.UI.EnableCursor();
    }

    private void OnPlay(UIEvent Event)
    {
        _PlayCount++;
        _Menu["status"].SetText($"Play clicked {_PlayCount}x");
    }

    private void OnToggleTheme(UIEvent Event)
    {
        _DarkTheme = !_DarkTheme;
        _Menu["panel"].SetStyle("background-color", _DarkTheme ? "#1e1e2eff" : "#eff1f5ff");
        _Menu["status"].SetText(_DarkTheme ? "Dark theme" : "Light theme");
    }

    public override void OnDetach()
    {
        _PlayClick?.Dispose();
        _ToggleClick?.Dispose();
        _Menu.Close();
        World.UI.DisableCursor();
    }
}
```
