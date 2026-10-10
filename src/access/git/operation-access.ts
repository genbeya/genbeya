/**
 * Operations that can stop for conflicts — merges, rebases, cherry-picks
 * and reverts — what is in progress, and resolving conflicted files.
 * Callers validate refs, commits and paths; refs and commits still follow
 * `--end-of-options`, so a name a clone brought that starts with "-" is
 * never read as an option.
 */
import type { ConflictFile, ConflictResolution, MergeOptions, Operation, OperationOutcome, RebasePlan } from "../../contracts/model";
import type { RebaseTodo, TodoLine } from "../../contracts/rebase-todo";
import { decodeLenient, encodeText, isBinary } from "../../utilities/bytes";
import { TEXT_LIMIT } from "../files/file-store";
import { isMissing, isTooLarge, type Host } from "../hosts/host";
import { quote } from "../hosts/shell-session";
import { GitError, type Git } from "./git";
import { OPERATION_FILES, parseOperation, parseRebaseCommits, REBASE_FORMAT, type OperationFiles } from "./git-parsers";

/** The operation files are small; a larger one is not git's. */
const OPERATION_FILE_LIMIT = 64 * 1024;
/** Where the todo list and messages of an interactive rebase are prepared, in the git directory. */
const REBASE_FOLDER = "gitdesk-rebase";
/** Git's folder for the state of an interactive rebase, in the git directory; it goes when the rebase ends. */
const REBASE_STATE = "rebase-merge";
/** Rebases rewriting more commits than this are for the terminal. */
export const REBASE_LIMIT = 1000;

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

  /** True when conflicts or an operation in progress are left, as after a command that stopped. */
  readonly unfinished = async (): Promise<boolean> => (await this.conflicted()) || (await this.current(null)) !== null;

  merge(ref: string, { noFastForward, message }: MergeOptions): Promise<OperationOutcome> {
    return this.git.outcome(
      ["merge", "--no-edit", ...(noFastForward ? ["--no-ff"] : []), ...(message ? ["--message", message] : []), "--end-of-options", ref],
      this.unfinished,
    );
  }

  /**
   * The commits a rebase onto `base` rewrites (those HEAD has and `base` has
   * not), oldest first, and the remote branches that already have some.
   */
  async plan(base: string): Promise<RebasePlan> {
    const hash = (await this.git.text(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])).trim();
    const count = Number(await this.git.text(["rev-list", "--count", `${hash}..HEAD`]));
    if (count > REBASE_LIMIT) throw new GitError(`That rewrites ${count} commits; GitDesk rebases up to ${REBASE_LIMIT} at a time.`);
    const commits = parseRebaseCommits(await this.git.text(["log", "--reverse", `--format=${REBASE_FORMAT}`, `${hash}..HEAD`]));
    // History is linear from the oldest rewritten commit, so a branch with any of them has that one.
    const pushed = commits.length
      ? (await this.git.lines(["for-each-ref", `--contains=${commits[0]!.hash}`, "--format=%(refname:short)", "refs/remotes"])).filter(
          (ref) => !ref.endsWith("/HEAD"),
        )
      : [];
    return { base: hash, commits, pushed };
  }

  async isAncestorOfHead(commit: string): Promise<boolean> {
    return (await this.git.run(["merge-base", "--is-ancestor", "--end-of-options", commit, "HEAD"])).code === 0;
  }

  rebase(onto: string, autostash: boolean): Promise<OperationOutcome> {
    return this.git.outcome(["rebase", ...(autostash ? ["--autostash"] : []), "--end-of-options", onto], this.unfinished);
  }

  /**
   * Runs `git rebase -i` with a prepared todo list: git's sequence editor
   * moves the prepared folder into git's own rebase folder, which git removes
   * when the rebase ends or is aborted, and copies the list over the one git
   * wrote. New messages come from files, so no editor ever opens. Everything
   * goes through git's own sh, on every host.
   *
   * A message is amended only when the pick before it made a commit: one
   * skipped after a conflict, or dropped because it became empty, would
   * otherwise leave the previous commit to be amended.
   */
  async rebaseInteractive(base: string, { lines, messages }: RebaseTodo, autostash: boolean): Promise<OperationOutcome> {
    const gitDir = await this.gitDir();
    const folder = `${gitDir}/${REBASE_STATE}/${REBASE_FOLDER}`;
    const prepare = (name: string, text: string) => this.host.write(gitDir, `${REBASE_FOLDER}/${name}`, encodeText(text), false);
    for (const [index, message] of messages.entries()) await prepare(`message-${index}`, message);
    // The pick each amend belongs to; HEAD is recorded before it.
    const amended = new Set<number>();
    let picked = -1;
    lines.forEach((entry, index) => {
      if (entry.command === "pick") picked = index;
      else if (entry.command === "amend" && picked >= 0) amended.add(picked);
    });
    const before = (index: number) => quote(`${folder}/before-${index}`);
    picked = -1;
    const line = (entry: TodoLine, index: number) => {
      if (entry.command === "pick") picked = index;
      if (entry.command !== "amend")
        return (amended.has(index) ? `exec git rev-parse HEAD >${before(index)}\n` : "") + `${entry.command} ${entry.hash}`;
      const amend = `git commit --amend --allow-empty --no-verify --quiet --file=${quote(`${folder}/message-${entry.message}`)}`;
      return picked < 0 ? `exec ${amend}` : `exec test "$(git rev-parse HEAD)" = "$(cat ${before(picked)})" || ${amend}`;
    };
    await prepare("todo", lines.map(line).join("\n") + "\n");
    return this.git.outcome(["rebase", "--interactive", ...(autostash ? ["--autostash"] : []), "--end-of-options", base], this.unfinished, {
      env: {
        GIT_SEQUENCE_EDITOR: `mv ${quote(`${gitDir}/${REBASE_FOLDER}`)} ${quote(folder)} && cat ${quote(`${folder}/todo`)} >`,
      },
    });
  }

  /** Merge commits are left out: which parent to follow is a question for the terminal. */
  cherryPick(commit: string): Promise<OperationOutcome> {
    return this.git.outcome(["cherry-pick", "--end-of-options", commit], this.unfinished);
  }

  revert(commit: string): Promise<OperationOutcome> {
    return this.git.outcome(["revert", "--no-edit", "--end-of-options", commit], this.unfinished);
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
