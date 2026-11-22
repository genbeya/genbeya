---
id: GENBEYA-36
title: Click preview for images and diagrams
type: feature
status: review
priority: medium
---

mermaid and plantuml diagrams as well as images can be very densely packed and hard to read at the default zoom level. A solution for this would be to allow user to click the image which would open them in a zoomable popup.

### Claude — 2026-10-20 14:15+02:00

Agreed; this would help most with large Mermaid and PlantUML diagrams. Pages render diagrams as `<img>` elements of an SVG (`markdown-view.ts`), and repository images too. So a single click handler in `markdown-view` covers the wiki, task descriptions, comments and the previews in **Code**.

Plan:

- **Opening:** clicking an image or diagram opens it in a popup over the window. It starts fitted to the window.
- **In the popup:**
  - zoom with the wheel or pinch, and with `+`, `-` and `0` (fit) or `1` (100 %)
  - drag to pan
  - `Esc` or a click on the backdrop closes it
  - an image from the repository also offers **Open in Code**
- **SVG diagrams** stay sharp at any zoom. Raster images are capped at 400 %.
- **Images inside a link:** the link still wins. A small zoom button appears on hover instead.

To decide: should the popup also show the diagram's source next to it, or only the picture?

Note: this task has no type or priority yet. I'd say feature, medium.

### Claude — 2026-10-20 14:41+02:00

Decided by Emanuel: the popup gets the same three-way switch as the previews in **Code**, Edit / Split / Preview, here as **Source**, **Split** and **Diagram**. It opens on **Diagram**. Images from the repository have no source, so their popup shows the picture only.

### Claude — 2026-10-20 15:51+02:00

Built (PR into `develop`, branch `feature/zoom-preview`): a click on an image or diagram in any rendered Markdown opens it in a popup over the window, fitted to it. The wheel, a pinch and `+`, `-`, `0`, `1` zoom around the pointer; dragging and the arrow keys move it; `Esc`, the close button or a click on the backdrop closes it. Diagrams are redrawn at every zoom, so they stay sharp; images stop at 400 %. Diagrams get **Source**, **Split** and **Diagram**, opening on **Diagram**, with the source read-only in the app's editor (search and copy work). Images in links keep following the link, with a zoom button on hover; every picture has that button for the keyboard. The popup is a labelled dialog that traps and restores the focus, and skips its animations for reduced motion.

Left out: **Open in Code** for repository images (from the first plan). An image of a wiki on the content branch is not the file in the checkout that **Code** would open, so it needs a decision first. A fitted picture is never enlarged beyond 100 %, so a small diagram opens at its own size.
