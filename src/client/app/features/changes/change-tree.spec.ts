import { TestBed } from "@angular/core/testing";
import type { Change } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { ChangeTree } from "./change-tree";

const change = (path: string): Change => ({ path, index: " ", worktree: "M" });

async function render(paths: string[], selected: string | null = null) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(ChangeTree);
  fixture.componentRef.setInput("changes", paths.map(change));
  fixture.componentRef.setInput("staged", false);
  fixture.componentRef.setInput("label", "Changes");
  fixture.componentRef.setInput("selected", selected);
  document.body.appendChild(fixture.nativeElement);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const rows = () => [...element.querySelectorAll<HTMLElement>("[data-tree-row]")];
  /** Name and count of folders, name and status of files. */
  const labels = () =>
    rows().map(
      (row) => `${row.querySelector(".change-name")!.textContent!.trim()} ${row.querySelector(".count, .status-letter")!.textContent}`,
    );
  const press = async (key: string) => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await settle(fixture);
  };
  return { fixture, element, rows, labels, press };
}

describe("ChangeTree", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows folders with their counts and chains of single folders as one row", async () => {
    const { element, labels } = await render(["src/client/app/a.ts", "src/client/app/b.ts", "README.md"]);
    expect(labels()).toEqual(["src/client/app 2", "a.ts M", "b.ts M", "README.md M"]);
    const [folder] = element.querySelectorAll("[role=treeitem]");
    expect(folder!.getAttribute("aria-level")).toBe("1");
    expect(folder!.getAttribute("aria-expanded")).toBe("true");
    expect(element.querySelector("gd-change-row")!.getAttribute("aria-level")).toBe("2");
  });

  it("moves through rows with the arrows, closing and opening folders", async () => {
    const { rows, labels, press, fixture } = await render(["src/a.ts", "src/b.ts", "top.ts"], "src/b.ts");
    // One row is tabbable: the selected file.
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, -1, 0, -1]);
    rows()[2]!.focus();
    await press("ArrowLeft");
    expect(document.activeElement).toBe(rows()[0]);
    await press("ArrowLeft");
    expect(labels()).toEqual(["src 2", "top.ts M"]);
    await press("ArrowDown");
    expect(document.activeElement).toBe(rows()[1]);
    await press("ArrowUp");
    await press("ArrowRight");
    expect(labels()).toHaveLength(4);
    await press("ArrowRight");
    expect(document.activeElement).toBe(rows()[1]);
    await press("End");
    expect(document.activeElement).toBe(rows()[3]);
    await press("Home");
    expect(document.activeElement).toBe(rows()[0]);
    await press("Enter");
    expect(labels()).toHaveLength(2);
    fixture.destroy();
  });

  it("selects files and acts on whole folders", async () => {
    const { element, fixture } = await render(["src/a.ts", "src/b.ts"]);
    const tree = fixture.componentInstance;
    const chosen = vi.fn();
    const staged = vi.fn();
    const discarded = vi.fn();
    tree.chosen.subscribe(chosen);
    tree.toggleStaged.subscribe(staged);
    tree.discard.subscribe(discarded);
    element.querySelector<HTMLElement>("gd-change-row")!.click();
    expect(chosen).toHaveBeenCalledWith(change("src/a.ts"));
    element.querySelector<HTMLButtonElement>("[aria-label='Stage src']")!.click();
    expect(staged).toHaveBeenCalledWith({ path: "src", folder: true, changes: [change("src/a.ts"), change("src/b.ts")], staged: false });
    element.querySelector<HTMLButtonElement>("[aria-label='Discard changes in src']")!.click();
    expect(discarded).toHaveBeenCalledWith(expect.objectContaining({ path: "src", folder: true }));
  });
});
