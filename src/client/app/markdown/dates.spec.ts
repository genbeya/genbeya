import { formatDate } from "../ui/calendar-date";
import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

/** A Sunday. */
const TODAY = "2026-10-11";

function render(markdown: string) {
  const { fragment } = renderMarkdownTree(parseMarkdown(markdown, { today: TODAY }), document, {
    path: "docs/Page.md",
    interactiveCheckboxes: false,
  });
  const container = document.createElement("div");
  container.append(fragment);
  return container;
}

const dates = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".md-date")].map((chip) => [chip.textContent, chip.className, chip.getAttribute("title")]);

describe("dates", () => {
  it("show ISO dates in the user's language, with how far away they are", () => {
    expect(dates(render("Ship on 2026-10-14, started 2026-09-27."))).toEqual([
      [formatDate("2026-10-14"), "md-date", expect.stringMatching(/^in 3 days/)],
      [formatDate("2026-09-27"), "md-date", expect.stringMatching(/^2 weeks ago/)],
    ]);
  });

  it("tone open checklist items that are overdue or due soon, but not done ones", () => {
    const container = render(
      "- [ ] Late 2026-10-10\n- [ ] Soon 2026-10-13\n- [ ] Later 2026-10-20\n- [x] Done 2026-10-01\n- Plain 2026-10-01\n",
    );
    expect(dates(container).map(([, className, title]) => [className, title])).toEqual([
      ["md-date is-overdue", expect.stringMatching(/yesterday · overdue$/)],
      ["md-date is-soon", expect.stringMatching(/in 2 days · due soon$/)],
      ["md-date", expect.stringMatching(/next week$/)],
      ["md-date", expect.stringMatching(/last week$/)],
      ["md-date", expect.stringMatching(/last week$/)],
    ]);
  });

  it("leave invalid dates, code, links, paths and timestamps as written", () => {
    const container = render(
      "2026-02-30, `2026-10-11`, [2026-10-11](https://example.com), notes/2026-10-11.md, 2026-10-11T10:00, 12026-10-11, 2026-10-111.\n\n```\n2026-10-11\n```\n",
    );
    expect(dates(container)).toEqual([]);
  });

  it("leave nested lists of other items untoned", () => {
    const container = render("- [ ] Parent\n  - Note 2026-10-01\n");
    expect(dates(container).map(([, className]) => className)).toEqual(["md-date"]);
  });
});
