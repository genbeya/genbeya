import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import type { SearchMatch, SearchResults } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { Palette, toggledOption } from "./palette";
import type { PaletteMode } from "./shell-ui";
import { SEARCH_DELAY } from "./text-search";

const match = (line: number, text: string, start: number, end: number): SearchMatch => ({
  line,
  text,
  ranges: [{ start, end }],
  before: "above",
  after: null,
});

const RESULTS: SearchResults = {
  wiki: [{ path: "docs/Home.md", scope: "content", title: "Home", matches: [match(7, "Install the gadget", 12, 18)] }],
  tasks: [{ path: "tasks/TP-1.md", scope: "content", title: "Ship it", id: "TP-1", status: "todo", matches: [match(3, "gadget", 0, 6)] }],
  code: [{ path: "src/gadget.ts", scope: "repo", title: "gadget.ts", matches: [match(2, "const gadget = 1;", 6, 12)] }],
  truncated: false,
};

async function setup(mode: PaletteMode = "all") {
  const close = vi.fn();
  const harness = await openRepository({}, [
    { provide: DIALOG_DATA, useValue: mode },
    { provide: DialogRef, useValue: { close } },
  ]);
  const navigate = vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  harness.managers.content.search.mockResolvedValue(RESULTS);
  const fixture = TestBed.createComponent(Palette);
  await settle(fixture);
  return { ...harness, fixture, close, navigate, search: harness.managers.content.search };
}

const element = (fixture: ComponentFixture<Palette>) => fixture.nativeElement as HTMLElement;
const field = (fixture: ComponentFixture<Palette>) => element(fixture).querySelector<HTMLInputElement>(".palette-input")!;
const texts = (fixture: ComponentFixture<Palette>, selector: string) =>
  [...element(fixture).querySelectorAll(selector)].map((node) => node.textContent!.trim());
/** The text of each element's children, separated by spaces as they show. */
const parts = (fixture: ComponentFixture<Palette>, selector: string) =>
  [...element(fixture).querySelectorAll(selector)].map((node) =>
    [...node.children]
      .map((child) => child.textContent!.trim())
      .filter(Boolean)
      .join(" "),
  );

async function type(fixture: ComponentFixture<Palette>, value: string) {
  field(fixture).value = value;
  field(fixture).dispatchEvent(new Event("input"));
  await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY + 20));
  await settle(fixture);
}

async function press(fixture: ComponentFixture<Palette>, key: string, init: KeyboardEventInit = {}) {
  field(fixture).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  await settle(fixture);
}

describe("Palette full-text search", () => {
  it("searches inside files after a slash, once typing pauses, and groups the matches by area and file", async () => {
    const { fixture, search } = await setup();
    await type(fixture, "/gadget");
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("w1", "gadget", { caseSensitive: false, wholeWord: false, regex: false });
    expect(texts(fixture, ".palette-group")).toEqual(["Wiki", "Tasks", "Code"]);
    expect(parts(fixture, ".palette-file")).toEqual(["Home docs/Home.md", "TP-1 Ship it todo", "src/gadget.ts"]);
    expect(texts(fixture, ".palette-item mark")).toEqual(["gadget", "gadget", "gadget"]);
    expect(element(fixture).querySelector(".palette-item")!.getAttribute("aria-label")).toBe("Home, line 7: Install the gadget");
    expect(parts(fixture, ".palette-preview .palette-context")).toEqual(["6 above", "7 Install the gadget"]);
    expect(element(fixture).querySelector("[role=status]")!.textContent!.trim()).toBe("3 matches in 3 files");
  });

  it("opens pages at the line, tasks in their panel and code with the line selected", async () => {
    const { fixture, navigate, close } = await setup();
    await type(fixture, "/gadget");
    await press(fixture, "Enter");
    expect(close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(["/wiki"], { queryParams: { page: "docs/Home.md", line: 7 } });
    await press(fixture, "ArrowDown");
    await press(fixture, "Enter");
    expect(navigate).toHaveBeenLastCalledWith(["/tasks"], { queryParams: { task: "TP-1" } });
    await press(fixture, "ArrowDown");
    await press(fixture, "Enter");
    expect(navigate).toHaveBeenLastCalledWith(["/code"], { queryParams: { file: "src/gadget.ts", lines: 2 } });
  });

  it("toggles case, whole words and regular expressions by button or Alt and a letter", async () => {
    const { fixture, search } = await setup();
    await type(fixture, "/gadget");
    const matchCase = element(fixture).querySelector<HTMLButtonElement>("[aria-label='Match case']")!;
    matchCase.click();
    await type(fixture, "/gadget");
    expect(matchCase.getAttribute("aria-pressed")).toBe("true");
    expect(search).toHaveBeenLastCalledWith("w1", "gadget", { caseSensitive: true, wholeWord: false, regex: false });
    await press(fixture, "®", { altKey: true, code: "KeyR" });
    await type(fixture, "/gadget");
    expect(search).toHaveBeenLastCalledWith("w1", "gadget", { caseSensitive: true, wholeWord: false, regex: true });
  });

  it("leaves Option and a letter to typing on macOS, where ⌥⌘ and the letter toggles", () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { code: "KeyC", ...init });
    expect(toggledOption(key({ key: "ç", altKey: true }), true)).toBeUndefined();
    expect(toggledOption(key({ key: "c", altKey: true, metaKey: true }), true)).toBe("caseSensitive");
    expect(toggledOption(key({ key: "c", altKey: true }), false)).toBe("caseSensitive");
    expect(toggledOption(key({ key: "c", altKey: true, metaKey: true }), false)).toBeUndefined();
    expect(toggledOption(key({ key: "c", altKey: true, ctrlKey: true }), false)).toBeUndefined();
  });

  it("opens ready to search with Ctrl+Shift+F, and explains what to type", async () => {
    const { fixture, search } = await setup("search");
    expect(field(fixture).value).toBe("/");
    expect(texts(fixture, ".palette-empty")).toEqual(["Type to search inside pages, tasks and files."]);
    await type(fixture, "/   ");
    expect(search).not.toHaveBeenCalled();
  });

  it("says when nothing matched or the search failed", async () => {
    const { fixture, search } = await setup("search");
    search.mockResolvedValueOnce({ wiki: [], tasks: [], code: [], truncated: false });
    await type(fixture, "/absent");
    expect(texts(fixture, ".palette-empty")).toEqual(["No matches"]);
    search.mockRejectedValueOnce(new Error("Invalid regular expression."));
    await type(fixture, "/(");
    expect(texts(fixture, ".palette-empty")).toEqual(["Invalid regular expression."]);
    expect(element(fixture).querySelector("[role=status]")!.textContent!.trim()).toBe("Invalid regular expression.");
  });

  it("keeps the regular palette without a slash", async () => {
    const { fixture, search } = await setup();
    await type(fixture, "home");
    expect(search).not.toHaveBeenCalled();
    expect(texts(fixture, ".palette-group")).toContain("Pages");
    expect(element(fixture).querySelector(".palette-toggles")).toBeNull();
  });
});
