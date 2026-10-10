/**
 * The shapes of the icons task types and workflow states may use, copied
 * from Lucide (ISC license, https://lucide.dev) as plain data. The icon
 * components of @lucide/angular share one module, so using them here would
 * put each icon's compiled template into the bundle every window loads.
 * Add an icon with the static `icon` of its `Lucide…` component.
 */
import type { LucideIconData } from "@lucide/angular";

export const ICON_DATA: readonly LucideIconData[] = [
  {
    name: "bug",
    node: [
      ["path", { d: "M12 20v-9" }],
      ["path", { d: "M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" }],
      ["path", { d: "M14.12 3.88 16 2" }],
      ["path", { d: "M21 21a4 4 0 0 0-3.81-4" }],
      ["path", { d: "M21 5a4 4 0 0 1-3.55 3.97" }],
      ["path", { d: "M22 13h-4" }],
      ["path", { d: "M3 21a4 4 0 0 1 3.81-4" }],
      ["path", { d: "M3 5a4 4 0 0 0 3.55 3.97" }],
      ["path", { d: "M6 13H2" }],
      ["path", { d: "m8 2 1.88 1.88" }],
      ["path", { d: "M9 7.13V6a3 3 0 1 1 6 0v1.13" }],
    ],
  },
  {
    name: "sparkles",
    node: [
      [
        "path",
        {
          d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
        },
      ],
      ["path", { d: "M20 2v4" }],
      ["path", { d: "M22 4h-4" }],
      ["circle", { cx: "4", cy: "20", r: "2" }],
    ],
  },
  {
    name: "trending-up",
    node: [
      ["path", { d: "M16 7h6v6" }],
      ["path", { d: "m22 7-8.5 8.5-5-5L2 17" }],
    ],
  },
  {
    name: "wrench",
    node: [
      [
        "path",
        {
          d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
        },
      ],
    ],
  },
  {
    name: "square-check",
    node: [
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "m16 9-5.5 5.5L8 12" }],
    ],
  },
  {
    name: "book-open",
    node: [
      ["path", { d: "M12 5v16" }],
      [
        "path",
        {
          d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z",
        },
      ],
    ],
  },
  {
    name: "file-text",
    node: [
      ["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
      ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
      ["path", { d: "M10 9H8" }],
      ["path", { d: "M16 13H8" }],
      ["path", { d: "M16 17H8" }],
    ],
  },
  {
    name: "circle-question-mark",
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
      ["path", { d: "M12 17h.01" }],
    ],
  },
  {
    name: "flask-conical",
    node: [
      ["path", { d: "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" }],
      ["path", { d: "M6.453 15h11.094" }],
      ["path", { d: "M8.5 2h7" }],
    ],
  },
  {
    name: "lightbulb",
    node: [
      ["path", { d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" }],
      ["path", { d: "M9 18h6" }],
      ["path", { d: "M10 22h4" }],
    ],
  },
  {
    name: "shield",
    node: [
      [
        "path",
        {
          d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
        },
      ],
    ],
  },
  {
    name: "zap",
    node: [
      [
        "path",
        {
          d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
        },
      ],
    ],
  },
  {
    name: "palette",
    node: [
      ["path", { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
      ["circle", { cx: "13.5", cy: "6.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "17.5", cy: "10.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "6.5", cy: "12.5", r: ".5", fill: "currentColor" }],
      ["circle", { cx: "8.5", cy: "7.5", r: ".5", fill: "currentColor" }],
    ],
  },
  {
    name: "gauge",
    node: [
      ["path", { d: "m12 14 4-4" }],
      ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }],
    ],
  },
  {
    name: "rocket",
    node: [
      ["path", { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
      ["path", { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" }],
      ["path", { d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" }],
      ["path", { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
    ],
  },
  {
    name: "circle-dot",
    node: [
      ["circle", { cx: "12", cy: "12", r: "1" }],
      ["circle", { cx: "12", cy: "12", r: "10" }],
    ],
  },
  { name: "circle", node: [["circle", { cx: "12", cy: "12", r: "10" }]] },
  {
    name: "circle-dashed",
    node: [
      ["path", { d: "M10.1 2.182a10 10 0 0 1 3.8 0" }],
      ["path", { d: "M13.9 21.818a10 10 0 0 1-3.8 0" }],
      ["path", { d: "M17.609 3.721a10 10 0 0 1 2.69 2.7" }],
      ["path", { d: "M2.182 13.9a10 10 0 0 1 0-3.8" }],
      ["path", { d: "M20.279 17.609a10 10 0 0 1-2.7 2.69" }],
      ["path", { d: "M21.818 10.1a10 10 0 0 1 0 3.8" }],
      ["path", { d: "M3.721 6.391a10 10 0 0 1 2.7-2.69" }],
      ["path", { d: "M6.391 20.279a10 10 0 0 1-2.69-2.7" }],
    ],
  },
  {
    name: "circle-check",
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "m16 9-5.5 5.5L8 12" }],
    ],
  },
  {
    name: "circle-x",
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "m15 9-6 6" }],
      ["path", { d: "m9 9 6 6" }],
    ],
  },
  {
    name: "clock",
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M12 6v6l4 2" }],
    ],
  },
  {
    name: "eye",
    node: [
      ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
      ["circle", { cx: "12", cy: "12", r: "3" }],
    ],
  },
  { name: "play", node: [["path", { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]] },
  {
    name: "pause",
    node: [
      ["rect", { x: "14", y: "3", width: "5", height: "18", rx: "1" }],
      ["rect", { x: "5", y: "3", width: "5", height: "18", rx: "1" }],
    ],
  },
  {
    name: "ban",
    node: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M4.929 4.929 19.07 19.071" }],
    ],
  },
  {
    name: "archive",
    node: [
      ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1" }],
      ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
      ["path", { d: "M10 12h4" }],
    ],
  },
  {
    name: "inbox",
    node: [
      ["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }],
      ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }],
    ],
  },
  {
    name: "flag",
    node: [
      [
        "path",
        {
          d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
        },
      ],
    ],
  },
];
