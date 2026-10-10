/** The machine GitDesk runs on, through the runtime's file system and processes. */
import { hasCode, type Machine, type RunOptions } from "../ports";
import { GIT_ENVIRONMENT, HostError, TERMINALS_UNAVAILABLE, type EntryKind, type Host } from "./host";
import { localTerminal } from "./terminal-commands";

const MOVE_ATTEMPTS = 3;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LocalHost implements Host {
  readonly paths;

  constructor(private readonly machine: Machine) {
    this.paths = machine.paths;
  }

  run(command: string, args: readonly string[], options: RunOptions) {
    return this.machine.processes.run(command, args, { ...options, env: { ...GIT_ENVIRONMENT, ...options.env } });
  }

  /** The absolute path of `relative`; rejects when an existing segment is a link. */
  private async resolve(root: string, relative: string, creating: boolean): Promise<string> {
    let current = root;
    for (const segment of relative.split("/")) {
      current = this.paths.join(current, segment);
      try {
        if ((await this.machine.fileSystem.lstat(current)).kind === "symlink") throw new HostError("SYMLINK", relative);
      } catch (error) {
        if (error instanceof HostError) throw error;
        if (!hasCode(error, "ENOENT")) throw error;
        if (!creating) throw new HostError("ENOENT", relative);
      }
    }
    return current;
  }

  async read(root: string, relative: string, limit: number) {
    const file = await this.resolve(root, relative, false);
    const stat = await this.machine.fileSystem.stat(file);
    if (stat.kind !== "file") throw new HostError("NOTFILE", relative);
    if (stat.size > limit) throw new HostError("TOOLARGE", relative);
    return this.machine.fileSystem.readFile(file);
  }

  readMany(root: string, relatives: readonly string[], limit: number) {
    return Promise.all(relatives.map((relative) => this.read(root, relative, limit).catch(() => null)));
  }

  async write(root: string, relative: string, data: Uint8Array, exclusive: boolean) {
    const file = await this.resolve(root, relative, true);
    await this.machine.fileSystem.makeDirectory(this.paths.dirname(file));
    // Creating folders may race with an external link swap; check the chain again.
    await this.resolve(root, relative, true);
    try {
      await this.machine.fileSystem.writeFile(file, data, exclusive);
    } catch (error) {
      if (hasCode(error, "EEXIST")) throw new HostError("EXISTS", relative);
      throw error;
    }
  }

  async kind(root: string, relative: string): Promise<EntryKind> {
    try {
      const { kind } = await this.machine.fileSystem.stat(await this.resolve(root, relative, false));
      return kind === "dir" || kind === "file" ? kind : null;
    } catch (error) {
      if (error instanceof HostError && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(root: string, relative: string) {
    const file = await this.resolve(root, relative, false);
    if ((await this.machine.fileSystem.stat(file)).kind !== "file") throw new HostError("NOTFILE", relative);
    await this.machine.fileSystem.removeFile(file);
  }

  async move(root: string, from: string, to: string) {
    const source = await this.resolve(root, from, false);
    const target = await this.resolve(root, to, true);
    if (await this.kind(root, to)) {
      if (!(await this.isSameEntry(source, target))) throw new HostError("EXISTS", to);
      // A rename by case only; through a temporary name, which every file system carries out.
      const temporary = `${source}.gitdesk-${crypto.randomUUID()}`;
      await this.moveEntry(source, temporary);
      return this.moveEntry(temporary, target);
    }
    await this.machine.fileSystem.makeDirectory(this.paths.dirname(target));
    await this.moveEntry(source, target);
  }

  /** True when `target` reaches `source` only because the file system ignores case. */
  private async isSameEntry(source: string, target: string): Promise<boolean> {
    if (source.toLowerCase() !== target.toLowerCase()) return false;
    // A file system that tells the names apart lists the target under its own name.
    const name = target.slice(target.lastIndexOf(this.paths.separator) + 1);
    return !(await this.machine.fileSystem.list(this.paths.dirname(target))).includes(name);
  }

  /**
   * On Windows a folder cannot be renamed while another program watches it
   * (editors, indexers). Retry briefly, then move its entries one by one,
   * which watchers do not block. Links are entries too: moving what they
   * point to would empty folders elsewhere.
   */
  private async moveEntry(source: string, target: string): Promise<void> {
    const fs = this.machine.fileSystem;
    for (let attempt = 1; ; attempt++) {
      try {
        return await fs.rename(source, target);
      } catch (error) {
        if (!hasCode(error, "EPERM", "EACCES", "EBUSY")) throw error;
        if (attempt >= MOVE_ATTEMPTS) break;
        await pause(100 * attempt);
      }
    }
    if ((await fs.lstat(source)).kind !== "dir") return fs.rename(source, target);
    await fs.makeDirectory(target);
    for (const entry of await fs.list(source)) await this.moveEntry(this.paths.join(source, entry), this.paths.join(target, entry));
    await fs.removeDirectory(source).catch(() => undefined);
  }

  async terminalCommand(path: string) {
    if (!this.machine.terminals) throw new Error(TERMINALS_UNAVAILABLE);
    return localTerminal(await this.machine.terminals.shell(), path);
  }

  dispose() {
    // Nothing to release: every call opens and closes its own resources.
  }
}
