import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import { WikiPage } from "./wiki-page";

const CONTENT = "---\ntags: [demo]\n---\n# Home\n\nIntro.\n\n## Setup\n\nInstall the gadget.\n\n## Usage\n\nRun it.\n";

async function setup(inputs: { anchor?: string; line?: string }) {
  const harness = await openRepository();
  harness.managers.content.read.mockResolvedValue({ scope: "content", path: "docs/Home.md", content: CONTENT, hash: "h1" });
  const scrolled: string[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
    scrolled.push(this.id);
  });
  const fixture = TestBed.createComponent(WikiPage);
  fixture.componentRef.setInput("path", "docs/Home.md");
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await settle(fixture);
  return { fixture, scrolled, managers: harness.managers };
}

describe("WikiPage", () => {
  it("scrolls to the heading above a line of the file, counting its frontmatter", async () => {
    const { fixture, scrolled } = await setup({ line: "10" });
    expect(scrolled).toEqual(["setup"]);
    fixture.componentRef.setInput("line", "14");
    await settle(fixture);
    expect(scrolled).toEqual(["setup", "usage"]);
  });

  it("prefers an anchor", async () => {
    expect((await setup({ anchor: "usage", line: "10" })).scrolled).toEqual(["usage"]);
  });

  it("stays at the top for a line in the frontmatter or above the first heading", async () => {
    expect((await setup({ line: "2" })).scrolled).toEqual([]);
  });
});

describe("WikiPage's editor", () => {
  const buttons = (fixture: { nativeElement: HTMLElement }) =>
    [...fixture.nativeElement.querySelectorAll<HTMLButtonElement>("header button")].map((button) => button.textContent!.trim());

  it("offers Save while there are changes, and Done once they are saved", async () => {
    const { fixture, managers } = await setup({});
    const page = fixture.componentInstance as unknown as { edit(): void; draft: { set(value: string): void } };
    page.edit();
    await settle(fixture);
    expect(buttons(fixture)).toContain("Done");
    expect(buttons(fixture).some((text) => text.startsWith("Save"))).toBe(false);

    page.draft.set(`${CONTENT}More.\n`);
    await settle(fixture);
    expect(buttons(fixture).some((text) => text.startsWith("Save"))).toBe(true);
    expect(buttons(fixture)).not.toContain("Done");

    managers.content.write.mockResolvedValue({ scope: "content", path: "docs/Home.md", content: `${CONTENT}More.\n`, hash: "h2" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    await settle(fixture);
    expect(managers.content.write).toHaveBeenCalledWith("w1", "content", "docs/Home.md", `${CONTENT}More.\n`, "h1");
    expect(buttons(fixture)).toContain("Done");
  });
});

describe("WikiPage's checkboxes", () => {
  const LIST = "---\ntags: [demo]\n---\n# Plan\n\n- [ ] Draft\n- [x] Review\n";

  it("ticks a box as the page reads and saves it, counting the frontmatter", async () => {
    const harness = await openRepository();
    harness.managers.content.read.mockResolvedValue({ scope: "content", path: "docs/Plan.md", content: LIST, hash: "h1" });
    const ticked = LIST.replace("- [ ] Draft", "- [x] Draft");
    harness.managers.content.write
      .mockResolvedValueOnce({ scope: "content", path: "docs/Plan.md", content: ticked, hash: "h2" })
      .mockResolvedValueOnce({
        scope: "content",
        path: "docs/Plan.md",
        content: ticked.replace("- [x] Review", "- [ ] Review"),
        hash: "h3",
      });
    const fixture = TestBed.createComponent(WikiPage);
    fixture.componentRef.setInput("path", "docs/Plan.md");
    await settle(fixture);
    const boxes = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(".md-check.is-interactive")];
    expect(boxes()).toHaveLength(2);

    // Two quick clicks: the second waits for the first and builds on what it saved.
    boxes()[0]!.click();
    boxes()[1]!.click();
    await settle(fixture);
    await vi.waitFor(() => expect(harness.managers.content.write).toHaveBeenCalledTimes(2));
    expect(harness.managers.content.write).toHaveBeenNthCalledWith(1, "w1", "content", "docs/Plan.md", ticked, "h1");
    expect(harness.managers.content.write).toHaveBeenNthCalledWith(
      2,
      "w1",
      "content",
      "docs/Plan.md",
      ticked.replace("- [x] Review", "- [ ] Review"),
      "h2",
    );
  });
});
