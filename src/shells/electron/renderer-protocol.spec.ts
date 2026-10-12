import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../content-security-policy";
import { isRendererPage, resolveAsset } from "./renderer-protocol";

const root = path.resolve("dist/client/browser");

describe("resolveAsset", () => {
  it("maps renderer URLs into the client folder", () => {
    expect(resolveAsset(root, "genbeya://app/index.html")).toBe(path.join(root, "index.html"));
    expect(resolveAsset(root, "genbeya://app/")).toBe(path.join(root, "index.html"));
    expect(resolveAsset(root, "genbeya://app/chunk-A1.js")).toBe(path.join(root, "chunk-A1.js"));
  });

  it.each([
    "genbeya://other/index.html",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1",
    "genbeya://open/index.html",
    "https://app/index.html",
    "genbeya://app/%2e%2e%2fsecret",
    "genbeya://app/..%2f..%2fsecret",
    "genbeya://app/%5csecret",
    "genbeya://app/%00",
  ])("refuses %s", (url) => {
    expect(() => resolveAsset(root, url)).toThrow();
  });
});

describe("isRendererPage", () => {
  it("accepts only the bundled page, or the dev server in development", () => {
    expect(isRendererPage("genbeya://app/index.html", null)).toBe(true);
    expect(isRendererPage("genbeya://app/other.html", null)).toBe(false);
    expect(isRendererPage("https://evil.example/index.html", null)).toBe(false);
    expect(isRendererPage("http://127.0.0.1:5173/wiki", "http://127.0.0.1:5173")).toBe(true);
    expect(isRendererPage("not a url", null)).toBe(false);
  });
});

it("allows WebAssembly but no inline or remote scripts", () => {
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
});
