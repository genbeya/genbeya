/** Bytes and text without Node's Buffer, so the same code runs on Node, Deno and in a webview. */
import { sha256 as sha256Digest } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

export const encodeText = (text: string): Uint8Array => encoder.encode(text);

export const isBinary = (data: Uint8Array): boolean => data.includes(0);

/** Decodes UTF-8 strictly; binary or malformed files are reported by name. */
export function decodeText(data: Uint8Array, name: string): string {
  if (isBinary(data)) throw new Error(`${name} is a binary file.`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new Error(`${name} is not UTF-8 text.`);
  }
}

/** Decodes leniently, replacing malformed sequences; for diffs and process output. */
export const decodeLenient = (data: Uint8Array): string => new TextDecoder("utf-8").decode(data);

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function toBase64(data: Uint8Array): string {
  let binary = "";
  // Chunked, because String.fromCharCode takes a bounded argument list.
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Hex SHA-256 of a string's UTF-8 bytes; the version stamp of file contents. */
export const sha256 = (text: string): string => bytesToHex(sha256Digest(encodeText(text)));
