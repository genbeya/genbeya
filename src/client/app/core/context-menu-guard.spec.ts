import { TestBed } from "@angular/core/testing";
import { ContextMenuGuard, openMenuFromKeyboard } from "./context-menu-guard";

const rightClick = (target: EventTarget) => {
  const event = new MouseEvent("contextmenu", { button: 2, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

const element = (tag: string, attributes: Record<string, string> = {}) => {
  const created = document.body.appendChild(document.createElement(tag));
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value);
  return created;
};

describe("ContextMenuGuard", () => {
  beforeEach(() => TestBed.inject(ContextMenuGuard));
  afterEach(() => {
    getSelection()!.removeAllRanges();
    document.body.replaceChildren();
  });

  it("keeps the webview's own menu off the app", () => {
    expect(rightClick(element("p"))).toBe(true);
  });

  it.each([
    ["an input", () => element("input")],
    ["a text area", () => element("textarea")],
    ["the code editor", () => element("div", { class: "cm-editor" }).appendChild(document.createElement("span"))],
    ["editable content", () => element("div", { contenteditable: "true" }).appendChild(document.createElement("span"))],
  ])("keeps copy and paste in %s", (_, field) => {
    expect(rightClick(field())).toBe(false);
  });

  it("keeps copy for selected text, such as a rendered page or a commit message", () => {
    const page = element("article");
    const selected = page.appendChild(document.createElement("p"));
    selected.textContent = "Selected words";
    const other = page.appendChild(document.createElement("p"));
    other.textContent = "Other words";
    getSelection()!.selectAllChildren(selected);
    expect(rightClick(selected)).toBe(false);
    expect(rightClick(other)).toBe(true);
    getSelection()!.collapseToStart();
    expect(rightClick(selected)).toBe(true);
  });

  it("leaves items with their own menu to that menu, even within a selection", () => {
    // Like CDK's context menu trigger, which opens its menu instead.
    const item = element("div");
    item.textContent = "A task";
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    getSelection()!.selectAllChildren(item);
    const event = new MouseEvent("contextmenu", { button: 2, cancelable: true, bubbles: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    item.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("opens an item's menu from Shift+F10 or the menu key, where the browser does not", () => {
    const item = element("div", { tabindex: "0" });
    const opened: MouseEvent[] = [];
    item.addEventListener("contextmenu", (event) => (opened.push(event), event.preventDefault()));
    const press = (key: string, shiftKey = false) =>
      openMenuFromKeyboard(new KeyboardEvent("keydown", { key, shiftKey, cancelable: true }), item);
    expect(press("F10", true)).toBe(true);
    expect(press("ContextMenu")).toBe(true);
    expect(press("F10")).toBe(false);
    expect(opened).toHaveLength(2);
    expect(opened[0]!.button).toBe(2);
  });
});
