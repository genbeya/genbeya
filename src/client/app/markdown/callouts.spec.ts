import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

function render(markdown: string) {
  const container = document.createElement("div");
  container.append(renderMarkdownTree(parseMarkdown(markdown), document, { path: "docs/A.md", interactiveCheckboxes: false }).fragment);
  return container;
}

describe("callouts", () => {
  it("titles GitHub alerts with their kind", () => {
    const callout = render("> [!NOTE]\n> Useful information.").querySelector("blockquote.callout.callout-note")!;
    expect(callout.getAttribute("data-callout")).toBe("note");
    expect(callout.querySelector(".callout-title.is-default")?.textContent).toBe("Note");
    expect(callout.querySelector("p:not(.callout-title)")?.textContent).toBe("Useful information.");
    expect(callout.textContent).not.toContain("[!NOTE]");
  });

  it("takes a custom title from the rest of the first line, with its formatting", () => {
    const callout = render("> [!WARNING] Mind **the** gap\n> Body text.").querySelector(".callout")!;
    const title = callout.querySelector(".callout-title")!;
    expect([title.textContent, title.classList.contains("is-default"), title.querySelector("strong")?.textContent]).toEqual([
      "Mind the gap",
      false,
      "the",
    ]);
    expect(callout.querySelector("p:not(.callout-title)")?.textContent).toBe("Body text.");
  });

  it("folds with - and opens with +", () => {
    const container = render("> [!TIP]- Folded\n> Hidden.\n\n> [!tip]+\n> Shown.");
    const [folded, open] = [...container.querySelectorAll("details.callout")];
    expect(folded?.hasAttribute("open")).toBe(false);
    expect(folded?.querySelector("summary.callout-title")?.textContent).toBe("Folded");
    expect(open?.hasAttribute("open")).toBe(true);
    expect(open?.querySelector("summary")?.textContent).toBe("Tip");
    expect(open?.textContent).toContain("Shown.");
  });

  it("shows Obsidian's other kinds in the closest alert's style", () => {
    const container = render("> [!bug]\n> x\n\n> [!example]\n> y\n\n> [!success]\n> z");
    expect(
      [...container.querySelectorAll(".callout")].map((callout) => [
        callout.className,
        callout.querySelector(".callout-title")?.textContent,
      ]),
    ).toEqual([
      ["callout callout-caution", "Bug"],
      ["callout callout-important", "Example"],
      ["callout callout-tip", "Success"],
    ]);
  });

  it("leaves unknown kinds and plain quotes alone", () => {
    const container = render("> [!SHOUT]\n> x\n\n> Just a quote");
    expect(container.querySelector(".callout")).toBeNull();
    expect(container.textContent).toContain("[!SHOUT]");
  });
});
