import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { HostError, type EntryKind, type Host, type RunOptions, type RunResult } from "./host.js";

export const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "never",
};

const LOCKED = ["EPERM", "EACCES", "EBUSY"];

/**
 * On Windows a folder cannot be renamed while another program watches it
 * (editors watching nested repositories, indexers). Retry briefly, then move
 * the folder's files one by one, which watchers do not block.
 */
async function moveEntry(source: string, target: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(source, target);
    } catch (error: any) {
      if (!LOCKED.includes(error.code)) throw error;
      if (attempt >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  if (!(await fs.stat(source)).isDirectory()) return fs.rename(source, target);
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source))
    await moveEntry(path.join(source, entry), path.join(target, entry));
  await fs.rmdir(source).catch(() => undefined);
}

/** The machine GitDesk runs on, through Node's file system and child processes. */
export class LocalHost implements Host {
  readonly posix = path.sep === "/";

  join(root: string, relative: string) {
    return path.join(root, ...relative.split("/"));
  }

  run(command: string, args: string[], { cwd, timeout = 60_000 }: RunOptions) {
    return new Promise<RunResult>((resolve) => {
      execFile(
        command,
        args,
        {
          cwd,
          timeout,
          encoding: "buffer",
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, ...GIT_ENV },
        },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { code?: unknown }) | null;
          resolve({
            code: !failure ? 0 : typeof failure.code === "number" ? failure.code : 127,
            stdout,
            stderr:
              stderr.toString("utf8") ||
              (failure?.code === "ENOENT"
                ? // Node reports a missing working directory as a missing program.
                  existsSync(cwd)
                  ? `${command} was not found. Install it and add it to PATH.`
                  : `${cwd} does not exist.`
                : (failure?.message ?? "")),
          });
        },
      );
    });
  }

  /** Rejects when any existing segment below the root is a symbolic link. */
  private async resolve(root: string, relative: string, creating: boolean) {
    let current = root;
    for (const segment of relative.split("/")) {
      current = path.join(current, segment);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new HostError("SYMLINK", relative);
      } catch (error: any) {
        if (error instanceof HostError) throw error;
        if (error.code !== "ENOENT") throw error;
        if (!creating) throw new HostError("ENOENT", relative);
      }
    }
    return current;
  }

  async read(root: string, relative: string, limit: number) {
    const file = await this.resolve(root, relative, false);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new HostError("NOTFILE", relative);
    if (stat.size > limit) throw new HostError("TOOLARGE", relative);
    return fs.readFile(file);
  }

  readMany(root: string, relatives: string[], limit: number) {
    return Promise.all(
      relatives.map((relative) =>
        this.read(root, relative, limit).catch(() => null),
      ),
    );
  }

  async write(root: string, relative: string, data: Buffer, exclusive: boolean) {
    const file = await this.resolve(root, relative, true);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // mkdir may race with an external link swap; check the chain again.
    await this.resolve(root, relative, true);
    try {
      await fs.writeFile(file, data, { flag: exclusive ? "wx" : "w" });
    } catch (error: any) {
      if (error.code === "EEXIST") throw new HostError("EXISTS", relative);
      throw error;
    }
  }

  async kind(root: string, relative: string): Promise<EntryKind> {
    try {
      const stat = await fs.stat(await this.resolve(root, relative, false));
      return stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null;
    } catch (error) {
      if (error instanceof HostError && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(root: string, relative: string) {
    const file = await this.resolve(root, relative, false);
    if (!(await fs.stat(file)).isFile()) throw new HostError("NOTFILE", relative);
    await fs.unlink(file);
  }

  async move(root: string, from: string, to: string) {
    const source = await this.resolve(root, from, false);
    const target = await this.resolve(root, to, true);
    if (await this.kind(root, to)) throw new HostError("EXISTS", to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await moveEntry(source, target);
  }

  dispose() {}
}
