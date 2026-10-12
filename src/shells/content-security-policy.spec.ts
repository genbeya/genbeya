import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "./content-security-policy";

describe("the content security policy", () => {
  it("is the web demo's too, except for what only a header can say", () => {
    const page = readFileSync("src/client/index.demo.html", "utf8");
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(page)?.[1];
    const headerOnly = (directive: string) => directive.startsWith("frame-ancestors");
    expect(meta).toBe(
      CONTENT_SECURITY_POLICY.split("; ")
        .filter((directive) => !headerOnly(directive))
        .join("; "),
    );
  });
});
