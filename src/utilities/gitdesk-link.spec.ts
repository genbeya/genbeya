import { describe, expect, it } from "vitest";
import type { GitdeskLink } from "../contracts/gitdesk-link";
import { describeLinkItem, formatGitdeskLink, parseGitdeskLink } from "./gitdesk-link";

const remote = "https://github.com/acme/demo.git";
const hash = "0123456789abcdef0123456789abcdef01234567";

describe("GitDesk links", () => {
  it.each<[GitdeskLink, string]>([
    [{ remote, item: { kind: "task", id: "DP-1" } }, "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1"],
    [
      { remote, item: { kind: "page", path: "docs/Guide.md" } },
      "gitdesk://open?remote=https://github.com/acme/demo.git&page=docs/Guide.md",
    ],
    [
      { remote: "git@github.com:acme/demo.git", item: { kind: "commit", hash } },
      `gitdesk://open?remote=git@github.com:acme/demo.git&commit=${hash}`,
    ],
    [
      { remote, item: { kind: "file", path: "src/a b&c=d#e?f+g%h.ts" } },
      "gitdesk://open?remote=https://github.com/acme/demo.git&file=src/a%20b%26c%3Dd%23e%3Ff%2Bg%25h.ts",
    ],
  ])("formats and parses %j", (link, text) => {
    expect(formatGitdeskLink(link)).toBe(text);
    expect(parseGitdeskLink(text)).toEqual(link);
  });

  it("never shares credentials stored in a remote URL", () => {
    const text = formatGitdeskLink({ remote: "https://me:secret@github.com/acme/demo.git", item: { kind: "task", id: "DP-1" } });
    expect(text).toBe("gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1");
  });

  it("accepts the forms operating systems and people hand over", () => {
    const expected = { remote, item: { kind: "task", id: "DP-1" } };
    expect(parseGitdeskLink("  GitDesk://Open?remote=https%3A%2F%2Fgithub.com%2Facme%2Fdemo.git&task=DP-1\n")).toEqual(expected);
    expect(parseGitdeskLink("gitdesk://open/?task=DP-1&remote=https://github.com/acme/demo.git")).toEqual(expected);
    expect(parseGitdeskLink(`gitdesk://open?remote=${remote}&commit=${hash.toUpperCase()}`)).toEqual({
      remote,
      item: { kind: "commit", hash },
    });
  });

  it.each([
    42,
    null,
    "",
    "https://github.com/acme/demo",
    "gitdesk://app/index.html",
    "gitdesk://open",
    "gitdesk://openx?remote=https://github.com/acme/demo.git&task=DP-1",
    "gitdesk://open?task=DP-1",
    "gitdesk://open?remote=https://github.com/acme/demo.git",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1&page=docs/Home.md",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1&task=DP-2",
    "gitdesk://open?remote=https://github.com/acme/demo.git&remote=https://github.com/acme/demo.git&task=DP-1",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1&run=calc.exe",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1#x",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=%E0%A4%A",
    "gitdesk://open?remote=/srv/git/demo.git&task=DP-1",
    "gitdesk://open?remote=file:///srv/git/demo.git&task=DP-1",
    "gitdesk://open?remote=-uevil&task=DP-1",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=../DP-1",
    "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP 1",
    "gitdesk://open?remote=https://github.com/acme/demo.git&page=../secret.md",
    "gitdesk://open?remote=https://github.com/acme/demo.git&page=docs/Home.txt",
    "gitdesk://open?remote=https://github.com/acme/demo.git&file=/etc/passwd",
    "gitdesk://open?remote=https://github.com/acme/demo.git&file=.git/config",
    "gitdesk://open?remote=https://github.com/acme/demo.git&file=C:/Windows/win.ini",
    "gitdesk://open?remote=https://github.com/acme/demo.git&commit=HEAD~1",
    "gitdesk://open?remote=https://github.com/acme/demo.git&commit=abc",
    `gitdesk://open?remote=https://github.com/acme/demo.git&file=${"a/".repeat(2100)}a`,
  ])("refuses %j", (text) => {
    expect(parseGitdeskLink(text)).toBeNull();
  });

  it("describes items for people", () => {
    expect(describeLinkItem({ kind: "task", id: "DP-1" })).toBe("task DP-1");
    expect(describeLinkItem({ kind: "page", path: "docs/Guide.md" })).toBe("page docs/Guide.md");
    expect(describeLinkItem({ kind: "file", path: "src/index.ts" })).toBe("file src/index.ts");
    expect(describeLinkItem({ kind: "commit", hash })).toBe("commit 01234567");
  });
});
