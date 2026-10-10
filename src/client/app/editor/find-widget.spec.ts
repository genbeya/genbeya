import { getSearchQuery, SearchQuery, searchPanelOpen } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editingSetup } from "./editor-setup";
import { countMatches, describeCount } from "./find-widget";

function editor(doc: string, anchor = 0, head = anchor) {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: editingSetup(true) }),
    parent: document.body,
  });
  onTestFinished(() => view.destroy());
  return view;
}

function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

function panel(view: EditorView) {
  const dom = view.dom.querySelector<HTMLElement>(".cm-find")!;
  const button = (label: string) => dom.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;
  const find = dom.querySelector<HTMLInputElement>("input[aria-label=Find]")!;
  const replace = dom.querySelector<HTMLInputElement>("input[aria-label=Replace]")!;
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new Event("input"));
  };
  return { dom, button, find, replace, type, count: () => dom.querySelector(".cm-find-count")!.textContent };
}

const open = (view: EditorView, key = "f") => (press(view.contentDOM, key, { ctrlKey: true }), panel(view));

describe("match counting", () => {
  const state = EditorState.create({ doc: "a a a", selection: { anchor: 2, head: 3 } });

  it("counts matches and finds the selected one", () => {
    expect(countMatches(state, new SearchQuery({ search: "a" }))).toEqual({ total: 3, capped: false, current: 2 });
    expect(describeCount({ total: 3, capped: false, current: 2 })).toBe("2 of 3");
    expect(describeCount({ total: 3, capped: false, current: 0 })).toBe("? of 3");
    expect(describeCount({ total: 0, capped: false, current: 0 })).toBe("No results");
  });

  it("stops counting at the limit", () => {
    expect(countMatches(state, new SearchQuery({ search: "a" }), 2)).toEqual({ total: 2, capped: true, current: 2 });
    expect(describeCount({ total: 2, capped: true, current: 1 })).toBe("1 of 2+");
  });
});

describe("find widget", () => {
  it("opens with Ctrl+F, taking the selected text, and counts while typing", () => {
    const view = editor("one two one ONE", 4, 7);
    const { find, type, count } = open(view);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(find.value).toBe("two");
    expect(document.activeElement).toBe(find);
    type(find, "one");
    // Typing selects the first match from the cursor on.
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("one");
    expect(count()).toBe("2 of 3");
  });

  it("goes to the next and previous match with Enter and Shift+Enter", () => {
    const view = editor("x1 x2 x3");
    const { find, type, count } = open(view);
    type(find, "x");
    expect(count()).toBe("1 of 3");
    press(find, "Enter");
    expect(count()).toBe("2 of 3");
    press(find, "Enter", { shiftKey: true });
    press(find, "Enter", { shiftKey: true });
    expect(count()).toBe("3 of 3");
  });

  it("matches case, whole words and regular expressions when switched on", () => {
    const view = editor("Cat cat category");
    const { find, type, count, button } = open(view);
    type(find, "cat");
    expect(count()).toMatch(/of 3$/);
    button("Match case").click();
    expect(button("Match case").getAttribute("aria-pressed")).toBe("true");
    expect(count()).toMatch(/of 2$/);
    button("Match whole word").click();
    expect(count()).toMatch(/of 1$/);
    button("Match whole word").click();
    button("Match case").click();
    press(find, "r", { altKey: true });
    expect(getSearchQuery(view.state).regexp).toBe(true);
    type(find, "c.t\\b");
    expect(count()).toMatch(/of 2$/);
  });

  it("shows an invalid pattern and no results", () => {
    const view = editor("abc");
    const { find, type, count, button, dom } = open(view);
    type(find, "zzz");
    expect(count()).toBe("No results");
    expect(button("Next match").disabled).toBe(true);
    button("Use regular expression").click();
    type(find, "(");
    expect(count()).toBe("Invalid pattern");
    expect(find.getAttribute("aria-invalid")).toBe("true");
    expect(dom.querySelector(".cm-find-field")!.classList).toContain("is-invalid");
  });

  it("replaces all matches of a regular expression, with groups, after Ctrl+H", () => {
    const view = editor("ada@home bob@work");
    const { dom, find, replace, type, button } = open(view, "h");
    expect(dom.querySelector<HTMLElement>(".cm-find-row:last-child")!.hidden).toBe(false);
    expect(button("Toggle replace").getAttribute("aria-expanded")).toBe("true");
    button("Use regular expression").click();
    type(find, "(\\w+)@(\\w+)");
    type(replace, "$2:$1");
    button("Replace all").click();
    expect(view.state.sliceDoc()).toBe("home:ada work:bob");
  });

  it("replaces one match at a time with Enter in the replace field", () => {
    const view = editor("a a");
    const { find, replace, type } = open(view, "h");
    type(find, "a");
    type(replace, "b");
    press(replace, "Enter");
    expect(view.state.sliceDoc()).toBe("b a");
  });

  it("finds only in the selection when asked", () => {
    const view = editor("a a a a", 2, 5);
    const { find, type, count, button } = open(view);
    button("Find in selection").click();
    type(find, "a");
    expect(count()).toMatch(/of 2$/);
    expect([...view.dom.querySelectorAll(".cm-findScope")].map((mark) => mark.textContent).join("")).toBe("a a");
  });

  it("closes with Escape, gives focus back and searches everywhere next time", () => {
    const view = editor("a a a", 0, 1);
    const first = open(view);
    first.button("Find in selection").click();
    expect(press(first.find, "Escape").defaultPrevented).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.hasFocus).toBe(true);
    view.dispatch({ selection: { anchor: 0 } });
    const second = open(view);
    expect(second.button("Find in selection").getAttribute("aria-pressed")).toBe("false");
    expect(second.count()).toMatch(/of 3$/);
  });
});
