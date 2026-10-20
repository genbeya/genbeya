---
id: GENBEYA-36
title: Click preview for images and diagrams
type: feature
status: backlog
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
