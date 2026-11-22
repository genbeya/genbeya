/**
 * The in-memory repository keeps files as strings: text as itself, and
 * anything that is not UTF-8, such as images, as its bytes behind a marker,
 * so binary files come back byte for byte. The marker holds a NUL, so
 * binary files read as binary wherever the demo looks for one.
 */
import { encodeText, fromByteString, toByteString } from "../../utilities/bytes";

const BINARY = "\0binary\0";

/** The string the repository keeps for a file's bytes. */
export function fileContent(data: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    // Text that starts like the marker is kept as bytes, so it can't be mistaken for it.
    if (!text.startsWith(BINARY)) return text;
  } catch {
    // Not UTF-8: kept as bytes.
  }
  return BINARY + toByteString(data);
}

/** The bytes of a file the repository keeps as `content`. */
export const fileBytes = (content: string): Uint8Array =>
  content.startsWith(BINARY) ? fromByteString(content.slice(BINARY.length)) : encodeText(content);
