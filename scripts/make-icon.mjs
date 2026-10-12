// Renders build/icon.png (1024², the Genbeya branch mark) without image tools:
//   node scripts/make-icon.mjs && npx tauri icon build/icon.png -o desktop/tauri/src-tauri/icons
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const N = 1024;
const px = Buffer.alloc(N * N * 4);

const clamp = (v) => Math.max(0, Math.min(1, v));
// Signed distances in pixels; negative inside.
const roundedBox = (x, y, half, r) => {
  const qx = Math.abs(x) - half + r,
    qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segment = (x, y, ax, ay, bx, by) => {
  const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
};

const nodes = [
  [380, 300],
  [380, 724],
  [644, 400],
];
const stroke = 46;

for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const x = i + 0.5,
      y = j + 0.5;
    const tile = clamp(0.5 - roundedBox(x - N / 2, y - N / 2, 448, 200));
    // Accent gradient, top-left to bottom-right.
    const g = (x + y) / (2 * N);
    let r = 136 - 40 * g,
      gr = 140 - 44 * g,
      b = 250 - 18 * g;
    // Branch mark: trunk, a curve-free merge line, and three commits.
    let mark = Math.min(
      segment(x, y, 380, 300, 380, 724) - stroke / 2,
      segment(x, y, 644, 400, 644, 500) - stroke / 2,
      segment(x, y, 644, 500, 380, 640) - stroke / 2,
    );
    for (const [cx, cy] of nodes) mark = Math.min(mark, Math.hypot(x - cx, y - cy) - 70);
    const ring = Math.max(...nodes.map(([cx, cy]) => -(Math.hypot(x - cx, y - cy) - 30)));
    const white = clamp(0.5 - mark) * (1 - clamp(0.5 + ring));
    r += (255 - r) * white;
    gr += (255 - gr) * white;
    b += (255 - b) * white;
    const o = (j * N + i) * 4;
    px[o] = r;
    px[o + 1] = gr;
    px[o + 2] = b;
    px[o + 3] = 255 * tile;
  }

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let j = 0; j < N; j++) px.copy(raw, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4);
const header = Buffer.alloc(13);
header.writeUInt32BE(N, 0);
header.writeUInt32BE(N, 4);
header.set([8, 6, 0, 0, 0], 8);

mkdirSync("build", { recursive: true });
writeFileSync(
  "build/icon.png",
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log("build/icon.png");
