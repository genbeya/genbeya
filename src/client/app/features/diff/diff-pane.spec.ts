import { TestBed } from "@angular/core/testing";
import { EditorView } from "@codemirror/view";
import type { Diff, DiffChange } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { DiffPane, type DiffAction, type DiffActionHandler, type DiffActionOutcome } from "./diff-pane";

const ACTIONS: DiffAction[] = [
  { id: "stage", label: "Stage", icon: "plus" },
  { id: "discard", label: "Discard", icon: "undo-2", danger: true },
];

const ORIGINAL = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";

/** A diff of ORIGINAL, with git's changes as its diff with the lines replaced has them. */
const diff = (modified: string, changes?: DiffChange[], original = ORIGINAL): Diff => ({
  path: "a.txt",
  original,
  modified,
  binary: false,
  version: `v-${modified.length}`,
  changes: changes ?? replaced(original, modified),
});

/** Git's changes when lines are only replaced one for one. */
function replaced(original: string, modified: string): DiffChange[] {
  const [a, b] = [original.split("\n"), modified.split("\n")];
  return a.flatMap((line, i) => (line === b[i] ? [] : [{ oldStart: i + 1, oldCount: 1, newStart: i + 1, newCount: 1 }]));
}

async function render(loaded: Diff | (() => Diff), actions: DiffAction[] = ACTIONS, inline = false, outcome: DiffActionOutcome = "done") {
  await openRepository();
  localStorage.setItem("diff:inline", inline ? "1" : "0");
  const load = vi.fn(async () => (typeof loaded === "function" ? loaded() : loaded));
  const apply = vi.fn<DiffActionHandler>(async () => outcome);
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

const bars = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>(".cm-hunkBar")];
const button = (bar: HTMLElement, label: string) =>
  [...bar.querySelectorAll<HTMLButtonElement>(".cm-hunkButton")].find((b) => b.textContent === label)!;

describe("DiffPane", () => {
  afterEach(() => localStorage.removeItem("diff:inline"));

  it.each([
    ["side by side", false],
    ["inline", true],
  ])("offers the actions on every changed chunk, %s", async (_name, inline) => {
    const { element, apply, load, fixture } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\n"), ACTIONS, inline);
    expect(bars(element).map((bar) => bar.textContent)).toEqual([
      "Change 1 of 2Stage hunkDiscard hunk",
      "Change 2 of 2Stage hunkDiscard hunk",
    ]);
    button(bars(element)[1]!, "Stage hunk").click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith("stage", { original: [{ from: 10, to: 10 }], modified: [{ from: 10, to: 10 }] }, "v-20", true);
    // The diff is fetched again, since a partly staged file may leave the snapshot as it was.
    expect(load).toHaveBeenCalledTimes(2);
  });

  // CodeMirror's own diff adds line 6 here; git adds line 5, and staging patches git's diff.
  it.each([
    ["side by side", false],
    ["inline", true],
  ])("shows the changes where git has them and acts on git's lines, %s", async (_name, inline) => {
    const text = (...rows: string[]) => rows.map((row) => `${row}\n`).join("");
    const original = text("}", "return;", "  x();", "", "{", "}", "  x();", "", "  y();", "return;", "");
    const modified = text("}", "return;", "  x();", "", "{", "{", "}", "  x();", "", "  y();", "return;", "");
    const changes = [{ oldStart: 5, oldCount: 0, newStart: 5, newCount: 1 }];
    const { element, apply, fixture } = await render(diff(modified, changes, original), ACTIONS, inline);
    const view = EditorView.findFromDOM(element.querySelector<HTMLElement>(inline ? ".cm-editor" : ".cm-merge-b")!)!;
    const added = [...view.dom.querySelectorAll(".cm-changedLine")].map((line) => view.state.doc.lineAt(view.posAtDOM(line)).number);
    expect(added).toEqual([5]);
    button(bars(element)[0]!, "Stage hunk").click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith("stage", { original: [], modified: [{ from: 5, to: 5 }] }, expect.any(String), true);
  });

  it("acts on the lines selected by their numbers", async () => {
    const changes = [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 2 }];
    const { element, apply, fixture } = await render(diff("a\nB\nX\nc\nd\ne\nf\ng\nh\ni\nj\n", changes));
    expect(element.querySelector(".diff-toolbar")!.textContent).toContain("Select lines by their numbers");
    const view = EditorView.findFromDOM(element.querySelector<HTMLElement>(".cm-merge-b")!)!;
    // Line 3 ("X"), as a click on its number selects it.
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from, head: view.state.doc.line(4).from } });
    await settle(fixture);
    expect(element.querySelector(".diff-toolbar")!.textContent).toContain("1 line selected");
    [...element.querySelectorAll<HTMLButtonElement>(".diff-toolbar button")]
      .find((b) => b.textContent!.includes("Stage selected lines"))!
      .click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith("stage", { original: [], modified: [{ from: 3, to: 3 }] }, "v-22", false);
  });

  it("shows no actions without any", async () => {
    const { element } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"), []);
    expect(element.querySelector(".cm-hunkBar")).toBeNull();
    expect(element.querySelector(".diff-toolbar")).toBeNull();
  });

  it("offers no actions on lines of a file git stages only as a whole", async () => {
    const { element } = await render({ ...diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"), changes: undefined });
    expect(element.querySelector(".cm-hunkBar")).toBeNull();
    expect(element.querySelector(".diff-toolbar")!.textContent).toContain("only stage this file as a whole");
  });

  it("shows the diff anew after a failed action", async () => {
    let current = diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
    const { element, load, fixture } = await render(() => current, ACTIONS, false, "failed");
    // Changed outside the app: no snapshot tells.
    current = diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nJJ\n");
    button(bars(element)[0]!, "Stage hunk").click();
    await settle(fixture);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(bars(element)).toHaveLength(2));
  });

  it("keeps the diff and the selection after a cancelled action", async () => {
    const { element, load, fixture } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"), ACTIONS, false, "cancelled");
    button(bars(element)[0]!, "Discard hunk").click();
    await settle(fixture);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows the diff anew when the window gets the focus back", async () => {
    const { load, fixture } = await render(diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"));
    window.dispatchEvent(new FocusEvent("focus"));
    await settle(fixture);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("names the version of the diff a chunk was shown in, while a newer one is still being shown", async () => {
    let current = diff("a\nB\nc\nd\ne\nf\ng\nh\ni\nj\n");
    const { element, apply, load, fixture } = await render(() => current);
    current = { ...diff("X\na\nB\nc\nd\ne\nf\ng\nh\ni\nj\n"), version: "newer" };
    window.dispatchEvent(new FocusEvent("focus"));
    await load.mock.results[1]!.value;
    // The pane has the newer diff; the view still shows the older one.
    button(bars(element)[0]!, "Stage hunk").click();
    await settle(fixture);
    expect(apply).toHaveBeenCalledWith("stage", { original: [{ from: 2, to: 2 }], modified: [{ from: 2, to: 2 }] }, "v-20", true);
  });

  it("keeps the stretches the user unfolded when the diff changes", async () => {
    const long = (change: Record<number, string>) => Array.from({ length: 40 }, (_, i) => `${change[i + 1] ?? `line ${i + 1}`}\n`).join("");
    let current = diff(long({ 1: "one", 40: "forty" }), undefined, long({}));
    const { element, fixture } = await render(() => current);
    const folds = () => element.querySelectorAll(".cm-merge-b .cm-collapsedLines").length;
    expect(folds()).toBe(1);
    element.querySelector<HTMLElement>(".cm-merge-b .cm-collapsedLines")!.click();
    await settle(fixture);
    expect(folds()).toBe(0);
    current = diff(long({ 1: "one", 40: "FORTY" }), undefined, long({}));
    window.dispatchEvent(new FocusEvent("focus"));
    await settle(fixture);
    await vi.waitFor(() => expect(element.querySelector(".cm-merge-b")!.textContent).toContain("FORTY"));
    expect(folds()).toBe(0);
  });
});
