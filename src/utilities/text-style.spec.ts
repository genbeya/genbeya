import { describe, expect, it } from "vitest";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "./text-style";

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

describe("text style", () => {
  it("detects the byte order mark and the first line ending", () => {
    expect(textStyleOf("a\nb")).toEqual(LF_STYLE);
    expect(textStyleOf(`${BOM}a${CRLF}b\n`)).toEqual({ bom: true, eol: CRLF });
    expect(textStyleOf("")).toEqual(LF_STYLE);
  });

  it("rewrites text in a style, whatever line endings it had", () => {
    expect(applyTextStyle(`a\nb${CRLF}c`, { bom: true, eol: CRLF })).toBe(`${BOM}a${CRLF}b${CRLF}c`);
    expect(applyTextStyle(`${BOM}a${CRLF}b\n`, LF_STYLE)).toBe("a\nb\n");
  });

  it("strips a byte order mark", () => {
    expect(withoutByteOrderMark(`${BOM}a`)).toBe("a");
    expect(withoutByteOrderMark("a")).toBe("a");
  });
});
