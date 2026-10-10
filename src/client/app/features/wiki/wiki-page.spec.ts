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
  return { fixture, scrolled };
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
