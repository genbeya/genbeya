# Genbeya's logo

The logo is an obeya, the project room, seen from its corner: a wiki page on the left wall, a Git branch on the back wall, the task list on the right wall and the team on the floor.

| File                                     | Use it for                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`genbeya.svg`](genbeya.svg)             | The logo, above 48 pixels: app icons, the README, slides                                                                            |
| [`genbeya-small.svg`](genbeya-small.svg) | Up to 48 pixels: favicons, small app icons, marks in the app. Bolder, with wider gaps and no people                                 |
| [`genbeya-mono.svg`](genbeya-mono.svg)   | One colour, with the details cut out: on brand-coloured surfaces, in print, as a stamp. Fills with `currentColor` (navy by default) |

All three are 512 × 512 with a transparent background. `npm run icons` renders the app icons and the favicon from them (see [Development](../docs/Development.md)).

## Colours

| Name   | Hex       | Where               |
| ------ | --------- | ------------------- |
| Navy   | `#22313d` | Side walls          |
| Purple | `#7c7ff2` | Back wall, floor    |
| White  | `#ffffff` | Pages, branch, team |

## Rules

- Use the small mark up to 48 pixels and the full logo above.
- Keep clear space around the logo of at least a quarter of its width, free of text and other graphics.
- Don't recolour, outline, stretch or rotate it, and don't add drop shadows. Only the mono version changes colour: set `color` (or `fill`) to one colour that contrasts with the background, such as white on purple.
- On dark backgrounds, give the colour logo a soft halo so its navy walls stand out: a hairline of white at about 45% opacity plus a 10 px glow in the purple at about 50% (about 22% on light backgrounds). The app's start screen and the website do this.
- Put the full-colour logos on white, light grey or dark backgrounds; on purple or busy backgrounds use the mono version.
