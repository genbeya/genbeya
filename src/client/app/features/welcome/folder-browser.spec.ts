import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { FolderListing } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { fakeManagers, providePlatform } from "../../testing/fake-platform";
import { FolderBrowser, type FolderBrowserOptions } from "./folder-browser";

const home: FolderListing = {
  path: "/home/me",
  parent: "/home",
  folders: [
    { name: "code", repository: false },
    { name: "notes", repository: false },
    { name: "project", repository: true },
    { name: ".config", repository: false },
  ],
  truncated: false,
};

const listing = (path: string, names: string[] = []): FolderListing => ({
  path,
  parent: path === "/" ? null : path.replace(/\/[^/]+$/, "") || "/",
  folders: names.map((name) => ({ name, repository: false })),
  truncated: false,
});

async function render(options: Partial<FolderBrowserOptions> = {}) {
  // "Show hidden folders" is remembered.
  localStorage.clear();
  const managers = fakeManagers();
  managers.workspace.browse.mockImplementation(async ({ path }: { path: string }) =>
    path === "" || path === "/home/me" ? home : listing(path),
  );
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(managers),
      { provide: DIALOG_DATA, useValue: { location: { kind: "ssh", host: "me@server", path: "" }, ...options } },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(FolderBrowser);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const list = element.querySelector<HTMLElement>("[role=listbox]")!;
  const nameOf = (option: Element | null) => option?.querySelector(".browser-name")!.textContent!.trim();
  const names = () => [...element.querySelectorAll("[role=option]")].map(nameOf);
  const option = (name: string) => [...element.querySelectorAll<HTMLElement>("[role=option]")].find((o) => nameOf(o) === name)!;
  const button = (name: string) =>
    [...element.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent!.trim() === name || b.getAttribute("aria-label") === name,
    )!;
  const field = element.querySelector<HTMLInputElement>("input[aria-label='Folder path']")!;
  const type = (text: string) => {
    field.value = text;
    field.dispatchEvent(new Event("input"));
  };
  const press = async (key: string, target: HTMLElement = list) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await settle(fixture);
    return event;
  };
  const browsed = () => managers.workspace.browse.mock.calls.map(([location]) => (location as { path: string }).path);
  return { managers, close, fixture, element, list, nameOf, names, option, button, field, type, press, browsed };
}

describe("FolderBrowser", () => {
  it("lists the starting folder, with hidden folders on request", async () => {
    const { managers, names, field, element, option, fixture } = await render();
    expect(managers.workspace.browse).toHaveBeenCalledWith({ kind: "ssh", host: "me@server", path: "" });
    expect(field.value).toBe("/home/me");
    expect(names()).toEqual(["code", "notes", "project"]);
    expect(option("project").querySelector(".browser-repo")!.textContent!.trim()).toBe("Git repository");
    expect(option("code").querySelector(".browser-repo")).toBeNull();
    const hidden = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    hidden.checked = true;
    hidden.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(names()).toEqual(["code", "notes", "project", ".config"]);
  });

  it("opens folders by double-click and Enter, and goes up and home", async () => {
    const { option, press, browsed, button, field, fixture } = await render();
    option("code").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle(fixture);
    expect(field.value).toBe("/home/me/code");
    await press("Backspace");
    expect(field.value).toBe("/home/me");
    // Going up selects the folder it came from.
    expect(option("code").getAttribute("aria-selected")).toBe("true");
    await press("ArrowDown");
    await press("Enter");
    expect(field.value).toBe("/home/me/notes");
    button("Up one folder").click();
    await settle(fixture);
    button("Home folder").click();
    await settle(fixture);
    expect(browsed()).toEqual(["", "/home/me/code", "/home/me", "/home/me/notes", "/home/me", ""]);
  });

  it("moves through the folders with the keyboard and type-ahead", async () => {
    const { list, press, nameOf } = await render();
    const active = () => nameOf(list.querySelector(`#${list.getAttribute("aria-activedescendant")}`));
    expect(list.getAttribute("aria-activedescendant")).toBeNull();
    await press("ArrowDown");
    expect(active()).toBe("code");
    await press("End");
    expect(active()).toBe("project");
    await press("n");
    expect(active()).toBe("notes");
    await press("Home");
    expect(active()).toBe("code");
  });

  it("goes to a typed path on Enter without choosing it", async () => {
    const { type, field, press, browsed, close, names } = await render();
    type("/srv");
    const event = await press("Enter", field);
    expect(event.defaultPrevented).toBe(true);
    expect(browsed().at(-1)).toBe("/srv");
    expect(names()).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });

  it("explains folders it cannot list, and can still go up", async () => {
    const { managers, type, field, press, element, button, browsed, fixture } = await render();
    managers.workspace.browse.mockRejectedValueOnce(new Error("/home/me/gone does not exist."));
    type("/home/me/gone");
    await press("Enter", field);
    expect(element.querySelector("[role=alert]")!.textContent).toContain("/home/me/gone does not exist.");
    expect(button("Select this folder").disabled).toBe(true);
    button("Up one folder").click();
    await settle(fixture);
    expect(browsed().at(-1)).toBe("/home/me");
    expect(element.querySelector("[role=alert]")).toBeNull();
  });

  it("shows only the newest of overlapping listings", async () => {
    const { managers, type, field, press, fixture } = await render();
    let finishSlow: (value: FolderListing) => void = () => undefined;
    managers.workspace.browse.mockImplementationOnce(() => new Promise((resolve) => (finishSlow = resolve)));
    type("/slow");
    await press("Enter", field);
    type("/fast");
    await press("Enter", field);
    finishSlow(listing("/slow"));
    await settle(fixture);
    expect(field.value).toBe("/fast");
  });

  it("chooses the current folder", async () => {
    const { button, close, option, fixture } = await render();
    option("project").click();
    await settle(fixture);
    // Without openRepositories, a selected repository is just a folder.
    expect(button("Open project")).toBeUndefined();
    button("Select this folder").click();
    expect(close).toHaveBeenCalledWith({ path: "/home/me", open: false });
  });

  it("opens a selected repository directly when asked to", async () => {
    const { button, close, option, fixture } = await render({ openRepositories: true });
    option("code").click();
    await settle(fixture);
    expect(button("Open project")).toBeUndefined();
    option("project").click();
    await settle(fixture);
    button("Open project").click();
    expect(close).toHaveBeenCalledWith({ path: "/home/me/project", open: true });
  });
});
