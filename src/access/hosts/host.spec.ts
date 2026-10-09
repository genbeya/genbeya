import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { temporaryFolder } from "../../testing/temp";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import { HostError, type Host } from "./host";
import { locationOfFolder, validateLocation } from "./host-factory";
import { LocalHost } from "./local-host";
import { printfFormat, ShellHost } from "./shell-host";
import { quote, ShellSession } from "./shell-session";

const machine = nodeMachine();

/** A POSIX sh on this machine: /bin/sh, or Git for Windows' sh.exe. */
function findShell(): string | null {
  if (machine.os !== "windows") return "sh";
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const sh = path.resolve(execPath, "../../../usr/bin/sh.exe");
    return existsSync(sh) ? sh : null;
  } catch {
    return null;
  }
}

interface HostFixture {
  host: Host;
  root: string;
  /** Creates a file directly on the host's file system. */
  put(relative: string, content: string): Promise<void>;
  link(target: string, relative: string): Promise<boolean>;
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
  };
});

const shell = findShell();
describe.skipIf(!shell)("shell transport", () => {
  describeHost("ShellHost", async () => {
    const session = new ShellSession(machine.processes, shell!, [], "sh");
    const host = new ShellHost(session);
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
    };
  });

  it("reports a closed session", async () => {
    const session = new ShellSession(machine.processes, shell!, [], "sh");
    session.dispose();
    await expect(session.exec("true")).rejects.toThrow("The connection to sh is closed.");
  });

  it("explains a machine that cannot be reached", async () => {
    const session = new ShellSession(machine.processes, "gitdesk-no-such-program", [], "nowhere");
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
    expect(validateLocation({ kind: "ssh", host: "me@server", path: "/srv/repo" })).toEqual({ kind: "ssh", host: "me@server", path: "/srv/repo" });
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
});

it("HostError explains each failure", () => {
  expect(new HostError("SYMLINK", "a").message).toBe("a is behind a symbolic link, which GitDesk does not follow.");
  expect(new HostError("FAILED", "a", "detail").message).toBe("detail");
});
