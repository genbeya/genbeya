import { TestBed } from "@angular/core/testing";
import { EditorView } from "@codemirror/view";
import type { Diff } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { DiffPane, type DiffAction } from "./diff-pane";

const ACTIONS: DiffAction[] = [
  { id: "stage", label: "Stage", icon: "plus" },
  { id: "discard", label: "Discard", icon: "undo-2", danger: true },
];

const diff = (modified: string): Diff => ({
  path: "a.txt",
  original: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n",
  modified,
  binary: false,
  version: `v-${modified.length}`,
});

async function render(loaded: Diff, actions: DiffAction[] = ACTIONS, inline = false) {
  await openRepository();
  localStorage.setItem("diff:inline", inline ? "1" : "0");
  const load = vi.fn(async () => loaded);
  const apply = vi.fn(async () => true);
  const fixture = TestBed.createComponent(DiffPane);
  fixture.componentRef.setInput("path", "a.txt");
  fixture.componentRef.setInput("load", load);
  fixture.componentRef.setInput("actions", actions);
  fixture.componentRef.setInput("apply", apply);
  await settle(fixture);
  // The language loads asynchronously before the editors appear.
  await vi.waitFor(() => expect((fixture.nativeElement as HTMLElement).querySelector(".cm-editor")).not.toBeNull());
  await settle(fixture);
  return { fixture, element: fixture.nativeElement as HTMLElement, load, apply };
}

describe("DiffPane", () => {
  afterEach(() => localStorage.removeItem("diff:inline"));

  it.each([
    ["side by side", false],
    ["inline", true],
  ])("offers the actions on every changed chunk, %s", async (_name, inline) => {
    const { element, apply, load, fixture } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\n"), ACTIONS, inline);
    const bars = [...element.querySelectorAll(".cm-hunkBar")];
    expect(bars.map((bar) => bar.textContent)).toEqual(["Change 1 of 2Stage hunkDiscard hunk", "Change 2 of 2Stage hunkDiscard hunk"]);
    bars[1]!.querySelector<HTMLButtonElement>(".cm-hunkButton")!.click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith(
      "stage",
      { original: [{ from: 10, to: 10 }], modified: [{ from: 10, to: 10 }] },
      expect.objectContaining({ version: "v-20" }),
      true,
    );
    // The diff is fetched again, since a partly staged file may leave the snapshot as it was.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("acts on the lines selected by their numbers", async () => {
    const { element, apply, fixture } = await render(diff("a\nB\nX\nc\nd\ne\nf\ng\nh\ni\nj\n"));
    expect(element.querySelector(".diff-toolbar")!.textContent).toContain("Select lines by their numbers");
    const view = EditorView.findFromDOM(element.querySelector<HTMLElement>(".cm-merge-b")!)!;
    // Line 3 ("X"), as a click on its number selects it.
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from, head: view.state.doc.line(4).from } });
    await settle(fixture);
    expect(element.querySelector(".diff-toolbar")!.textContent).toContain("1 changed line selected");
    [...element.querySelectorAll<HTMLButtonElement>(".diff-toolbar button")]
      .find((b) => b.textContent!.includes("Stage selected lines"))!
      .click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith("stage", { original: [], modified: [{ from: 3, to: 3 }] }, expect.anything(), false);
  });

  it("shows no actions without any", async () => {
    const { element } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"), []);
    expect(element.querySelector(".cm-hunkBar")).toBeNull();
    expect(element.querySelector(".diff-toolbar")).toBeNull();
  });
});
