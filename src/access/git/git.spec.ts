import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository } from "../../testing/repository";
import type { Host } from "../hosts/host";
import { LocalHost } from "../hosts/local-host";
import type { RunOptions } from "../ports";
import { Git } from "./git";

const host = new LocalHost(nodeMachine());

describe("Git", () => {
  it("never runs the file system monitor a repository configures", async () => {
    const repository = await createRepository();
    // Git runs the monitor through the shell in the working tree.
    await repository.git("config", "core.fsmonitor", "echo ran > fsmonitor-ran; false");
    await repository.git("status");
    // Proves the setup: plain git runs the monitor.
    expect(await repository.exists("fsmonitor-ran")).toBe(true);
    await repository.git("clean", "-q", "-f", "--", "fsmonitor-ran");

    await new Git(host, repository.root).status();
    expect(await repository.exists("fsmonitor-ran")).toBe(false);
  });

  it("explains failures git prints to standard output", async () => {
    const repository = await createRepository();
    await expect(new Git(host, repository.root).text(["commit", "-m", "Nothing"])).rejects.toThrow(/nothing to commit/);
  });

  it("reads git's version once, for options newer versions have", async () => {
    const git = new Git(host, (await createRepository()).root);
    const version = await git.version();
    expect(version?.major).toBeGreaterThanOrEqual(2);
    expect(git.version()).toBe(git.version());
    expect(await git.supports({ major: 2, minor: 0, patch: 0 })).toBe(true);
    expect(await git.supports({ major: 99, minor: 0, patch: 0 })).toBe(false);
  });

  it("asks for the version again after it could not be read", async () => {
    const root = (await createRepository()).root;
    let failing = true;
    const flaky: Host = Object.create(host, {
      run: {
        value: (command: string, args: readonly string[], options: RunOptions) =>
          failing ? Promise.resolve({ code: 1, stdout: new Uint8Array(), stderr: "busy" }) : host.run(command, args, options),
      },
    });
    const git = new Git(flaky, root);
    expect(await git.version()).toBeNull();
    failing = false;
    expect((await git.version())?.major).toBeGreaterThanOrEqual(2);
  });

  it("passes a failed command's result through without throwing", async () => {
    const repository = await createRepository();
    const result = await new Git(host, repository.root).run(["rev-parse", "--verify", "--quiet", "no-such-ref"]);
    expect(result.code).not.toBe(0);
  });
});
