import type { Person } from "../../../contracts/model";
import { avatarHue } from "../ui/avatar";
import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

const people: Person[] = [
  { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: ["countess"], commits: 3 },
  { handle: "bob", name: "Bob", email: null, aliases: [], commits: 0 },
];

function render(markdown: string, withPeople: readonly Person[] = people) {
  const { fragment } = renderMarkdownTree(parseMarkdown(markdown, { people: withPeople }), document, {
    path: "docs/Page.md",
    interactiveCheckboxes: false,
  });
  const container = document.createElement("div");
  container.append(fragment);
  return container;
}

const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLAnchorElement>("a.md-mention")];

describe("mentions", () => {
  it("show known handles as the person's name with their initials, and say who it is", () => {
    const container = render("Ask @ada or @Bob, and @countess.");
    expect(chips(container).map((chip) => chip.getAttribute("href"))).toEqual([
      "gitdesk-person:ada",
      "gitdesk-person:bob",
      "gitdesk-person:ada",
    ]);
    const [ada] = chips(container);
    expect(ada!.textContent).toBe("ALAda Lovelace");
    expect(ada!.querySelector(".md-mention-avatar")!.className).toBe(`md-mention-avatar avatar-hue-${avatarHue("Ada Lovelace")}`);
    expect(ada!.getAttribute("title")).toBe("Ada Lovelace <ada@example.com>");
    expect(ada!.getAttribute("aria-label")).toBe("Ada Lovelace (@ada)");
    expect(container.textContent).toContain("Ask ");
  });

  it("leave unknown handles, emails, code, links and words with @ as written", () => {
    const container = render(
      "@carol wrote ada@example.com, `@ada`, [@ada](https://example.com), https://example.com/@ada and me@ada.\n\n```\n@ada\n```\n",
    );
    expect(chips(container)).toEqual([]);
    expect(container.textContent).toContain("@carol wrote");
  });

  it("are plain text without people", () => {
    expect(chips(render("@ada", []))).toEqual([]);
  });

  it("work in headings, emphasis and tables", () => {
    expect(chips(render("# For @ada\n\n*@bob*\n\n| Who |\n| --- |\n| @ada |\n"))).toHaveLength(3);
  });
});
