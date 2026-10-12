import { describe, expect, it } from "vitest";
import type { GenbeyaLink } from "../contracts/genbeya-link";
import { describeLinkItem, formatGenbeyaLink, parseGenbeyaLink } from "./genbeya-link";

const remote = "https://github.com/acme/demo.git";
const hash = "0123456789abcdef0123456789abcdef01234567";

describe("Genbeya links", () => {
  it.each<[GenbeyaLink, string]>([
    [{ remote, item: { kind: "task", id: "DP-1" } }, "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1"],
    [
      { remote, item: { kind: "page", path: "docs/Guide.md" } },
      "genbeya://open?remote=https://github.com/acme/demo.git&page=docs/Guide.md",
    ],
    [
      { remote: "git@github.com:acme/demo.git", item: { kind: "commit", hash } },
      `genbeya://open?remote=git@github.com:acme/demo.git&commit=${hash}`,
    ],
    [
      { remote, item: { kind: "file", path: "src/a b&c=d#e?f+g%h.ts" } },
      "genbeya://open?remote=https://github.com/acme/demo.git&file=src/a%20b%26c%3Dd%23e%3Ff%2Bg%25h.ts",
    ],
  ])("formats and parses %j", (link, text) => {
    expect(formatGenbeyaLink(link)).toBe(text);
    expect(parseGenbeyaLink(text)).toEqual(link);
  });

  it("never shares credentials stored in a remote URL", () => {
    const text = formatGenbeyaLink({ remote: "https://me:secret@github.com/acme/demo.git", item: { kind: "task", id: "DP-1" } });
    expect(text).toBe("genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1");
  });

  it("accepts the forms operating systems and people hand over", () => {
    const expected = { remote, item: { kind: "task", id: "DP-1" } };
    expect(parseGenbeyaLink("  Genbeya://Open?remote=https%3A%2F%2Fgithub.com%2Facme%2Fdemo.git&task=DP-1\n")).toEqual(expected);
    expect(parseGenbeyaLink("genbeya://open/?task=DP-1&remote=https://github.com/acme/demo.git")).toEqual(expected);
    expect(parseGenbeyaLink(`genbeya://open?remote=${remote}&commit=${hash.toUpperCase()}`)).toEqual({
      remote,
      item: { kind: "commit", hash },
    });
  });

  it.each([
    42,
    null,
    "",
    "https://github.com/acme/demo",
    "genbeya://app/index.html",
    "genbeya://open",
    "genbeya://openx?remote=https://github.com/acme/demo.git&task=DP-1",
    "genbeya://open?task=DP-1",
    "genbeya://open?remote=https://github.com/acme/demo.git",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1&page=docs/Home.md",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1&task=DP-2",
    "genbeya://open?remote=https://github.com/acme/demo.git&remote=https://github.com/acme/demo.git&task=DP-1",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1&run=calc.exe",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP-1#x",
    "genbeya://open?remote=https://github.com/acme/demo.git&task",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=%E0%A4%A",
    "genbeya://open?remote=/srv/git/demo.git&task=DP-1",
    "genbeya://open?remote=file:///srv/git/demo.git&task=DP-1",
    "genbeya://open?remote=-uevil&task=DP-1",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=../DP-1",
    "genbeya://open?remote=https://github.com/acme/demo.git&task=DP 1",
    "genbeya://open?remote=https://github.com/acme/demo.git&page=../secret.md",
    "genbeya://open?remote=https://github.com/acme/demo.git&page=docs/Home.txt",
    "genbeya://open?remote=https://github.com/acme/demo.git&file=/etc/passwd",
    "genbeya://open?remote=https://github.com/acme/demo.git&file=.git/config",
    "genbeya://open?remote=https://github.com/acme/demo.git&file=C:/Windows/win.ini",
    "genbeya://open?remote=https://github.com/acme/demo.git&commit=HEAD~1",
    "genbeya://open?remote=https://github.com/acme/demo.git&commit=abc",
    `genbeya://open?remote=https://github.com/acme/demo.git&file=${"a/".repeat(2100)}a`,
  ])("refuses %j", (text) => {
    expect(parseGenbeyaLink(text)).toBeNull();
  });

  it("describes items for people", () => {
    expect(describeLinkItem({ kind: "task", id: "DP-1" })).toBe("task DP-1");
    expect(describeLinkItem({ kind: "page", path: "docs/Guide.md" })).toBe("page docs/Guide.md");
    expect(describeLinkItem({ kind: "file", path: "src/index.ts" })).toBe("file src/index.ts");
    expect(describeLinkItem({ kind: "commit", hash })).toBe("commit 01234567");
  });
});
