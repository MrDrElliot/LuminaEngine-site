---
title: Editing These Docs
description: How to edit and preview the documentation site.
sidebar:
  order: 2
---

This documentation site is a separate repo built with
[Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Local preview

```sh
git clone https://github.com/MrDrElliot/LuminaEngine-site.git
cd LuminaEngine-site
npm install
npm run dev
```

Open the printed local URL. Pages live in `src/content/docs/` as Markdown
(`.md`) or MDX (`.mdx`). The sidebar is defined in `astro.config.mjs`.

## Adding a page

1. Create a `.md` file under `src/content/docs/<section>/`.
2. Give it a `title` in the frontmatter.
3. Add it to the `sidebar` in `astro.config.mjs` (or rely on
   `autogenerate` for sections that use it).

## Deploy

Pushing to `main` triggers a GitHub Actions build that publishes to GitHub
Pages.
