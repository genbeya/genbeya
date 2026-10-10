import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { Type } from "@angular/core";
import { Dialogs } from "../../core/dialogs";
import { settle } from "../../testing/component-harness";
import { fakeManagers, providePlatform } from "../../testing/fake-platform";
import { FolderBrowser, type FolderChoice } from "./folder-browser";
import { CloneDialog, RemoteDialog } from "./repository-dialogs";

async function render(component: Type<unknown>, choice: FolderChoice | undefined) {
  const managers = fakeManagers();
  managers.workspace.distributions.mockResolvedValue(["Ubuntu"]);
  const dialogs = { open: vi.fn(async () => choice) };
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(managers),
      { provide: Dialogs, useValue: dialogs },
      { provide: DialogRef, useValue: { close } },
      { provide: DIALOG_DATA, useValue: undefined },
    ],
  });
  const fixture = TestBed.createComponent(component);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = (name: string) => [...element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === name)!;
  const input = (label: string) =>
    [...element.querySelectorAll(".field")].find((field) => field.textContent!.trim().startsWith(label))!.querySelector("input")!;
  const fill = async (label: string, value: string) => {
    const field = input(label);
    field.value = value;
    field.dispatchEvent(new Event("input"));
    await settle(fixture);
  };
  const click = async (name: string) => {
    button(name).click();
    await settle(fixture);
  };
  return { dialogs, close, button, input, fill, click };
}

describe("RemoteDialog", () => {
  it("browses the distribution's home folder and opens the repository chosen there", async () => {
    const { dialogs, close, click } = await render(RemoteDialog, { path: "/home/me/project", open: true });
    await click("Browse…");
    expect(dialogs.open).toHaveBeenCalledWith(FolderBrowser, {
      location: { kind: "wsl", distro: "Ubuntu", path: "" },
      openRepositories: true,
    });
    expect(close).toHaveBeenCalledWith({ kind: "wsl", distro: "Ubuntu", path: "/home/me/project" });
  });

  it("browses an SSH server only once a host is named", async () => {
    const { button, click, fill } = await render(RemoteDialog, undefined);
    await click("SSH");
    expect(button("Browse…").disabled).toBe(true);
    await fill("Host", "me@server");
    expect(button("Browse…").disabled).toBe(false);
  });
});

describe("CloneDialog", () => {
  it("chooses the parent folder by browsing from the typed path", async () => {
    const { dialogs, close, click, fill, input } = await render(CloneDialog, { path: "/srv", open: false });
    await click("WSL or SSH");
    await click("SSH");
    await fill("Host", "me@server");
    await fill("Into folder", "/srv/x");
    await click("Browse…");
    expect(dialogs.open).toHaveBeenCalledWith(FolderBrowser, {
      location: { kind: "ssh", host: "me@server", path: "/srv/x" },
      openRepositories: false,
    });
    expect(input("Into folder").value).toBe("/srv");
    expect(close).not.toHaveBeenCalled();
  });
});
