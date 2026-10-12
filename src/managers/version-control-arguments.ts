/**
 * Checks of what the client passes to version control calls, shared by the
 * version control manager and the web demo's, so both refuse the same input
 * in the same words. Checks that need the repository (does the branch
 * exist?) stay with each manager.
 */
import {
  CHANGE_BASES,
  REBASE_ACTIONS,
  RESET_MODES,
  type ChangeBase,
  type ConflictResolution,
  type DiffSource,
  type LinePatch,
  type LineRange,
  type MergeOptions,
  type PushRequest,
  type RebaseStep,
  type ResetMode,
  type StashOptions,
  type SyncAction,
} from "../contracts/model";
import { TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { REBASE_LIMIT } from "../access/git/operation-access";

const SYNC_ACTIONS: readonly SyncAction[] = ["fetch", "pull", "push"];
const LINE_RANGE_LIMIT = 10_000;
const MESSAGE_LIMIT = 20_000;
const STASH_MESSAGE_LIMIT = 500;
const HISTORY_PAGE_LIMIT = 1000;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * `name`, unless it or one of its parts starts with "-": Git could read it
 * as an option, and switching to a remote branch `origin/-x` names the new
 * local branch `-x`. Git allows such refs, and a clone may bring them.
 */
export function plainRef(name: string): string {
  if (/(^|\/)-/.test(name)) throw new Error(`"${name}" looks like an option to Git. Rename or delete it in a terminal.`);
  return name;
}

/** A branch or tag name as far as it can be told without Git: Git's own rules come after. */
export function refName(value: unknown, kind: "branch" | "tag"): string {
  if (typeof value !== "string" || !value || value.length > 200 || value.startsWith("-")) throw new Error(`Invalid ${kind} name.`);
  return value;
}

/** What staged changes are compared with; HEAD unless given. */
export function changeBase(value: unknown): ChangeBase {
  if (value === undefined || value === null) return "head";
  if (!CHANGE_BASES.includes(value as ChangeBase)) throw new Error("Invalid comparison base.");
  return value as ChangeBase;
}

export function diffSource(value: unknown): DiffSource {
  if (value !== "worktree" && value !== "index" && !isCommitId((value as { commit?: unknown } | null)?.commit))
    throw new Error("Invalid diff source.");
  return value === "worktree" || value === "index" ? value : { commit: (value as { commit: string }).commit };
}

function lineRanges(value: unknown): LineRange[] {
  if (!Array.isArray(value) || value.length > LINE_RANGE_LIMIT) throw new Error("Invalid line selection.");
  return value.map((range) => {
    const { from, to } = (range ?? {}) as Partial<Record<string, unknown>>;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || (from as number) < 1 || (to as number) < (from as number))
      throw new Error("Invalid line selection.");
    return { from: from as number, to: to as number };
  });
}

/** Lines to stage, unstage or discard; `path` validates repository paths. */
export function linePatch(value: unknown, path: (value: unknown) => string): LinePatch {
  const { path: relative, oldPath, version, lines } = (value ?? {}) as Partial<Record<string, unknown>>;
  const checked = path(relative);
  if (typeof version !== "string" || !/^[0-9a-f]{64}$/.test(version)) throw new Error("Invalid diff version.");
  const { original, modified } = (lines ?? {}) as Partial<Record<string, unknown>>;
  return {
    path: checked,
    ...(oldPath === undefined || oldPath === null ? {} : { oldPath: path(oldPath) }),
    version,
    lines: { original: lineRanges(original), modified: lineRanges(modified) },
  };
}

export function commitMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LIMIT) throw new Error("Write a commit message first.");
  return message.trim();
}

/** A page of the history: how many commits to skip, and how many to list. */
export function historyRange(skip: unknown, limit: unknown): { skip: number; limit: number } {
  if (
    !Number.isInteger(skip) ||
    !Number.isInteger(limit) ||
    (skip as number) < 0 ||
    (limit as number) < 1 ||
    (limit as number) > HISTORY_PAGE_LIMIT
  )
    throw new Error("Invalid history range.");
  return { skip: skip as number, limit: limit as number };
}

export function tagMessage(message: unknown): string {
  if (typeof message !== "string" || message.length > MESSAGE_LIMIT) throw new Error("Invalid tag message.");
  return message.trim();
}

export function syncAction(action: unknown): SyncAction {
  if (!SYNC_ACTIONS.includes(action as SyncAction)) throw new Error("Invalid action.");
  return action as SyncAction;
}

/** A push request's `force`: none, or the commit the lease expects (null: no branch) and whether the default branch may go. */
export function pushForce(force: unknown): PushRequest["force"] {
  if (force === undefined || force === null) return undefined;
  const { expected, defaultBranch } = (typeof force === "object" ? force : {}) as Partial<Record<string, unknown>>;
  if ((expected !== null && !isCommitId(expected)) || typeof defaultBranch !== "boolean") throw new Error("Invalid push.");
  return { expected, defaultBranch };
}

/** A remote's name and URL. */
export function remoteDefinition(name: unknown, url: unknown): { name: string; url: string } {
  if (typeof name !== "string" || !REMOTE_NAME.test(name))
    throw new Error("Remote names use letters, digits, dots, dashes and underscores.");
  if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
    throw new Error("Enter a valid remote URL or path.");
  return { name, url: url.trim() };
}

export function stashOptions(options: unknown): StashOptions {
  const { message, includeUntracked, keepIndex } = (options ?? {}) as Partial<Record<string, unknown>>;
  if (typeof message !== "string" || message.length > STASH_MESSAGE_LIMIT || /[\r\n\0]/.test(message))
    throw new Error("Stash messages are one line of up to 500 characters.");
  return { message: message.trim(), includeUntracked: includeUntracked === true, keepIndex: keepIndex === true };
}

export function mergeOptions(options: unknown): MergeOptions {
  const { noFastForward, message } = (options ?? {}) as Partial<Record<string, unknown>>;
  if (typeof message !== "string" || message.length > MESSAGE_LIMIT) throw new Error("Invalid merge message.");
  return { noFastForward: noFastForward === true, message: message.trim() };
}

export function rebaseSteps(steps: unknown): RebaseStep[] {
  if (!Array.isArray(steps) || !steps.length || steps.length > REBASE_LIMIT) throw new Error("Invalid rebase steps.");
  return steps.map((value) => {
    const { hash, action, message } = (value ?? {}) as Partial<Record<string, unknown>>;
    if (!isCommitId(hash) || !REBASE_ACTIONS.includes(action as RebaseStep["action"])) throw new Error("Invalid rebase steps.");
    if (message !== undefined && (typeof message !== "string" || message.length > MESSAGE_LIMIT))
      throw new Error("Invalid commit message.");
    return { hash, action: action as RebaseStep["action"], ...(message === undefined ? {} : { message }) };
  });
}

export function resetMode(mode: unknown): ResetMode {
  if (!RESET_MODES.includes(mode as ResetMode)) throw new Error("Invalid reset mode.");
  return mode as ResetMode;
}

/** The state a hard or keep reset expects, from its plan. */
export function resetState(state: unknown): string {
  if (typeof state !== "string" || !/^[0-9a-f]{64}$/.test(state)) throw new Error("Invalid reset state.");
  return state;
}

export function conflictResolution(resolution: unknown): ConflictResolution {
  const { use, text } = (resolution ?? {}) as Partial<Record<string, unknown>>;
  if (use === "text" && typeof text === "string" && text.length <= TEXT_LIMIT) return { use, text };
  if (use === "ours" || use === "theirs" || use === "worktree" || use === "delete") return { use };
  throw new Error("Invalid resolution.");
}
