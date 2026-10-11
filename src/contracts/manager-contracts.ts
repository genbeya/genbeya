/**
 * The service contracts of the managers. Clients reach them through a
 * transport (Electron IPC, a Deno binding or in-page calls under Tauri);
 * every argument is validated by the manager, never trusted.
 */
import type {
  AgentFile,
  AgentFileWrite,
  AgentTarget,
  ChangeBase,
  CommitDetail,
  Commit,
  ConflictFile,
  ConflictResolution,
  ContentArea,
  Diff,
  DiffSource,
  FileContent,
  FolderListing,
  ForcePushPlan,
  IgnoreKind,
  LinePatch,
  LinkUpdate,
  Location,
  MergeOptions,
  OpenedWorkspace,
  OperationOutcome,
  PageMove,
  People,
  Preferences,
  PushOutcome,
  PushPlan,
  PushRequest,
  RebasePlan,
  RebaseStep,
  RecentEntry,
  RemoteLocation,
  ResetMode,
  ResetPlan,
  ResetResult,
  Scope,
  SearchOptions,
  SearchResults,
  Settings,
  Snapshot,
  StashDetail,
  StashOptions,
  StorageMode,
  SyncAction,
  Task,
  TaskActivity,
  TaskInput,
  TaskTemplate,
  TerminalOutput,
} from "./model";

/** Opening, closing and observing repositories; the user's recent list and preferences. */
export interface WorkspaceManagerContract {
  open(location: Location): Promise<OpenedWorkspace>;
  /** Reopens the repository requested at launch or, if the preference allows, the last one. */
  restore(launchArgs: readonly string[]): Promise<OpenedWorkspace | null>;
  clone(url: string, parent: Location): Promise<OpenedWorkspace>;
  /** Creates a sample repository to try GitDesk with in a new folder below `parent`, and opens it. */
  createSample(parent: Location): Promise<OpenedWorkspace>;
  close(workspace: string): Promise<void>;
  /**
   * Resolves to null when nothing changed since `since`. With `base`
   * "parent", staged changes are compared with HEAD's parent, for amending.
   */
  snapshot(workspace: string, since?: string, base?: ChangeBase): Promise<Snapshot | null>;
  recent(): Promise<readonly RecentEntry[]>;
  forget(location: Location): Promise<void>;
  preferences(): Promise<Preferences>;
  setPreferences(change: Partial<Preferences>): Promise<Preferences>;
  /** WSL distributions on this machine; empty elsewhere. */
  distributions(): Promise<readonly string[]>;
  /**
   * The subfolders of a folder on WSL or SSH, for choosing a path there. An
   * empty path, or one starting with `~`, is relative to the home folder.
   */
  browse(location: RemoteLocation): Promise<FolderListing>;
}

/** Everything that edits files: repository files, wiki pages, tasks, settings and the files that teach coding agents to use them. */
export interface ContentManagerContract {
  read(workspace: string, scope: Scope, path: string): Promise<FileContent>;
  /** An image as a data URL, for showing inside pages. */
  image(workspace: string, scope: Scope, path: string): Promise<string>;
  /** `expectedHash` is the version the edit is based on, or null for a new file. */
  write(workspace: string, scope: Scope, path: string, content: string, expectedHash: string | null): Promise<FileContent>;
  remove(workspace: string, scope: Scope, path: string): Promise<void>;
  createPage(workspace: string, path: string): Promise<FileContent>;
  /** The links that moving a page with its subpages would rewrite. */
  pageLinks(workspace: string, from: string, to: string): Promise<readonly LinkUpdate[]>;
  /** Moves a page together with its subpages, in one commit with the link updates if asked; resolves to the new path. */
  movePage(workspace: string, from: string, to: string, options?: PageMove): Promise<string>;
  deletePage(workspace: string, path: string): Promise<void>;
  createTask(workspace: string, input: TaskInput): Promise<Task>;
  updateTask(workspace: string, path: string, input: TaskInput, expectedHash: string): Promise<Task>;
  deleteTask(workspace: string, path: string): Promise<void>;
  /** What a new task of `type` starts with, from the type's template; null without one. */
  taskTemplate(workspace: string, type: string): Promise<TaskTemplate | null>;
  /** The template file of `type`, created with an outline when missing; resolves to its path. */
  ensureTaskTemplate(workspace: string, type: string): Promise<string>;
  /**
   * Who changed the task and how, newest first, from the Git history of its
   * file, following moves between epics. Edits not committed yet come first.
   */
  taskActivity(workspace: string, path: string): Promise<readonly TaskActivity[]>;
  /** The name new comments are signed with: Git's user name in the repository. */
  commentAuthor(workspace: string): Promise<string>;
  /** Appends a comment to the task's file, whatever else changed in it meanwhile. */
  addComment(workspace: string, path: string, text: string): Promise<Task>;
  /** Changes one of the user's own comments; `index` counts the comments of the version `expectedHash`. */
  editComment(workspace: string, path: string, index: number, text: string, expectedHash: string): Promise<Task>;
  deleteComment(workspace: string, path: string, index: number, expectedHash: string): Promise<Task>;
  saveSettings(workspace: string, settings: Settings, expectedHash: string | null): Promise<void>;
  /**
   * Keeps one area (wiki, tasks or settings) in the checkout, or on the
   * content branch shared by all code branches. The area's files move along.
   */
  setStorage(workspace: string, area: ContentArea, mode: StorageMode): Promise<void>;
  /** Exchanges the edits on the content branch with its remote. */
  syncContent(workspace: string): Promise<void>;
  /** Every agent file and whether the checkout has it, generated as if `targets` were added (they refer to each other). */
  agentFiles(workspace: string, targets: readonly AgentTarget[]): Promise<readonly AgentFile[]>;
  /** Writes the agent files of `targets` into the checkout, leaving text outside GitDesk's blocks alone. */
  addAgentFiles(workspace: string, targets: readonly AgentTarget[]): Promise<readonly AgentFileWrite[]>;
  /**
   * Finds `text` inside pages, tasks and code: tracked and untracked files
   * that .gitignore does not exclude, binary files skipped. Literal and
   * ignoring case unless `options` say otherwise; bounded in files, matches
   * per file and line length.
   */
  search(workspace: string, text: string, options?: SearchOptions): Promise<SearchResults>;
  /**
   * The people of the repository, for `@mentions` and assignees: recent
   * commit authors (with .mailmap applied), assignees and comment authors,
   * merged with the people the settings list.
   */
  people(workspace: string): Promise<People>;
}

/** Staging, committing, history, branches and remotes of the checked-out repository. */
export interface VersionControlManagerContract {
  /** The index is compared with `base` (HEAD unless given). */
  diff(workspace: string, path: string, source: DiffSource, oldPath?: string, base?: ChangeBase): Promise<Diff>;
  stage(workspace: string, paths: readonly string[]): Promise<void>;
  /**
   * Compared with `parent` while amending, the paths get their version in
   * HEAD's parent back, which leaves their changes out of the amended commit.
   */
  unstage(workspace: string, paths: readonly string[], base?: ChangeBase): Promise<void>;
  /** Reverts working-tree edits to the staged version and deletes untracked files. */
  discard(workspace: string, paths: readonly string[]): Promise<void>;
  /** Stages lines of a working-tree diff; parts of an untracked file add it with just those lines. */
  stageLines(workspace: string, patch: LinePatch): Promise<void>;
  /** Unstages lines of the index's diff against `base` (HEAD unless given). */
  unstageLines(workspace: string, patch: LinePatch, base?: ChangeBase): Promise<void>;
  /** Reverts lines of a working-tree diff to the staged version. */
  discardLines(workspace: string, patch: LinePatch): Promise<void>;
  /** Adds the rule of `kind` for `path` to the .gitignore in the folder `location` ("" for the root), creating it if needed. */
  ignore(workspace: string, path: string, kind: IgnoreKind, location: string): Promise<void>;
  /** Removes files or folders from the index, keeping them in the working tree: the next commit deletes them. */
  untrack(workspace: string, paths: readonly string[]): Promise<void>;
  commit(workspace: string, message: string, amend: boolean): Promise<void>;
  lastCommitMessage(workspace: string): Promise<string>;
  log(workspace: string, skip: number, limit: number): Promise<readonly Commit[]>;
  commitDetail(workspace: string, hash: string): Promise<CommitDetail>;
  switchBranch(workspace: string, name: string): Promise<void>;
  /** Starts at `start` (a branch, tag or commit; HEAD when omitted) and switches to it unless `checkout` is false. */
  createBranch(workspace: string, name: string, start?: string, checkout?: boolean): Promise<void>;
  renameBranch(workspace: string, name: string, newName: string): Promise<void>;
  /** Resolves to false, deleting nothing, when the branch is not fully merged and `force` is false. */
  deleteBranch(workspace: string, name: string, force: boolean): Promise<boolean>;
  /** Deletes a branch such as `origin/feature` on its remote. */
  deleteRemoteBranch(workspace: string, name: string): Promise<void>;
  /** Makes `branch` track the remote branch `upstream`, such as `origin/main`. */
  setUpstream(workspace: string, branch: string, upstream: string): Promise<void>;
  /** An annotated tag when `message` is not empty, else a lightweight one. */
  createTag(workspace: string, name: string, commit: string, message: string): Promise<void>;
  deleteTag(workspace: string, name: string): Promise<void>;
  pushTag(workspace: string, name: string, remote: string): Promise<void>;
  deleteRemoteTag(workspace: string, name: string, remote: string): Promise<void>;
  sync(workspace: string, action: SyncAction, remote: string): Promise<void>;
  /** Where a local branch can be pushed: its upstream, and each remote's branches and default branch. */
  pushPlan(workspace: string, branch: string): Promise<PushPlan>;
  /** What force pushing `branch` to `remoteBranch` on `remote` would remove there, as of the last fetch. */
  forcePushPlan(workspace: string, branch: string, remote: string, remoteBranch: string): Promise<ForcePushPlan>;
  /** Pushes a local branch to a branch of any name on a remote; see {@link PushRequest}. */
  push(workspace: string, request: PushRequest): Promise<PushOutcome>;
  setRemote(workspace: string, name: string, url: string): Promise<void>;
  removeRemote(workspace: string, name: string): Promise<void>;
  /** Stashes uncommitted changes. */
  stash(workspace: string, options: StashOptions): Promise<void>;
  stashDetail(workspace: string, hash: string): Promise<StashDetail>;
  /** Applies a stash; `pop` also drops it, unless applying it conflicts. */
  applyStash(workspace: string, hash: string, pop: boolean): Promise<OperationOutcome>;
  dropStash(workspace: string, hash: string): Promise<void>;
  /** Creates and switches to a branch at the stash's base commit, applies the stash there and drops it. */
  branchFromStash(workspace: string, hash: string, name: string): Promise<void>;
  /** Merges a branch, tag or commit into the current branch. */
  merge(workspace: string, ref: string, options: MergeOptions): Promise<OperationOutcome>;
  /** Rebases the current branch onto a branch, tag or commit; `autostash` sets uncommitted changes aside meanwhile. */
  rebase(workspace: string, onto: string, autostash: boolean): Promise<OperationOutcome>;
  /** Pulls the current branch from `remote` by rebasing onto what it tracks there. */
  pullRebase(workspace: string, remote: string, autostash: boolean): Promise<OperationOutcome>;
  /** The commits a rebase onto `base` (a branch, tag or commit) would rewrite. */
  rebasePlan(workspace: string, base: string): Promise<RebasePlan>;
  /** Rewrites the commits after `base`, an ancestor of HEAD: every one of them, in their new order. */
  rebaseInteractive(workspace: string, base: string, steps: readonly RebaseStep[], autostash: boolean): Promise<OperationOutcome>;
  /** Applies a commit's changes as a new commit on the current branch. */
  cherryPick(workspace: string, hash: string): Promise<OperationOutcome>;
  /** Undoes a commit with a new commit on the current branch. */
  revert(workspace: string, hash: string): Promise<OperationOutcome>;
  /** What resetting the current branch to the commit `hash` would do. */
  resetPlan(workspace: string, hash: string): Promise<ResetPlan>;
  /**
   * Moves the current branch to the commit `hash`, if it is still at
   * `expectedHead`; a hard or keep reset also only if the uncommitted
   * changes are still those of the plan's `expectedState`.
   */
  reset(workspace: string, hash: string, mode: ResetMode, expectedHead: string, expectedState?: string): Promise<ResetResult>;
  /** Moves the current branch back to the parent of its last commit, if that is still `expectedHead` (a short id will do), keeping its changes staged. */
  undoLastCommit(workspace: string, expectedHead: string): Promise<ResetResult>;
  /** Continues the operation in progress once its conflicts are resolved. */
  continueOperation(workspace: string): Promise<OperationOutcome>;
  /** Leaves out the commit a rebase, cherry-pick or revert stopped at. */
  skipOperation(workspace: string): Promise<OperationOutcome>;
  /** Restores the state before the operation began. */
  abortOperation(workspace: string): Promise<void>;
  conflict(workspace: string, path: string): Promise<ConflictFile>;
  resolveConflict(workspace: string, path: string, resolution: ConflictResolution): Promise<void>;
}

/**
 * Shells in the repository, on the repository's machine. Terminals belong to
 * the repository and end when it closes. Output is collected by reading in a
 * loop, so it reaches the client over any request and reply bridge.
 */
export interface TerminalManagerContract {
  /** False when this build cannot open terminals. */
  available(): Promise<boolean>;
  /** Starts the user's shell in the repository's root; resolves to the terminal's id. */
  open(workspace: string, cols: number, rows: number): Promise<string>;
  write(terminal: string, data: string): Promise<void>;
  resize(terminal: string, cols: number, rows: number): Promise<void>;
  /** Waits for output, up to half a minute; after the last output it resolves to the exit code. */
  read(terminal: string): Promise<TerminalOutput>;
  /** Ends the shell. */
  close(terminal: string): Promise<void>;
}

export interface Managers {
  readonly workspace: WorkspaceManagerContract;
  readonly content: ContentManagerContract;
  readonly versionControl: VersionControlManagerContract;
  readonly terminal: TerminalManagerContract;
}

type Methods<T> = readonly (keyof T & string)[];

/** Every callable method, per manager. Transports dispatch only these names. */
export const MANAGER_METHODS = {
  workspace: [
    "open",
    "restore",
    "clone",
    "createSample",
    "close",
    "snapshot",
    "recent",
    "forget",
    "preferences",
    "setPreferences",
    "distributions",
    "browse",
  ],
  content: [
    "read",
    "image",
    "write",
    "remove",
    "createPage",
    "pageLinks",
    "movePage",
    "deletePage",
    "createTask",
    "updateTask",
    "deleteTask",
    "taskTemplate",
    "ensureTaskTemplate",
    "taskActivity",
    "commentAuthor",
    "addComment",
    "editComment",
    "deleteComment",
    "saveSettings",
    "setStorage",
    "syncContent",
    "agentFiles",
    "addAgentFiles",
    "search",
    "people",
  ],
  versionControl: [
    "diff",
    "stage",
    "unstage",
    "discard",
    "stageLines",
    "unstageLines",
    "discardLines",
    "ignore",
    "untrack",
    "commit",
    "lastCommitMessage",
    "log",
    "commitDetail",
    "switchBranch",
    "createBranch",
    "renameBranch",
    "deleteBranch",
    "deleteRemoteBranch",
    "setUpstream",
    "createTag",
    "deleteTag",
    "pushTag",
    "deleteRemoteTag",
    "sync",
    "pushPlan",
    "forcePushPlan",
    "push",
    "setRemote",
    "removeRemote",
    "stash",
    "stashDetail",
    "applyStash",
    "dropStash",
    "branchFromStash",
    "merge",
    "rebase",
    "pullRebase",
    "rebasePlan",
    "rebaseInteractive",
    "cherryPick",
    "revert",
    "resetPlan",
    "reset",
    "undoLastCommit",
    "continueOperation",
    "skipOperation",
    "abortOperation",
    "conflict",
    "resolveConflict",
  ],
  terminal: ["available", "open", "write", "resize", "read", "close"],
} as const satisfies { [K in keyof Managers]: Methods<Managers[K]> };

export type ManagerName = keyof Managers;
