import { TestBed } from "@angular/core/testing";
import { ContextMenuGuard } from "./context-menu-guard";

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
  afterEach(() => document.body.replaceChildren());

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
});
