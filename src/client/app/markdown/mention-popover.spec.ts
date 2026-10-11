import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { Person } from "../../../contracts/model";
import { openRepository, settle } from "../testing/component-harness";
import type { LinkTarget } from "./link-target";
import type { GitdeskOptions } from "./markdown-pipeline";
import { MarkdownView } from "./markdown-view";

const ada: Person = { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: [], commits: 1 };

@Component({
  imports: [MarkdownView],
  template: `<gd-markdown [source]="source()" path="docs/Page.md" [links]="links" (linkClicked)="followed.push($event)" />`,
})
class Host {
  readonly source = signal("Ask @ada.");
  readonly links: GitdeskOptions = { people: [ada] };
  readonly followed: LinkTarget[] = [];
}

async function render() {
  const harness = await openRepository();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>("a.md-mention")!;
  const popover = () => document.querySelector<HTMLElement>(".mention-popover");
  const open = async () => {
    chip.click();
    await vi.waitFor(() => expect(popover()).not.toBeNull());
    await settle(fixture);
  };
  return { ...harness, fixture, chip, popover, open };
}

describe("mention popover", () => {
  it("shows who a mention means, instead of following it as a link", async () => {
    const { fixture, popover, open } = await render();
    await open();
    expect(popover()!.getAttribute("aria-label")).toBe("Ada Lovelace");
    expect(popover()!.textContent).toContain("@ada");
    expect(popover()!.textContent).toContain("ada@example.com");
    expect(fixture.componentInstance.followed).toEqual([]);
  });

  it("goes to the tasks assigned to the person", async () => {
    const { router, popover, open } = await render();
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    await open();
    const button = [...popover()!.querySelectorAll("button")].find((candidate) =>
      candidate.textContent!.includes("Tasks assigned to Ada"),
    )!;
    button.click();
    expect(navigate).toHaveBeenCalledWith(["/tasks"], { queryParams: { assignee: "ada" } });
    expect(popover()).toBeNull();
  });

  it("closes with Escape, returning focus to the mention", async () => {
    const { chip, popover, open } = await render();
    await open();
    popover()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(chip);
  });
});
