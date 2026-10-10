import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { EditorView } from "@codemirror/view";
import { CodeEditor, type LineRange } from "./code-editor";

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

@Component({
  imports: [CodeEditor],
  template: `<gd-code-editor
    path="src/a.ts"
    [value]="value()"
    [reveal]="reveal()"
    (valueChange)="changes.push($event)"
    (save)="saves = saves + 1"
  />`,
})
class Host {
  readonly value = signal("");
  readonly reveal = signal<LineRange | null>(null);
  readonly changes: string[] = [];
  saves = 0;
}

async function render(value: string) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.value.set(value);
  await fixture.whenStable();
  const view = EditorView.findFromDOM(fixture.nativeElement.querySelector(".cm-editor"))!;
  return { fixture, view, host: fixture.componentInstance };
}

describe("CodeEditor", () => {
  it("shows the value without reporting it as a change", async () => {
    const { view, host } = await render("a\nb\n");
    expect(view.state.sliceDoc()).toBe("a\nb\n");
    expect(host.changes).toEqual([]);
  });

  it("keeps Windows line endings, so CRLF files are not modified by opening them", async () => {
    const { view, host } = await render("a\r\nb\r\n");
    expect(view.state.sliceDoc()).toBe("a\r\nb\r\n");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "c" } });
    expect(host.changes).toEqual(["a\r\nb\r\nc"]);
  });

  it("switches line endings when a reload brings CRLF text", async () => {
    const { view, fixture } = await render(["a", "b"].join(LF));
    fixture.componentInstance.value.set(["a", "b", "c"].join(CRLF));
    await fixture.whenStable();
    expect(view.state.sliceDoc()).toBe(["a", "b", "c"].join(CRLF));
    expect(view.state.doc.lines).toBe(3);
  });

  it("reports edits and replaces the text when the value changes from outside", async () => {
    const { view, host, fixture } = await render("one");
    view.dispatch({ changes: { from: 3, insert: " two" } });
    expect(host.changes).toEqual(["one two"]);
    fixture.componentInstance.value.set("reloaded");
    await fixture.whenStable();
    expect(view.state.sliceDoc()).toBe("reloaded");
    // A reload is not an edit.
    expect(host.changes).toEqual(["one two"]);
  });

  it("selects the lines it is asked to reveal, once the text has them", async () => {
    const { view, fixture } = await render("");
    fixture.componentInstance.reveal.set({ from: 2, to: 3 });
    await fixture.whenStable();
    expect(view.state.selection.main.empty).toBe(true);
    fixture.componentInstance.value.set(["one", "two", "three", "four"].join(LF));
    await fixture.whenStable();
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe(["two", "three"].join(LF));
  });

  it("saves with Ctrl+S inside the editor", async () => {
    const { view, host } = await render("x");
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(host.saves).toBe(1);
  });
});
