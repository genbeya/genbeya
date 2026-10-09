import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, isRendererPage, resolveAsset } from "./renderer-protocol";

const root = path.resolve("dist/client/browser");

describe("resolveAsset", () => {
  it("maps renderer URLs into the client folder", () => {
    expect(resolveAsset(root, "gitdesk://app/index.html")).toBe(path.join(root, "index.html"));
    expect(resolveAsset(root, "gitdesk://app/")).toBe(path.join(root, "index.html"));
    expect(resolveAsset(root, "gitdesk://app/chunk-A1.js")).toBe(path.join(root, "chunk-A1.js"));
  });

  it.each(["gitdesk://other/index.html", "https://app/index.html", "gitdesk://app/%2e%2e%2fsecret", "gitdesk://app/..%2f..%2fsecret", "gitdesk://app/%5csecret", "gitdesk://app/%00"])(
    "refuses %s",
    (url) => {
      expect(() => resolveAsset(root, url)).toThrow();
    },
  );
});

describe("isRendererPage", () => {
  it("accepts only the bundled page, or the dev server in development", () => {
    expect(isRendererPage("gitdesk://app/index.html", null)).toBe(true);
    expect(isRendererPage("gitdesk://app/other.html", null)).toBe(false);
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
