import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { EditorView } from "@codemirror/view";
import { CodeEditor } from "./code-editor";

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

@Component({
  imports: [CodeEditor],
  template: `<gd-code-editor path="src/a.ts" [value]="value()" (valueChange)="changes.push($event)" (save)="saves = saves + 1" />`,
})
class Host {
  readonly value = signal("");
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
  });

  it("saves with Ctrl+S inside the editor", async () => {
    const { view, host } = await render("x");
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(host.saves).toBe(1);
  });
});
