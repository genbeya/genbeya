import { describe, expect, it } from "vitest";
import { compareVersions, formatReleaseLine, parseVersion, releaseLine, type Version } from "./version";

const v = (text: string): Version => parseVersion(text)!;

describe("parseVersion", () => {
  it("reads full versions and release lines", () => {
    expect(parseVersion("0.3.17")).toEqual({ major: 0, minor: 3, patch: 17 });
    expect(parseVersion(" 1.12 ")).toEqual({ major: 1, minor: 12, patch: 0 });
  });

  it("rejects anything else", () => {
    for (const text of ["", "1", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-beta", "1..2", "-1.2.3", "1234567890.0.0"])
      expect(parseVersion(text)).toBeNull();
    expect(parseVersion(1.2)).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by major, minor and patch, numerically", () => {
    expect(compareVersions(v("0.10.0"), v("0.9.30"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.0.0"), v("0.99.99"))).toBeGreaterThan(0);
    expect(compareVersions(v("0.3.2"), v("0.3.10"))).toBeLessThan(0);
    expect(compareVersions(v("0.3"), v("0.3.0"))).toBe(0);
  });
});

describe("releaseLine", () => {
  it("drops the patch, so builds of one release compare equal", () => {
    expect(compareVersions(releaseLine(v("0.3.17")), releaseLine(v("0.3.2")))).toBe(0);
    expect(formatReleaseLine(v("0.3.17"))).toBe("0.3");
  });
});
