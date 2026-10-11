/** Runs git in one working tree with settings that keep app-issued commands predictable. */
import type { Change, Head, OperationOutcome } from "../../contracts/model";
import { decodeLenient } from "../../utilities/bytes";
import { compareVersions, type Version } from "../../utilities/version";
import type { Host } from "../hosts/host";
import type { RunResult } from "../ports";
import { parseGitVersion, parseStatus } from "./git-parsers";

export class GitError extends Error {}

/** How long fetches and pushes may take. */
export const NETWORK_TIMEOUT = 5 * 60_000;

/** A failed command as a {@link GitError} with git's message, which some commands ("nothing to commit") print to stdout. */
export const failure = (args: readonly string[], result: RunResult): GitError =>
  new GitError(
    result.stderr.replace(/^(fatal|error): /gm, "").trim() ||
      decodeLenient(result.stdout.subarray(0, 2000)).trim() ||
      `git ${args[0]} failed with exit code ${result.code}.`,
  );

export interface GitOptions {
  /** Milliseconds; 60 s unless given. */
  readonly timeout?: number;
  /** Added to git's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Leaves out `--literal-pathspecs`, for commands that take no paths but
   * use pathspec magic themselves, such as `stash push --include-untracked`.
   */
  readonly pathspecMagic?: boolean;
}

export class Git {
  private versionRead: Promise<Version | null> | null = null;

  constructor(
    readonly host: Host,
    readonly cwd: string,
  ) {}

  /**
   * Opening a repository must not run programs its configuration names, so
   * hooks and the file system monitor (which `git status` would start) are
   * off. Filters, merge drivers, signing programs, credential helpers and
   * `core.sshCommand` still run on add, commit, fetch and push, as they do
   * in a terminal.
   */
  private args(args: readonly string[], pathspecMagic = false): string[] {
    return [
      // Paths are never globs. check-ignore takes plain paths and refuses the flag.
      ...(pathspecMagic || args[0] === "check-ignore" ? [] : ["--literal-pathspecs"]),
      "-c",
      "core.quotepath=false",
      "-c",
      "color.ui=false",
      "-c",
      `core.hooksPath=${this.host.paths.separator === "/" ? "/dev/null" : "NUL"}`,
      "-c",
      "core.fsmonitor=false",
      ...args,
    ];
  }

  /** The finished process, whatever its exit code. */
  run(args: readonly string[], timeout?: number): Promise<RunResult> {
    return this.execute(args, { timeout });
  }

  /** Like {@link run}, with more options. */
  execute(args: readonly string[], { timeout, env, pathspecMagic }: GitOptions): Promise<RunResult> {
    return this.host.run("git", this.args(args, pathspecMagic), {
      cwd: this.cwd,
      ...(timeout ? { timeout } : {}),
      ...(env ? { env } : {}),
    });
  }

  async bytes(args: readonly string[], timeout?: number): Promise<Uint8Array> {
    return this.check(args, await this.run(args, timeout));
  }

  /** The output of a successful command; a failure becomes a {@link GitError} with git's message. */
  private check(args: readonly string[], result: RunResult): Uint8Array {
    if (result.code !== 0) throw failure(args, result);
    return result.stdout;
  }

  /**
   * Runs a command that may stop for conflicts, such as a merge: a failure
   * is "stopped" when `stopped` finds what is left to resolve, else an error.
   */
  async outcome(args: readonly string[], stopped: () => Promise<boolean>, options: GitOptions = {}): Promise<OperationOutcome> {
    const result = await this.execute(args, options);
    if (result.code === 0) return "done";
    if (await stopped()) return "stopped";
    throw failure(args, result);
  }

  async text(args: readonly string[], timeout?: number): Promise<string> {
    return decodeLenient(await this.bytes(args, timeout));
  }

  /** Like {@link text}, with more options. */
  async output(args: readonly string[], options: GitOptions): Promise<string> {
    return decodeLenient(this.check(args, await this.execute(args, options)));
  }

  /** Like {@link text}, but null instead of an error. */
  async attempt(args: readonly string[]): Promise<string | null> {
    const result = await this.run(args);
    return result.code === 0 ? decodeLenient(result.stdout) : null;
  }

  async lines(args: readonly string[]): Promise<string[]> {
    return (await this.text(args)).split("\n").filter(Boolean);
  }

  /** Tracked and untracked files that exist and are not ignored. */
  async files(): Promise<string[]> {
    const [listed, deleted] = await Promise.all([
      this.text(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      this.text(["ls-files", "-z", "--deleted"]),
    ]);
    const gone = new Set(deleted.split("\0"));
    return [...new Set(listed.split("\0"))].filter((path) => path && !gone.has(path));
  }

  /** Branch state and changes from one `git status` call. */
  async status(): Promise<{ head: Head; changes: Change[] }> {
    return parseStatus(await this.text(["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]));
  }

  async config(key: string): Promise<string | null> {
    return (await this.attempt(["config", "--get", key]))?.trim() || null;
  }

  /** The version of git on the host, read once; null when it cannot be read. */
  version(): Promise<Version | null> {
    this.versionRead ??= this.attempt(["version"]).then((output) => (output === null ? null : parseGitVersion(output)));
    return this.versionRead;
  }

  /** Whether git on the host is `minimum` or newer, for options older versions lack. */
  async supports(minimum: Version): Promise<boolean> {
    const version = await this.version();
    return version !== null && compareVersions(version, minimum) >= 0;
  }

  async hasRef(ref: string): Promise<boolean> {
    return (await this.attempt(["rev-parse", "--verify", "--quiet", ref])) !== null;
  }

  /** The object ID `spec` (such as `HEAD:path`) names; null when it names nothing. Other failures throw. */
  async objectId(spec: string): Promise<string | null> {
    const result = await this.run(["rev-parse", "--verify", "--quiet", spec]);
    // With --quiet, "no such object" is exit code 1; git's own failures are 128.
    if (result.code === 1) return null;
    return decodeLenient(this.check(["rev-parse"], result)).trim();
  }
}
