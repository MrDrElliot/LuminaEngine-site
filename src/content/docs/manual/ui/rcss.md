---
title: RCSS Styling
description: Styling RmlUi documents in Lumina. Selectors, units, layout, fonts, and exactly which properties the renderer supports.
---

**RCSS** is RmlUi's stylesheet language. It is CSS with a smaller surface: the
same selector syntax, the same cascade, the same box model, and a subset of the
properties. This page covers what Lumina actually supports, which is narrower
than CSS in some places and different in others.

Rules live in a `.rcss` file linked from a document head, or inline in a
`<style>` block:

```html
<link type="text/rcss" href="Theme.rcss"/>
```

## The one rule that bites everyone

**RmlUi has no user-agent stylesheet.** A browser ships default rules that make
`<div>` a block, `<p>` a paragraph with margins, `<h1>` big and bold. RmlUi ships
none of that. Every element starts as `display: inline` with no margin, no
padding, and no font size of its own.

The visible symptom: a panel you gave a `width`, `padding`, and `background-color`
renders as a thin smear of text that ignores all three, because an inline box
does not take a width.

Start every stylesheet with this line:

```css
div { display: block; box-sizing: border-box; }
```

RmlUi's own debugger stylesheet does exactly this. Add whatever other container
tags you use.

## Selectors

| Selector | Matches |
| --- | --- |
| `div` | Every element with that tag. |
| `.panel` | Every element with that class. |
| `#hud` | The element with that `id`. |
| `div.panel` | Elements matching all parts. |
| `a b` | `b` anywhere inside `a`. |
| `a > b` | `b` that is a direct child of `a`. |
| `a + b` | `b` immediately after sibling `a`. |
| `a ~ b` | `b` after sibling `a`. |
| `a, b` | Either. |
| `*` | Everything. |

Specificity and the cascade work as in CSS: more specific wins, later wins on a
tie, and `style="..."` on the element beats any rule.

### Pseudo-classes

| Pseudo-class | State |
| --- | --- |
| `:hover` | The cursor is over the element. |
| `:active` | The element is being pressed. |
| `:focus` | The element has keyboard focus. |
| `:checked` | A checkbox, radio, option, or tab is selected. |
| `:disabled` | A form control is disabled. |

Structural selectors are also supported: `:first-child`, `:last-child`,
`:only-child`, `:first-of-type`, `:last-of-type`, `:only-of-type`,
`:nth-child(an+b)`, `:nth-last-child()`, `:nth-of-type()`,
`:nth-last-of-type()`, `:empty`, and `:not(selector)`.

```css
.button:hover        { background-color: #6c7086; }
.row:nth-child(2n)   { background-color: #181825; }
.check:checked       { background-color: #a6e3a1; }
```

## Units

| Unit | Meaning |
| --- | --- |
| `dp` | **Density-independent pixel. Use this by default.** |
| `px` | Raw pixels. Does not scale with the display. |
| `%` | Percentage of the containing block. |
| `em` / `rem` | Relative to this element's / the root's font size. |
| `vw` / `vh` | Percentage of the viewport width / height. |
| `in`, `cm`, `mm`, `pt`, `pc` | Physical units, scaled like `dp`. |
| `deg` / `rad` | Angles, for `transform` and gradients. |

### Why `dp`

For screen-space UI the density ratio is the viewport height divided by 1080,
clamped so it never goes below 1. So at 1080p and below, `1dp` is `1px`; at 1440p
a `dp`-authored layout comes out proportionally larger instead of shrinking into
the corner. Author in `dp` and your UI holds its proportions across resolutions.

`px` is right for hairlines and anything that should stay exactly one pixel.

## Layout

`display` accepts `none`, `block`, `inline`, `inline-block`, `flow-root`, `flex`,
`inline-flex`, and the `table` family. There is **no CSS grid**.

Flexbox is the full modern implementation, and it is what you want for most
layout:

```css
body {
    width: 100%; height: 100%;
    display: flex;
    align-items: center;      /* flex-start | flex-end | center | baseline | stretch */
    justify-content: center;  /* ... | space-between | space-around | space-evenly */
}

.toolbar {
    display: flex;
    flex-direction: row;      /* row | row-reverse | column | column-reverse */
    flex-wrap: wrap;
    gap: 12dp;                /* row-gap + column-gap */
}

.toolbar .spacer { flex-grow: 1; }
```

Positioning works as in CSS: `static`, `relative`, `absolute`, `fixed`, with
`top` / `right` / `bottom` / `left` and `z-index`.

:::caution[Absolute elements need an explicit size]
If you anchor an element with `right` or `bottom` but leave the opposing
dimension `auto`, RmlUi resolves it to shrink-to-fit at the left or top edge
instead, and the element lands in the wrong corner. Give absolutely positioned
elements an explicit `width` and `height`.
:::

Also worth knowing: for a positioned child's percentage offsets to resolve
against its parent, the parent needs `position: relative`, same as CSS.

## Supported properties

Everything in this list is registered and works.

| Group | Properties |
| --- | --- |
| **Box** | `width`, `height`, `min-width`, `max-width`, `min-height`, `max-height`, `margin` (+ per-side), `padding` (+ per-side), `box-sizing` |
| **Border** | `border-width`, `border-color` (+ per-side), `border-radius` (+ per-corner), the `border` / `border-top` / etc. shorthands |
| **Layout** | `display`, `position`, `top`, `right`, `bottom`, `left`, `float`, `clear`, `z-index`, `overflow`, `overflow-x`, `overflow-y`, `clip`, `visibility`, `vertical-align` |
| **Flex** | `flex`, `flex-flow`, `flex-direction`, `flex-wrap`, `flex-grow`, `flex-shrink`, `flex-basis`, `align-items`, `align-self`, `align-content`, `justify-content`, `gap`, `row-gap`, `column-gap` |
| **Color** | `background-color`, `color`, `image-color`, `caret-color`, `opacity` |
| **Text** | `font-family`, `font-style`, `font-weight`, `font-size`, `line-height`, `letter-spacing`, `text-align`, `text-decoration`, `text-transform`, `white-space`, `word-break` |
| **Effects** | `decorator`, `font-effect`, `transform`, `transform-origin`, `perspective`, `transition`, `animation` |
| **Interaction** | `cursor`, `drag`, `tab-index`, `focus`, `pointer-events`, `nav-up` / `-right` / `-down` / `-left`, `scrollbar-margin`, `overscroll-behavior` |

Colors accept `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, and the standard
color keywords.

:::note[No CSS variables]
RCSS has no `var()` and no custom properties. Share a palette by defining
semantic classes (`.text-muted`, `.surface-raised`) or named `@decorator` rules
in a theme stylesheet, and linking that stylesheet from every document.
:::

## What does not render in Lumina

These properties parse without error and then draw nothing. They need
render-interface features (shader compilation and offscreen layers) that Lumina's
RmlUi renderer does not implement.

| Avoid | Use instead |
| --- | --- |
| `box-shadow` | A border, or a `ninepatch` decorator with a baked shadow. |
| `filter`, `backdrop-filter` | Bake the effect into the texture. |
| `mask-image` | A pre-masked texture, or `ninepatch`. |
| `linear-gradient`, `radial-gradient`, `conic-gradient`, and their `repeating-` forms | `horizontal-gradient` / `vertical-gradient` (below). |
| The `shader` decorator | An `image` decorator. |

A shader-based decorator that cannot compile logs
`[RmlUi] Could not generate decorator element data:` **every frame**, so a flood
of that message in the log means one of these slipped into a stylesheet.

## Decorators

`decorator` draws the background of an element. These are the ones that work:

| Decorator | Draws |
| --- | --- |
| `horizontal-gradient(start stop)` | A two-stop gradient, left to right. |
| `vertical-gradient(start stop)` | A two-stop gradient, top to bottom. |
| `image(path)` | A texture stretched over the element. |
| `tiled-horizontal`, `tiled-vertical`, `tiled-box` | A texture tiled with fixed caps. |
| `ninepatch(outer, inner)` | A nine-slice texture that stretches without distorting corners. |

```css
.header {
    decorator: vertical-gradient(#313244 #1e1e2e);
}

@decorator brand-fill : horizontal-gradient {
    start-color: #cba6f7;
    stop-color:  #89b4fa;
}

.title { decorator: brand-fill; }
```

## Text effects

`font-effect` is rendered into the font atlas, so unlike `box-shadow` it works:

```css
.hud-title {
    font-effect: outline(2dp #000000);
}
```

Available effects are `outline`, `glow`, `shadow`, and `blur`.

## Fonts

Lumina registers the fonts, not your stylesheet. Two families are available:

| Family | Weights | Use for |
| --- | --- | --- |
| `Lumina` | Regular | Body text. This is the engine default. |
| `JetBrains Mono` | `bold`, extra-bold only | Numbers, timers, key caps. |

The engine stamps `font-family: Lumina` on each context root, so **omit
`font-family` entirely** and everything inherits a working font.

:::caution[Font lookups are exact]
RmlUi does not fall back between weights or synthesize them. A `font-family` plus
`font-weight` combination that was never loaded resolves to nothing, and every
text element logs `No font face defined` every frame.

Three consequences:

- `JetBrains Mono` **must** be paired with `font-weight: bold` or heavier. There
  is no regular weight loaded.
- Write family names **unquoted**. `font-family: "JetBrains Mono"` keeps the
  quotes as part of the name and never matches.
- The family is `Lumina`, which is a name the engine chose. It is not the font
  file's own name, so `font-family: LatoLatin` does not exist.
:::

```css
.stat-value {
    font-family: JetBrains Mono;
    font-weight: bold;
}
```

## Animation and transitions

Both work and are CPU-side, so they are safe to use.

```css
.button {
    transition: background-color 0.15s ease-out;
}

@keyframes pop {
    from { transform: scale(0.9); opacity: 0; }
    to   { transform: scale(1.0); opacity: 1; }
}

.dialog { animation: 0.2s ease-out pop; }
```

## At-rules

| At-rule | Purpose |
| --- | --- |
| `@decorator` | Define a named, reusable decorator. |
| `@spritesheet` | Name sub-rectangles of a texture, usable as `sprite` on `<img>` and in decorators. |
| `@keyframes` | Define an animation. |
| `@media` | Apply rules conditionally, for example by resolution. |

`@import` and `@font-face` are **not** supported. Link stylesheets with `<link>`,
and use the fonts the engine registers.

## Keeping it fast

RmlUi's layout is **document-granular**: changing one element's text dirties the
whole document's layout, not just that element's subtree. That is fine for a menu
and matters for a HUD that updates every frame.

Three things that help:

- **Only push values when they change.** A view-model's `Set` helper already
  does this: it compares before pushing, so a health value that stays at 100
  costs nothing. Formatting a string every frame and assigning it unconditionally
  defeats that, so compute first and assign second.
- **Prefer block layout for simple rows.** A flex item with an `auto` main size
  makes RmlUi run a throwaway sub-layout just to measure it. A row with
  `justify-content: space-between` and two auto-sized children pays that twice
  per reflow. For a plain label-and-value row, `float: left` with an explicit
  width and a right-aligned value is cheaper.
- **Split volatile readouts into their own document.** A per-frame counter in its
  own small document reflows only that document.

The renderer is not the bottleneck: geometry is cached and batched, and skipped
entirely when nothing changed. The cost is CPU layout.
