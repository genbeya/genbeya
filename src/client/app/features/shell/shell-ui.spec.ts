import { TestBed } from "@angular/core/testing";
import { openRepository } from "../../testing/component-harness";
import { snapshot } from "../../testing/fake-platform";
import { ShellUi } from "./shell-ui";

const link = { remote: "https://github.com/acme/demo.git", item: { kind: "task", id: "DP-1" } } as const;
const parent = { kind: "local", path: "/projects" } as const;

async function setup() {
  const harness = await openRepository({ remotes: [] });
  const navigate = vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  return { ...harness, navigate, ui: TestBed.inject(ShellUi) };
}

describe("ShellUi.openLink", () => {
  it("offers to clone a repository no clone is known of, then shows the item", async () => {
    const { ui, dialogs, managers, navigate } = await setup();
    dialogs.open.mockResolvedValue({ url: link.remote, parent });
    managers.workspace.clone.mockResolvedValue({ id: "w2", snapshot: snapshot({ remotes: [{ name: "origin", url: link.remote }] }) });
    await ui.openLink(link);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Repository not cloned here", confirm: "Clone…" }));
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), link.remote);
    expect(managers.workspace.clone).toHaveBeenCalledWith(link.remote, parent);
    expect(navigate).toHaveBeenCalledWith(["/tasks"], { queryParams: { task: "DP-1" } });
  });

  it("does nothing more when the user declines or cancels cloning", async () => {
    const { ui, dialogs, managers, navigate } = await setup();
    dialogs.confirm.mockResolvedValueOnce(false);
    await ui.openLink(link);
    expect(dialogs.open).not.toHaveBeenCalled();
    await ui.openLink(link);
    expect(dialogs.open).toHaveBeenCalledTimes(1);
    expect(managers.workspace.clone).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
