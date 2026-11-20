import { describe, expect, it } from "vitest";
import { LOCAL_ONLY } from "../access/hosts/local-hosts";
import { nodeMachine } from "../platforms/node/node-machine";
import { createRepository, onTestFinished } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { launchArgument } from "../utilities/launch-request";
import { createLocalBackend } from "./local-backend";

async function backend() {
  const managers = await createLocalBackend(nodeMachine(), await temporaryFolder("data-"));
  onTestFinished(() => managers.dispose());
  return managers;
}

describe("the local backend", () => {
  it("opens repositories on this computer", async () => {
    const repository = await createRepository();
    const managers = await backend();
    const { snapshot } = await managers.workspace.open({ kind: "local", path: repository.root });
    expect(snapshot.settings.name).toBe("Test Project");
  });

  it("refuses repositories and folders on other machines", async () => {
    const managers = await backend();
    await expect(managers.workspace.open({ kind: "ssh", host: "me@server", path: "/r" })).rejects.toThrow(LOCAL_ONLY);
    await expect(managers.workspace.open({ kind: "wsl", distro: "Ubuntu", path: "/r" })).rejects.toThrow(LOCAL_ONLY);
    await expect(managers.workspace.browse({ kind: "ssh", host: "me@server", path: "~" })).rejects.toThrow(LOCAL_ONLY);
    expect(await managers.workspace.distributions()).toEqual([]);
  });

  it("opens no terminals and ignores launch arguments", async () => {
    const repository = await createRepository();
    const managers = await backend();
    expect(await managers.terminal.available()).toBe(false);
    expect(await managers.workspace.restore(["code", launchArgument({ kind: "local", path: repository.root })])).toBeNull();
  });
});
