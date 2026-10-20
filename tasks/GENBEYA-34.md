---
id: GENBEYA-34
title: code- and changes-view of non text filetypes
type: improvement
status: review
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

### Claude — 2026-10-20 15:33+02:00

Done, in review:

- **Registry:** `src/client/app/features/preview/file-previews.ts` decides from a path which renderer shows a file (Markdown, Mermaid, PlantUML, SVG, raster images), whether it is text to edit, and how diffs compare it. `preview-kinds.ts` is gone. PDF, audio or video would each be another renderer there.
- **Code:** PNG, JPEG, GIF, WebP and AVIF open as a picture through `content.image`, with pixel and file size in the header and no Edit, Split or Save. SVG keeps its modes.
- **Changes, History and stashes:** images show before and after side by side, each with pixel and file size, or **Swipe** with a divider to drag (or move with the arrow keys). One new call, `versionControl.diffImages`, takes `diff`'s arguments and returns both sides as data URLs, up to 10 MB each, in the real and the demo managers. Other binary diffs name their sizes (`12 KB → 14 KB`); files over 2 MB say they are too large to compare.
- **Demo:** the in-memory repository now keeps binary files byte for byte, and the demo history has an icon that changes in a second commit.

Left open: SVG diffs stay text only (an image view for them would be a small addition), and there is no What's new item yet, since the release line isn't chosen.
