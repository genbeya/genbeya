import { describe, expect, it } from "vitest";
import { resolveClientFile } from "./static-files";

const root = new URL("file:///app/client/browser/");

describe("resolveClientFile", () => {
  it("serves files of the client and the page by default", () => {
    expect(resolveClientFile(root, "/")?.href).toBe("file:///app/client/browser/index.html");
    expect(resolveClientFile(root, "/chunk-1.js")?.href).toBe("file:///app/client/browser/chunk-1.js");
    expect(resolveClientFile(root, "/media/inter%20latin.woff2")?.href).toBe("file:///app/client/browser/media/inter%20latin.woff2");
  });

  it.each(["/../secret", "/%2e%2e/secret", "/a/../../b", "/%5csecret", "/%00", "/C:/x", "/%E0%A4%A"])("refuses %s", (pathname) => {
    expect(resolveClientFile(root, pathname)).toBeNull();
  });
});
