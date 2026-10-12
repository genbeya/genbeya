import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { RemoteLocation } from "../../contracts/model";
import { nodeMachine } from "../../platforms/node/node-machine";
import { findShell } from "../../testing/shell";
import { decodeLenient } from "../../utilities/bytes";
import { HostFactory } from "./host-factory";
import { RemoteFolders, sshProblem } from "./remote-folders";
import { quote, ShellSession } from "./shell-session";

const machine = nodeMachine();
const server: RemoteLocation = { kind: "ssh", host: "me@server", path: "" };

/** Folders listed through `command`, which starts a POSIX sh; every location is served by it. */
function foldersOn(command: string, args: string[], options?: { limit?: number; idle?: number }) {
  const sessions: ShellSession[] = [];
  const hosts = {
    session: vi.fn(() => {
      const session = new ShellSession(machine.processes, command, args, "sh");
      sessions.push(session);
      return session;
    }),
    distributions: vi.fn(async () => ["Ubuntu"]),
  };
  const folders = new RemoteFolders(hosts, options);
  onTestFinished(() => folders.dispose());
  return { folders, hosts, sessions };
}

function describeListing(name: string, command: string, args: string[]) {
  describe(name, () => {
    /** A fresh folder on the target, with links resolved; `script` runs inside it. */
    async function fixture(script: string, limit?: number) {
      const helper = new ShellSession(machine.processes, command, args, "sh");
      const sh = async (body: string) => {
        const reply = await helper.exec(body);
        if (reply.code !== 0) throw new Error(reply.stderr);
        return decodeLenient(reply.stdout);
      };
      const root = (await sh(`cd "$(mktemp -d)" && pwd -P`)).trim();
      onTestFinished(async () => {
        await sh(`rm -rf ${quote(root)}`);
        helper.dispose();
      });
      await sh(`cd ${quote(root)} && ${script}`);
      const { folders } = foldersOn(command, args, { limit });
      const list = (path: string) => folders.list({ ...server, path });
      return { root, sh, list };
    }

    it("lists subfolders by name, hidden ones last, marking repositories", async () => {
      const { root, list } = await fixture(
        `mkdir -- b A "c d" "it's \\"q\\"" ünï .hidden -dash repo repo/.git worktree && ` +
          `echo "gitdir: x" > worktree/.git && echo x > file.txt && echo x > .file && ln -s A linked && ln -s file.txt filelink && { ln -s missing dangling || true; }`,
      );
      const listing = await list(root);
      expect(listing).toMatchObject({ path: root, parent: root.replace(/\/[^/]+$/, "") || "/", truncated: false });
      expect(listing.folders).toEqual([
        { name: "-dash", repository: false },
        { name: "A", repository: false },
        { name: "b", repository: false },
        { name: "c d", repository: false },
        { name: `it's "q"`, repository: false },
        // A link to a folder is a folder, whether sh made a link or (Git for Windows) a copy.
        { name: "linked", repository: false },
        { name: "repo", repository: true },
        { name: "worktree", repository: true },
        { name: "ünï", repository: false },
        { name: ".hidden", repository: false },
      ]);
    });

    it("lists an empty folder", async () => {
      const { root, list } = await fixture("true");
      expect((await list(root)).folders).toEqual([]);
    });

    it("normalises the path and resolves the root's parent to null", async () => {
      const { root, list } = await fixture("mkdir -p a/b");
      expect((await list(`${root}/a/b/..//./`)).path).toBe(`${root}/a`);
      expect(await list("/")).toMatchObject({ path: "/", parent: null });
    });

    it("starts in the home folder for an empty path or ~", async () => {
      const { sh, list } = await fixture("true");
      const home = (await sh("cd && pwd -P")).trim();
      expect((await list("")).path).toBe(home);
      expect((await list("~")).path).toBe(home);
      expect((await list("~/..")).path).toBe(home.replace(/\/[^/]+$/, "") || "/");
    });

    it("explains paths that are no folder", async () => {
      const { root, list } = await fixture("echo x > file.txt");
      await expect(list(`${root}/missing`)).rejects.toThrow(`${root}/missing does not exist.`);
      await expect(list(`${root}/file.txt`)).rejects.toThrow(`${root}/file.txt is not a folder.`);
      await expect(list("~/genbeya-missing-folder")).rejects.toThrow("~/genbeya-missing-folder does not exist.");
    });

    it("stops at the limit and says so", async () => {
      const { root, list } = await fixture("mkdir a b c d", 3);
      const listing = await list(root);
      expect(listing.folders).toHaveLength(3);
      expect(listing.truncated).toBe(true);
    });
  });
}

const shell = findShell(machine.os === "windows");
if (shell) describeListing("RemoteFolders over sh", shell, []);
else it.skip("RemoteFolders needs a POSIX sh", () => undefined);

describe("RemoteFolders over WSL", async () => {
  const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");
  if (ubuntu) describeListing("WSL (Ubuntu)", "wsl.exe", ["-d", "Ubuntu", "-e", "sh"]);
  else it.skip("needs the Ubuntu distribution", () => undefined);
});

describe.skipIf(!shell)("RemoteFolders sessions", () => {
  it("keeps one session per machine and closes it when another machine is browsed", async () => {
    const { folders, hosts, sessions } = foldersOn(shell!, []);
    await folders.list({ ...server, path: "/" });
    await folders.list({ ...server, path: "~" });
    expect(hosts.session).toHaveBeenCalledTimes(1);
    const close = vi.spyOn(sessions[0]!, "dispose");
    await folders.list({ kind: "wsl", distro: "Ubuntu", path: "/" });
    expect(hosts.session).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
  });

  it("closes an idle session", async () => {
    const { folders, sessions } = foldersOn(shell!, [], { idle: 20 });
    await folders.list({ ...server, path: "/" });
    const close = vi.spyOn(sessions[0]!, "dispose");
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe("RemoteFolders connection failures", () => {
  const unreachable = (distributions: string[] = []) =>
    new RemoteFolders({
      session: () => new ShellSession(machine.processes, "genbeya-no-such-program", [], "nowhere"),
      distributions: async () => distributions,
    });

  it("names the SSH host", async () => {
    await expect(unreachable().list(server)).rejects.toThrow(/^Can't connect to me@server: \S/);
  });

  it("names a missing WSL distribution", async () => {
    await expect(unreachable().list({ kind: "wsl", distro: "Nope", path: "" })).rejects.toThrow("WSL has no distribution named Nope.");
    await expect(unreachable(["Nope"]).list({ kind: "wsl", distro: "Nope", path: "" })).rejects.toThrow(/^Can't connect to WSL \(Nope\)/);
  });

  it.each([
    ["ssh: Could not resolve hostname x: No such host is known.\r\n", "Could not resolve hostname x: No such host is known."],
    [
      "Warning: Permanently added 'x' to the list of known hosts.\nme@x: Permission denied (publickey).\n",
      /^me@x: Permission denied \(publickey\)\. .*key or an agent/,
    ],
    ["Host key verification failed.\n", /^Host key verification failed\. .*terminal/],
    ["", "ssh ended without saying why."],
  ])("keeps the useful part of ssh's message %j", (stderr, expected) => {
    expect(sshProblem(stderr)).toMatch(expected);
  });
});
