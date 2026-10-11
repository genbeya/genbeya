import { describe, expect, it } from "vitest";
import { concatBytes, decodeText, encodeText, fromByteString, isBinary, sha256, sha256Bytes, toBase64, toByteString } from "./bytes";

describe("text and bytes", () => {
  it("round-trips UTF-8", () => {
    expect(decodeText(encodeText("Ünïcode ✓"), "a.md")).toBe("Ünïcode ✓");
  });

  it("keeps a byte order mark", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), "a.md")).toBe("﻿a");
  });

  it("rejects binary and non-UTF-8 content with the file name", () => {
    expect(() => decodeText(new Uint8Array([0x61, 0, 0x62]), "x.bin")).toThrow("x.bin is a binary file.");
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x41]), "x.txt")).toThrow("x.txt is not UTF-8 text.");
  });

  it("detects binary data", () => {
    expect(isBinary(new Uint8Array([1, 2, 0]))).toBe(true);
    expect(isBinary(encodeText("plain"))).toBe(false);
  });

  it("keeps bytes of any encoding through byte strings", () => {
    const data = new Uint8Array([0x61, 0xe4, 0x0d, 0x0a, 0xff, 0x00]);
    expect(toByteString(data)).toBe("aä\r\nÿ\0");
    expect(fromByteString(toByteString(data))).toEqual(data);
    expect(toByteString(new Uint8Array(70_000).fill(65)).length).toBe(70_000);
  });

  it("hashes bytes", () => {
    expect(sha256Bytes(encodeText("hello"))).toBe(sha256("hello"));
  });

  it("encodes base64", () => {
    expect(toBase64(encodeText("hello"))).toBe("aGVsbG8=");
    expect(toBase64(new Uint8Array(0))).toBe("");
    expect(toBase64(new Uint8Array(70_000).fill(255)).length).toBe(93_336);
  });

  it("concatenates", () => {
    expect([...concatBytes([new Uint8Array([1]), new Uint8Array([2, 3])])]).toEqual([1, 2, 3]);
  });

  it("hashes text with SHA-256", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
