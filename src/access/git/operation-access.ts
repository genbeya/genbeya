/**
 * Operations that can stop for conflicts — merges, rebases, cherry-picks
 * and reverts — what is in progress, and resolving conflicted files.
 * Callers validate refs, commits and paths.
 */
import type { ConflictFile, ConflictResolution, MergeOptions, Operation, OperationOutcome } from "../../contracts/model";
import { decodeLenient, encodeText, isBinary } from "../../utilities/bytes";
import { TEXT_LIMIT } from "../files/file-store";
import { isMissing, isTooLarge, type Host } from "../hosts/host";
import { GitError, type Git } from "./git";
import { OPERATION_FILES, parseOperation, type OperationFiles } from "./git-parsers";

/** The operation files are small; a larger one is not git's. */
const OPERATION_FILE_LIMIT = 64 * 1024;

export class OperationAccess {
  private gitDirectory: Promise<string> | null = null;

  constructor(
    private readonly host: Host,
    private readonly root: string,
    private readonly git: Git,
  ) {}

  /** The absolute git directory of the working tree (a linked worktree has its own). */
  gitDir(): Promise<string> {
    this.gitDirectory ??= this.git.text(["rev-parse", "--absolute-git-dir"]).then(
      (path) => path.trim(),
      (error: unknown) => {
        this.gitDirectory = null;
        throw error;
      },
    );
    return this.gitDirectory;
  }

  /** What is in progress; merges, picks and reverts go into `branch`. */
  async current(branch: string | null): Promise<Operation | null> {
    const contents = await this.host.readMany(await this.gitDir(), OPERATION_FILES, OPERATION_FILE_LIMIT);
    const files: OperationFiles = {};
    OPERATION_FILES.forEach((name, i) => {
      const content = contents[i];
      if (content) files[name] = decodeLenient(content);
    });
    const operation = parseOperation(files, branch);
    if (operation?.kind !== "rebase" || !operation.target) return operation;
    return { ...operation, target: await this.nameOf(operation.target) };
  }

  /** A branch or tag pointing at `hash`, else its short form. */
  private async nameOf(hash: string): Promise<string> {
    const [name] = await this.git.lines([
      "for-each-ref",
      `--points-at=${hash}`,
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]);
    return name ?? hash.slice(0, 7);
  }

  async conflictedPaths(): Promise<string[]> {
    return (await this.git.status()).changes.filter((change) => change.conflict).map((change) => change.path);
  }

  async conflicted(): Promise<boolean> {
    return (await this.conflictedPaths()).length > 0;
  }

  /** True when a failed command left conflicts or an operation in progress. */
  private readonly stopped = async () => (await this.conflicted()) || (await this.current(null)) !== null;

  merge(ref: string, { noFastForward, message }: MergeOptions): Promise<OperationOutcome> {
    return this.git.outcome(
      ["merge", "--no-edit", ...(noFastForward ? ["--no-ff"] : []), ...(message ? ["--message", message] : []), ref],
      this.stopped,
    );
  }

  /** Continues once the conflicts are resolved; "stopped" when the next commit conflicts. */
  async continue(): Promise<OperationOutcome> {
    const operation = await this.require();
    const left = (await this.conflictedPaths()).length;
    if (left) throw new GitError(`Resolve the ${left === 1 ? "conflicted file" : `${left} conflicted files`} first.`);
    // A failure without new conflicts, such as nothing left to commit, is git's to explain.
    return this.git.outcome([operation.kind, "--continue"], () => this.conflicted());
  }

  async skip(): Promise<OperationOutcome> {
    const operation = await this.require();
    if (operation.kind === "merge") throw new GitError("A merge cannot skip anything. Abort it instead.");
    return this.git.outcome([operation.kind, "--skip"], () => this.conflicted());
  }

  async abort(): Promise<void> {
    await this.git.text([(await this.require()).kind, "--abort"]);
  }

  private async require(): Promise<Operation> {
    const operation = await this.current(null);
    if (!operation) throw new GitError("No merge, rebase, cherry-pick or revert is in progress.");
    return operation;
  }

  async conflict(path: string): Promise<ConflictFile> {
    const change = (await this.git.status()).changes.find((entry) => entry.path === path && entry.conflict);
    if (!change?.conflict) throw new GitError(`${path} has no conflicts.`);
    return { path, kind: change.conflict, text: await this.text(path) };
  }

  /** The working-tree file as text; null when it is missing, binary or too large. */
  private async text(path: string): Promise<string | null> {
    try {
      const data = await this.host.read(this.root, path, TEXT_LIMIT);
      return isBinary(data) ? null : decodeLenient(data);
    } catch (error) {
      if (isMissing(error) || isTooLarge(error)) return null;
      throw error;
    }
  }

  async resolve(path: string, resolution: ConflictResolution): Promise<void> {
    switch (resolution.use) {
      case "ours":
      case "theirs":
        return this.take(path, resolution.use);
      case "worktree":
        return void (await this.git.text(["add", "-A", "--", path]));
      case "delete":
        return void (await this.git.text(["rm", "--quiet", "--force", "--", path]));
      case "text":
        await this.host.write(this.root, path, encodeText(resolution.text), false);
        await this.git.text(["add", "--", path]);
    }
  }

  /** One side's version; when that side deleted the file, the deletion. */
  private async take(path: string, side: "ours" | "theirs"): Promise<void> {
    // `ls-files --stage` lines: mode, object, stage, then a tab and the path. Stage 2 is ours, 3 theirs.
    const stage = side === "ours" ? "2" : "3";
    const entries = await this.git.lines(["ls-files", "--unmerged", "--", path]);
    if (!entries.some((entry) => entry.split("\t")[0]!.split(" ")[2] === stage))
      return void (await this.git.text(["rm", "--quiet", "--force", "--", path]));
    await this.git.text(["checkout", `--${side}`, "--", path]);
    await this.git.text(["add", "--", path]);
  }
}
