/** Sizes of files and images as the previews show them. */

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

const UNITS = ["KB", "MB", "GB"];

/** A size in bytes as people read it: 512 B, 1.2 KB, 34 KB, 3.4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

/** How many bytes a base64 data URL holds. */
export function dataUrlBytes(url: string): number {
  const data = url.slice(url.indexOf(",") + 1);
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/** An image's pixel size, once known, and its file size: "96 × 96 px · 1.2 KB". */
export function imageFacts(pixels: PixelSize | null, bytes: number): string {
  return [pixels ? `${pixels.width} × ${pixels.height} px` : null, formatBytes(bytes)].filter((fact) => fact !== null).join(" · ");
}
