---
title: Writing Devlog Posts
description: How to add a post to the Lumina devlog.
sidebar:
  order: 4
---

The [devlog](/blog/) is a separate content collection from the docs. Posts are dated and
stay as written, so they carry release notes, deep dives, and work in progress, while the
manual carries whatever is currently true.

## Adding a post

Copy `src/content/blog/_template.md` to a new file in `src/content/blog/`. The file name
becomes the URL, so `visbuffer-rewrite.md` publishes at `/blog/visbuffer-rewrite/`. Files
beginning with an underscore are ignored.

```markdown
---
title: The Visibility Buffer Rewrite
description: Why the base pass moved to a visibility buffer, and what it means for materials.
date: 2026-08-19
authors: ['MrDrElliot']
tags: ['Rendering', 'Internals']
version: '0.4.0'
---

Post body in Markdown or MDX.
```

## Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Heading and page title. |
| `description` | yes | Shown on the index, in search, and in the RSS feed. |
| `date` | yes | `YYYY-MM-DD`. Sorting and the feed use it. |
| `authors` | no | List of names, defaults to empty. |
| `tags` | no | Each tag gets an archive page at `/blog/tags/<tag>/`. |
| `version` | no | Engine version badge, for release notes. |
| `draft` | no | `true` keeps the post out of production builds and the feed. |

Drafts render during `npm run dev` so you can preview them, and disappear from
`npm run build`.

## Conventions

Tags are the navigation, so reuse existing ones rather than inventing near-duplicates.
Headings inside a post build its table of contents. Every Starlight component available in
the docs works in a post, and `.mdx` is supported if you need imports.

Once something in a post becomes permanent knowledge, write it into the manual or the
internals pages and link to that page from the post.
