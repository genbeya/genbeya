/** Behaviour every Machine implementation must show; run by each platform's spec. */
import { describe, expect, it } from "vitest";
import { FileSystemError, type Machine } from "../access/ports";
import { decodeLenient, encodeText } from "../utilities/bytes";

export interface MachineFixture {
  machine: Machine;
  /** An empty folder, removed by the fixture afterwards. */
  folder(): Promise<string>;
  /** A command echoing its standard input to standard output, e.g. `node -e …`. */
  echo: { command: string; args: string[] };
  /** Creates a symbolic link or junction; false when the OS refuses (unprivileged Windows). */
  link(target: string, path: string): Promise<boolean>;
}

export function describeMachine(name: string, fixture: () => MachineFixture) {
  describe(`${name} file system`, () => {
    it("writes, reads, lists and stats files", async () => {
      const { machine, folder } = fixture();
      const { fileSystem: fs, paths } = machine;
      const root = await folder();
      const file = paths.join(root, "a.txt");
      await fs.writeFile(file, encodeText("hello"), false);
      expect(decodeLenient(await fs.readFile(file))).toBe("hello");
      expect(await fs.stat(file)).toEqual({ kind: "file", size: 5 });
      expect((await fs.lstat(root)).kind).toBe("dir");
      expect(await fs.list(root)).toEqual(["a.txt"]);
    });

    it("fails exclusive writes to existing files with EEXIST", async () => {
      const { machine, folder } = fixture();
      const file = machine.paths.join(await folder(), "a.txt");
      await machine.fileSystem.writeFile(file, encodeText("1"), true);
      await expect(machine.fileSystem.writeFile(file, encodeText("2"), true)).rejects.toMatchObject({ code: "EEXIST" });
    });

    it("reports missing entries as ENOENT FileSystemErrors", async () => {
      const { machine, folder } = fixture();
      const missing = machine.paths.join(await folder(), "missing");
      const failure = await machine.fileSystem.stat(missing).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(FileSystemError);
      expect(failure).toMatchObject({ code: "ENOENT" });
    });

    it("makes nested directories, renames and removes", async () => {
      const { machine, folder } = fixture();
      const { fileSystem: fs, paths } = machine;
      const root = await folder();
      await fs.makeDirectory(paths.join(root, "x", "y"));
      await fs.writeFile(paths.join(root, "x", "y", "f"), encodeText(""), false);
      await fs.rename(paths.join(root, "x"), paths.join(root, "z"));
      await fs.removeFile(paths.join(root, "z", "y", "f"));
      await fs.removeDirectory(paths.join(root, "z", "y"));
      expect(await fs.list(paths.join(root, "z"))).toEqual([]);
    });

    it("reports links without following them", async () => {
      const { machine, folder, link } = fixture();
      const root = await folder();
      await machine.fileSystem.makeDirectory(machine.paths.join(root, "target"));
      if (!(await link(machine.paths.join(root, "target"), machine.paths.join(root, "link")))) return;
      expect((await machine.fileSystem.lstat(machine.paths.join(root, "link"))).kind).toBe("symlink");
      expect((await machine.fileSystem.stat(machine.paths.join(root, "link"))).kind).toBe("dir");
    });
  });

  describe(`${name} processes`, () => {
    it("runs a program and collects its output and exit code", async () => {
      const { machine, folder } = fixture();
      const result = await machine.processes.run("git", ["--version"], { cwd: await folder() });
      expect(result.code).toBe(0);
      expect(decodeLenient(result.stdout)).toMatch(/^git version/);
    });

    it("passes the exit code and stderr of failing programs", async () => {
      const { machine, folder } = fixture();
      const result = await machine.processes.run("git", ["no-such-command"], { cwd: await folder() });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/not a git command/);
    });

    it("explains programs that cannot start", async () => {
      const { machine, folder } = fixture();
      const root = await folder();
      const missingProgram = await machine.processes.run("gitdesk-no-such-program", [], { cwd: root });
      expect(missingProgram).toMatchObject({ code: 127, stderr: "gitdesk-no-such-program was not found. Install it and add it to PATH." });
      const missingFolder = machine.paths.join(root, "missing");
      const result = await machine.processes.run("git", ["--version"], { cwd: missingFolder });
      expect(result).toMatchObject({ code: 127, stderr: `${missingFolder} does not exist.` });
    });

    it("streams standard input and output of spawned processes", async () => {
      const { machine, echo } = fixture();
      const child = machine.processes.spawn(echo.command, echo.args);
      const chunks: Uint8Array[] = [];
      const exited = new Promise<number>((resolve) => child.onExit(resolve));
      child.onStdout((chunk) => chunks.push(chunk));
      child.write(encodeText("ping\n"));
      child.end();
      expect(await exited).toBe(0);
      expect(chunks.map(decodeLenient).join("")).toBe("ping\n");
    });

    it("reports spawned programs that cannot start", async () => {
      const { machine } = fixture();
      const child = machine.processes.spawn("gitdesk-no-such-program", []);
      expect(await new Promise<number>((resolve) => child.onExit(resolve))).toBe(127);
    });
  });
}
