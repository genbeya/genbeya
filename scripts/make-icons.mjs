// electron scripts/make-icons.mjs (npm run icons): renders the app icons from the logo in
// branding/ — Electron's build/icon.{png,ico,icns}, the Tauri shell's icons (which Deno
// Desktop uses too) and the client's favicon. Electron's Chromium rasterises the SVGs;
// the ICO and ICNS containers are written here.
import { app, BrowserWindow } from "electron";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const LOGO = readFileSync("branding/genbeya.svg", "utf8");
const MARK = readFileSync("branding/genbeya-small.svg", "utf8");
const TAURI = "src/shells/tauri/src-tauri/icons";
// Apple's grid keeps the art within 824 of 1024 pixels; the logo's own margin is 7%.
const MAC_SCALE = 0.9;

let window;
// The ready event waits for this module, so awaiting it at the top level would never return.
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false });
    await window.loadURL("about:blank");
    const ico = await icoFile([16, 24, 32, 48, 64, 128, 256]);
    // ic11 is 16@2x and ic12 32@2x, so only the 16 and 32 pixel images get the small mark.
    const icns = await icnsFile([
      ["icp4", 16, true],
      ["icp5", 32, true],
      ["ic11", 32, true],
      ["ic12", 64, false],
      ["ic07", 128, false],
      ["ic13", 256, false],
      ["ic08", 256, false],
      ["ic14", 512, false],
      ["ic09", 512, false],
      ["ic10", 1024, false],
    ]);
    const files = {
      "build/icon.png": await png(1024),
      "build/icon.ico": ico,
      "build/icon.icns": icns,
      [`${TAURI}/32x32.png`]: await png(32),
      [`${TAURI}/128x128.png`]: await png(128),
      [`${TAURI}/128x128@2x.png`]: await png(256),
      [`${TAURI}/icon.png`]: await png(512),
      [`${TAURI}/icon.ico`]: ico,
      [`${TAURI}/icon.icns`]: icns,
      "src/client/public/icon.png": await png(48),
    };
    for (const [file, data] of Object.entries(files)) {
      writeFileSync(file, data);
      console.log(file);
    }
    copyFileSync("branding/genbeya-small.svg", "src/client/public/icon.svg");
    console.log("src/client/public/icon.svg");
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});

/** A `size`² PNG of the logo, or of the small mark up to 48 pixels, drawn at `scale` of the canvas. */
async function png(size, { scale = 1, small = size <= 48 } = {}) {
  const drawn = Math.round(size * scale);
  // Sizing the SVG itself makes Chromium rasterise the vectors at that size instead of scaling pixels.
  const svg = (small ? MARK : LOGO).replace('width="512" height="512"', `width="${drawn}" height="${drawn}"`);
  const url = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/svg+xml," + encodeURIComponent(${JSON.stringify(svg)});
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    canvas.getContext("2d").drawImage(image, ${(size - drawn) / 2}, ${(size - drawn) / 2});
    return canvas.toDataURL("image/png");
  })()`);
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

/** A Windows icon of PNG images: a header, a directory entry per image (256 is stored as 0), then the images. */
async function icoFile(sizes) {
  const images = await Promise.all(sizes.map(png));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

/** A macOS icon of PNG images, each typed and sized by a big-endian header, inset to Apple's grid. */
async function icnsFile(types) {
  const entries = await Promise.all(
    types.map(async ([type, size, small]) => {
      const image = await png(size, { scale: MAC_SCALE, small });
      const header = Buffer.alloc(8);
      header.write(type, 0, "ascii");
      header.writeUInt32BE(8 + image.length, 4);
      return Buffer.concat([header, image]);
    }),
  );
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}
