import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { findShell } from "../../testing/shell";
import { temporaryFolder } from "../../testing/temp";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import { FileSystemError, type FileSystem } from "../ports";
import { HostError, type Host } from "./host";
import { HostFactory, locationOfFolder, validateFolderLocation, validateLocation } from "./host-factory";
import { LocalHost } from "./local-host";
import { printfFormat, ShellHost } from "./shell-host";
import { quote, ShellSession } from "./shell-session";
import { localTerminal, sshTerminal, wslTerminal } from "./terminal-commands";

const machine = nodeMachine();

interface HostFixture {
  host: Host;
  root: string;
  /** Creates a file directly on the host's file system. */
  put(relative: string, content: string): Promise<void>;
  link(target: string, relative: string): Promise<boolean>;
  /** The exact names in a folder, as the file system stores them. */
  names(relative: string): Promise<string[]>;
}

function describeHost(name: string, setup: () => Promise<HostFixture>) {
  describe(name, () => {
    it("writes and reads files, creating folders", async () => {
      const { host, root } = await setup();
      await host.write(root, "a/b/c.txt", encodeText("Ünïcode 'quotes' %s \\ -x\n"), false);
      expect(decodeLenient(await host.read(root, "a/b/c.txt", 1000))).toBe("Ünïcode 'quotes' %s \\ -x\n");
      expect(await host.kind(root, "a/b")).toBe("dir");
      expect(await host.kind(root, "a/b/c.txt")).toBe("file");
      expect(await host.kind(root, "missing")).toBeNull();
    });

    it("keeps binary data and leading dashes intact", async () => {
      const { host, root } = await setup();
      const data = new Uint8Array([45, 45, 45, 0, 255, 10, 37]);
      await host.write(root, "bin", data, false);
      expect([...(await host.read(root, "bin", 100))]).toEqual([...data]);
    });

    it("refuses exclusive writes to existing files", async () => {
      const { host, root, put } = await setup();
      await put("a.txt", "x");
      await expect(host.write(root, "a.txt", encodeText("y"), true)).rejects.toMatchObject({ code: "EXISTS" });
    });

    it("reports missing, oversized and non-regular files", async () => {
      const { host, root, put } = await setup();
      await put("big.txt", "12345");
      await put("dir/x", "");
      await expect(host.read(root, "missing.txt", 10)).rejects.toThrow("missing.txt does not exist.");
      await expect(host.read(root, "big.txt", 4)).rejects.toMatchObject({ code: "TOOLARGE" });
      await expect(host.read(root, "dir", 10)).rejects.toMatchObject({ code: "NOTFILE" });
      await expect(host.remove(root, "dir")).rejects.toMatchObject({ code: "NOTFILE" });
    });

    it("reads many files, mapping unreadable ones to null", async () => {
      const { host, root, put } = await setup();
      await put("one.md", "1");
      await put("two words.md", "22");
      const files = await host.readMany(root, ["one.md", "missing.md", "two words.md"], 10);
      expect(files.map((f) => (f ? decodeLenient(f) : null))).toEqual(["1", null, "22"]);
      expect(await host.readMany(root, [], 10)).toEqual([]);
    });

    it("moves entries and refuses to overwrite", async () => {
      const { host, root, put } = await setup();
      await put("from/a.md", "a");
      await put("taken.md", "t");
      await host.move(root, "from", "to/nested");
      expect(decodeLenient(await host.read(root, "to/nested/a.md", 10))).toBe("a");
      await expect(host.move(root, "to/nested/a.md", "taken.md")).rejects.toMatchObject({ code: "EXISTS" });
      await expect(host.move(root, "nothing", "x")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("renames entries by case only", async () => {
      const { host, root, put, names } = await setup();
      await put("docs/readme.md", "r");
      await put("docs/guide/a.md", "a");
      await host.move(root, "docs/readme.md", "docs/Readme.md");
      await host.move(root, "docs/guide", "docs/Guide");
      expect((await names("docs")).sort()).toEqual(["Guide", "Readme.md"]);
      expect(decodeLenient(await host.read(root, "docs/Guide/a.md", 10))).toBe("a");
    });

    it("removes files", async () => {
      const { host, root, put } = await setup();
      await put("gone.md", "x");
      await host.remove(root, "gone.md");
      expect(await host.kind(root, "gone.md")).toBeNull();
    });

    it("never follows links below the root", async () => {
      const { host, root, put, link } = await setup();
      await put("real/page.md", "secret");
      if (!(await link("real", "linked"))) return;
      for (const attempt of [
        () => host.read(root, "linked/page.md", 100),
        () => host.write(root, "linked/new.md", encodeText("x"), false),
        () => host.kind(root, "linked/page.md"),
      ])
        await expect(attempt()).rejects.toMatchObject({ code: "SYMLINK" });
      expect(await host.readMany(root, ["linked/page.md"], 100)).toEqual([null]);
    });

    it("runs commands in a folder", async () => {
      const { host, root } = await setup();
      const result = await host.run("git", ["init", "-q"], { cwd: root });
      expect(result.code).toBe(0);
      expect(await host.kind(root, ".git")).toBe("dir");
    });

    it("never lets git open an editor, and passes environment variables", async () => {
      const { host, root } = await setup();
      const editor = (env?: Record<string, string>) => host.run("git", ["var", "GIT_EDITOR"], { cwd: root, ...(env ? { env } : {}) });
      expect(decodeLenient((await editor()).stdout).trim()).toBe(":");
      expect(decodeLenient((await editor({ GIT_EDITOR: "it's $HOME" })).stdout).trim()).toBe("it's $HOME");
    });
  });
}

describeHost("LocalHost", async () => {
  const root = await temporaryFolder("host-");
  return {
    host: new LocalHost(machine),
    root,
    async put(relative, content) {
      await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await fs.writeFile(path.join(root, relative), content);
    },
    async link(target, relative) {
      try {
        await fs.symlink(path.join(root, target), path.join(root, relative), "junction");
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
        throw error;
      }
    },
    names: (relative) => fs.readdir(path.join(root, relative)),
  };
});

describe("LocalHost when Windows blocks renaming a folder", () => {
  it("moves the folder's entries one by one, links as links", async () => {
    const root = await temporaryFolder("host-");
    // Renaming anything that leads to a folder fails for the first three attempts, as the host's retries do.
    const attempts = new Map<string, number>();
    const blocking: FileSystem = {
      ...machine.fileSystem,
      async rename(from, to) {
        attempts.set(from, (attempts.get(from) ?? 0) + 1);
        if ((await machine.fileSystem.stat(from)).kind === "dir" && attempts.get(from)! <= 3)
          throw new FileSystemError("EPERM", "A watcher holds the folder.");
        return machine.fileSystem.rename(from, to);
      },
    };
    await fs.mkdir(path.join(root, "real"));
    await fs.writeFile(path.join(root, "real", "page.md"), "kept");
    await fs.mkdir(path.join(root, "from"));
    await fs.writeFile(path.join(root, "from", "a.md"), "a");
    try {
      await fs.symlink(path.join(root, "real"), path.join(root, "from", "linked"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await new LocalHost({ ...machine, fileSystem: blocking }).move(root, "from", "to");
    expect(await fs.readFile(path.join(root, "to", "a.md"), "utf8")).toBe("a");
    expect((await fs.lstat(path.join(root, "to", "linked"))).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(path.join(root, "real"))).toEqual(["page.md"]);
  });
});

/** The session's temp folder holds file contents; it must go however the session ends. */
function describeSessionCleanup(name: string, command: string, args: string[]) {
  const session = () => {
    const opened = new ShellSession(machine.processes, command, args, name);
    onTestFinished(() => opened.dispose());
    return opened;
  };
  const folderOf = async (opened: ShellSession) => decodeLenient((await opened.exec(`printf '%s' "$T"`)).stdout);
  const removed = async (folder: string) => {
    const probe = session();
    await expect.poll(async () => (await probe.exec(`[ -e ${quote(folder)} ]`)).code, { timeout: 10_000 }).not.toBe(0);
  };

  describe(`${name} session cleanup`, () => {
    it("removes the temp folder when the session closes", async () => {
      const opened = session();
      const folder = await folderOf(opened);
      expect(folder).not.toBe("");
      opened.dispose();
      await removed(folder);
    });

    it("removes the temp folder when the connection hangs up", async () => {
      const opened = session();
      const folder = await folderOf(opened);
      await expect(opened.exec("kill -HUP $$")).rejects.toThrow(/Lost the connection/);
      await removed(folder);
    });
  });
}

const shell = findShell(machine.os === "windows");
if (shell) describeSessionCleanup("sh", shell, []);

describe("WSL", async () => {
  const ubuntu = (await new HostFactory(machine).distributions()).includes("Ubuntu");
  if (ubuntu) describeSessionCleanup("WSL (Ubuntu)", "wsl.exe", ["-d", "Ubuntu", "-e", "sh"]);
  else it.skip("needs the Ubuntu distribution", () => undefined);

  it.skipIf(!ubuntu)("opens a terminal in the repository's folder", async () => {
    const root = "/tmp/genbeya terminal's test";
    const host = new HostFactory(machine).connect({ kind: "wsl", distro: "Ubuntu", path: root });
    await host.run("mkdir", ["-p", root], { cwd: "/" });
    const { command, args } = await host.terminalCommand(root);
    const terminal = await machine.terminals!.open(command, args, { cols: 120, rows: 30 });
    onTestFinished(async () => {
      terminal.kill();
      await host.run("rm", ["-rf", root], { cwd: "/" });
      host.dispose();
    });
    let output = "";
    terminal.onData((data) => (output += data));
    const exit = new Promise<number>((resolve) => terminal.onExit(resolve));
    // The folder is printed in a form that differs from the typed command.
    terminal.write("pwd | tr a-z A-Z\r");
    await expect.poll(() => output, { timeout: 20_000 }).toContain("/TMP/GENBEYA TERMINAL'S TEST");
    terminal.write("exit\r");
    expect(await exit).toBe(0);
  });
});
describe.skipIf(!shell)("shell transport", () => {
  describeHost("ShellHost", async () => {
    const session = new ShellSession(machine.processes, shell!, [], "sh");
    const host = new ShellHost(session, (path) => ({ command: shell!, args: [], cwd: path }));
    const made = await host.run("sh", ["-c", "mktemp -d"], { cwd: "/" });
    const root = decodeLenient(made.stdout).trim();
    const sh = (script: string) => host.run("sh", ["-c", script], { cwd: root });
    const { onTestFinished } = await import("vitest");
    onTestFinished(async () => {
      await sh(`rm -rf ${quote(root)}`);
      host.dispose();
    });
    return {
      host,
      root,
      async put(relative, content) {
        await sh(`mkdir -p "$(dirname ${quote(relative)})" && printf '%s' ${quote(content)} > ${quote(relative)}`);
      },
      async link(target, relative) {
        return (await sh(`ln -s ${quote(target)} ${quote(relative)} && [ -L ${quote(relative)} ]`)).code === 0;
      },
      async names(relative) {
        return decodeLenient((await sh(`ls -A ${quote(relative)}`)).stdout)
          .split("\n")
          .filter(Boolean);
      },
    };
  });

  it("reports a closed session", async () => {
    const session = new ShellSession(machine.processes, shell!, [], "sh");
    session.dispose();
    await expect(session.exec("true")).rejects.toThrow("The connection to sh is closed.");
  });

  it("explains a machine that cannot be reached", async () => {
    const session = new ShellSession(machine.processes, "genbeya-no-such-program", [], "nowhere");
    await expect(session.exec("true")).rejects.toThrow(/Lost the connection to nowhere/);
  });
});

describe("printfFormat", () => {
  it("escapes everything printf or the shell would interpret", () => {
    expect(printfFormat(encodeText("a%b'\\\n"))).toBe("a\\045b\\047\\134\\012");
    expect(printfFormat(encodeText("-x"))).toBe("\\055x");
  });
});

describe("locations", () => {
  it("quotes values for sh", () => {
    expect(quote("it's")).toBe(`'it'\\''s'`);
  });

  it("maps WSL network folders to WSL locations", () => {
    expect(locationOfFolder("\\\\wsl.localhost\\Ubuntu\\home\\me")).toEqual({ kind: "wsl", distro: "Ubuntu", path: "/home/me" });
    expect(locationOfFolder("\\\\wsl$\\Debian")).toEqual({ kind: "wsl", distro: "Debian", path: "/" });
    expect(locationOfFolder("C:\\code")).toEqual({ kind: "local", path: "C:\\code" });
  });

  it("accepts well-formed locations and copies only known fields", () => {
    expect(validateLocation({ kind: "local", path: "C:\\x", extra: 1 })).toEqual({ kind: "local", path: "C:\\x" });
    expect(validateLocation({ kind: "ssh", host: "me@server", path: "/srv/repo" })).toEqual({
      kind: "ssh",
      host: "me@server",
      path: "/srv/repo",
    });
  });

  it.each([
    null,
    { kind: "local", path: "" },
    { kind: "wsl", distro: "-u root", path: "/x" },
    { kind: "ssh", host: "-oProxyCommand=evil", path: "/x" },
    { kind: "ssh", host: "a b", path: "/x" },
    { kind: "wsl", distro: "Ubuntu", path: "relative" },
    { kind: "local", path: "a\nb" },
    { kind: "ftp", path: "/x" },
  ])("rejects %j", (value) => {
    expect(() => validateLocation(value)).toThrow();
  });

  it("accepts remote folders to browse, including the home folder", () => {
    for (const path of ["", "~", "~/code", "/srv"])
      expect(validateFolderLocation({ kind: "wsl", distro: "Ubuntu", path, extra: 1 })).toEqual({ kind: "wsl", distro: "Ubuntu", path });
  });

  it.each([
    [{ kind: "local", path: "C:\\" }, "folder dialog"],
    [{ kind: "wsl", distro: "Ubuntu", path: "relative" }, "absolute path"],
    [{ kind: "wsl", distro: "Ubuntu", path: "~me" }, "absolute path"],
    [{ kind: "ssh", host: "server", path: "/a\nb" }, "absolute path"],
    [{ kind: "wsl", distro: "-u root", path: "/" }, "Invalid"],
    [{ kind: "ssh", host: "-oProxyCommand=evil", path: "/" }, "Invalid"],
    [{ kind: "ssh", host: "server" }, "Invalid"],
    [null, "Invalid"],
  ])("refuses to browse %j", (value, message) => {
    expect(() => validateFolderLocation(value)).toThrow(message);
  });
});

describe("terminal commands of hosts", () => {
  it("start each host's shell in the repository", async () => {
    const factory = new HostFactory(machine);
    const hosts = [
      factory.connect({ kind: "wsl", distro: "Ubuntu", path: "/r" }),
      factory.connect({ kind: "ssh", host: "me@server", path: "/r" }),
      factory.connect({ kind: "local", path: "C:\\r" }),
    ];
    onTestFinished(() => hosts.forEach((host) => host.dispose()));
    const [wsl, ssh, local] = await Promise.all(hosts.map((host) => host.terminalCommand("/r")));
    expect(wsl).toEqual(wslTerminal("Ubuntu", "/r"));
    expect(ssh).toEqual(sshTerminal("me@server", "/r"));
    expect(local).toEqual(localTerminal(await machine.terminals!.shell(), "/r"));
  });

  it("explain that a runtime without terminals has none", async () => {
    await expect(new LocalHost({ ...machine, terminals: null }).terminalCommand("/r")).rejects.toThrow(
      "The terminal is not available in this build.",
    );
  });
});

it("HostError explains each failure", () => {
  expect(new HostError("SYMLINK", "a").message).toBe("a is behind a symbolic link, which Genbeya does not follow.");
  expect(new HostError("FAILED", "a", "detail").message).toBe("detail");
});
