/**
 * The working tree of an in-memory repository as a {@link Host}, so the
 * file stores of the access layer read and write it with their usual rules:
 * versions, size limits, and moves that refuse to replace. Folders exist
 * while they hold files, as in Git. Nothing runs here: there are no
 * processes and no terminals.
 */
import { posixPaths } from "../../utilities/native-path";
import { within } from "../../utilities/repository-path";
import { HostError, type EntryKind, type Host } from "../hosts/host";
import type { TerminalCommand } from "../hosts/terminal-commands";
import type { RunResult } from "../ports";
import { fileBytes, fileContent } from "./file-bytes";
import type { MemoryRepository } from "./memory-repository";

export class MemoryHost implements Host {
  readonly paths = posixPaths;

  constructor(private readonly repository: MemoryRepository) {}

  async run(command: string): Promise<RunResult> {
    return { code: 127, stdout: new Uint8Array(), stderr: `${command} can't run in the demo.` };
  }

  async read(_root: string, relative: string, limit: number): Promise<Uint8Array> {
    const content = this.repository.worktree.get(relative);
    if (content === undefined) throw new HostError(this.repository.kind(relative) ? "NOTFILE" : "ENOENT", relative);
    const data = fileBytes(content);
    if (data.length > limit) throw new HostError("TOOLARGE", relative);
    return data;
  }

  async readMany(root: string, relatives: readonly string[], limit: number): Promise<(Uint8Array | null)[]> {
    return Promise.all(relatives.map((relative) => this.read(root, relative, limit).catch(() => null)));
  }

  async write(_root: string, relative: string, data: Uint8Array, exclusive: boolean): Promise<void> {
    if (exclusive && this.repository.kind(relative)) throw new HostError("EXISTS", relative);
    if (this.repository.kind(relative) === "dir") throw new HostError("NOTFILE", relative);
    this.repository.write(relative, fileContent(data));
  }

  async kind(_root: string, relative: string): Promise<EntryKind> {
    return this.repository.kind(relative);
  }

  async remove(_root: string, relative: string): Promise<void> {
    if (!this.repository.worktree.has(relative)) throw new HostError(this.repository.kind(relative) ? "NOTFILE" : "ENOENT", relative);
    this.repository.remove(relative);
  }

  async move(_root: string, from: string, to: string): Promise<void> {
    const kind = this.repository.kind(from);
    if (!kind) throw new HostError("ENOENT", from);
    if (this.repository.kind(to)) throw new HostError("EXISTS", to);
    const files = [...this.repository.worktree].filter(([path]) => path === from || within(path, from));
    for (const [path] of files) this.repository.remove(path);
    for (const [path, content] of files) this.repository.write(to + path.slice(from.length), content);
  }

  /** Folders go once their last file went, so an empty folder is as good as removed. */
  async removeEmptyFolder(_root: string, relative: string): Promise<boolean> {
    return this.repository.kind(relative) === null;
  }

  async terminalCommand(): Promise<TerminalCommand> {
    throw new Error("The terminal isn't available in the demo.");
  }

  dispose(): void {
    // Nothing to let go of.
  }
}
