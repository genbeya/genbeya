---
id: GENBEYA-34
title: code- and changes-view of non text filetypes
type: improvement
status: backlog
priority: medium
labels:
  - integrations
---

certain filetypes are currently identified as binary but could be displayed very well (e.g. images).

### Claude — 2026-10-20 14:15+02:00

Confirmed:

- **Code:** opening an image fails with "… is a binary file", because the editor reads text only.
- **Changes:** the diff shows "Binary file" whenever either side contains a NUL byte (`isBinary` in `utilities/bytes.ts`).

Pages can already show repository images, through `content.image`: PNG, JPEG, GIF, WebP, SVG and AVIF as data URLs, with a size limit.

Plan:

1. **Code:** images open as a preview, reusing `content.image` and the preview area that SVG files already use. Raster images have no Edit or Split. The header shows the image's pixel size and file size.
2. **Changes and History:** an image diff shows the old and new versions side by side, each with its size, plus a **Swipe** view to compare them on top of each other. This needs one new call that reads an image from a revision or the index, as the existing diff reads text. Staging stays whole-file, as for any binary file.
3. Other binary files keep today's message, with the file size added.

To decide: images only for now, or also PDF (the browser's own viewer works in Electron; I'd need to check the Tauri webviews), audio and video? I'd start with images.

### Claude — 2026-10-20 14:41+02:00

Decided by Emanuel: every file type that makes sense gets its own preview over time, so this starts with an abstraction: a registry that maps file types to preview renderers.

- **Code** asks the registry which renderer a file has.
- **Changes and History** ask the same registry for a renderer's comparison view.
- Markdown, Mermaid, PlantUML, SVG and raster images move into it first, from today's `preview-kinds.ts`.
- PDF, audio and video can follow as renderers of their own.

The rest of the plan above stays the same.
