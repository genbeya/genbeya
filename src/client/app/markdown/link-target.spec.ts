import { resolveHref } from "./link-target";
import { toggleCheckboxAt } from "./task-checkbox";

describe("resolveHref", () => {
  it("resolves files relative to the document, never above the repository", () => {
    expect(resolveHref("docs/Guide/Wiki.md", "Tasks.md")).toEqual({ kind: "file", path: "docs/Guide/Tasks.md", anchor: undefined });
    expect(resolveHref("docs/Guide/Wiki.md", "../Home.md#start-here")).toEqual({
      kind: "file",
      path: "docs/Home.md",
      anchor: "start-here",
    });
    expect(resolveHref("docs/Home.md", "/src/main.ts")).toEqual({ kind: "file", path: "src/main.ts", anchor: undefined });
    expect(resolveHref("docs/Home.md", "../../../etc/passwd")).toEqual({ kind: "file", path: "etc/passwd", anchor: undefined });
    expect(resolveHref("docs/Home.md", "My%20Page.md")).toEqual({ kind: "file", path: "docs/My Page.md", anchor: undefined });
  });

  it("recognises external links, anchors, missing pages and people", () => {
    expect(resolveHref("docs/Home.md", "https://example.com")).toEqual({ kind: "external", url: "https://example.com" });
    expect(resolveHref("docs/Home.md", "#top")).toEqual({ kind: "anchor", id: "top" });
    expect(resolveHref("docs/Home.md", "gitdesk-missing:New%20Page")).toEqual({ kind: "missing", title: "New Page" });
    expect(resolveHref("docs/Home.md", "gitdesk-person:ada")).toEqual({ kind: "person", handle: "ada" });
  });

  it("keeps malformed escapes", () => {
    expect(resolveHref("a.md", "%E0%A4%A.md")).toEqual({ kind: "file", path: "%E0%A4%A.md", anchor: undefined });
  });
});

describe("toggleCheckboxAt", () => {
  it("flips the checkbox at or after an offset", () => {
    const body = "- [ ] one\n- [x] two\n";
    expect(toggleCheckboxAt(body, 0)).toBe("- [x] one\n- [x] two\n");
    expect(toggleCheckboxAt(body, body.indexOf("- [x]"))).toBe("- [ ] one\n- [ ] two\n");
    expect(toggleCheckboxAt("plain", 0)).toBe("plain");
  });
});
