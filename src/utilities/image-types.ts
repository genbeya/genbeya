/** The images Genbeya shows, by file extension: in pages, in **Code** and in diffs. */
import { toBase64 } from "./bytes";

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/** The media type of an image file, or null for files that are no image Genbeya shows. */
export function imageType(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (IMAGE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/** An image's bytes as a data URL of its media type. */
export const imageUrl = (type: string, data: Uint8Array): string => `data:${type};base64,${toBase64(data)}`;
