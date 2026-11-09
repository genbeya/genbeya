/**
 * Genbeya on a forge: the web demo's managers, opened on a repository read from GitHub, GitLab, Bitbucket,
 * Gitea or Forgejo instead of the sample project. The repository is the commit its branch points to, with
 * the forge's commit ID, so links to it and its files lead to the same place on the forge. Edits work as in
 * the demo and stay in the browser: fetching and pushing are refused, since nothing is written back yet.
 *
 * Only Genbeya's content is read: the settings, the wiki and task folders, every Markdown file, and the
 * files those link to or embed. Reading a whole repository on every visit runs into the limits forges set
 * on how fast one browser reads files (raw.githubusercontent.com did); the rest of the code stays on the forge.
 */
import type { Managers } from "../../contracts/manager-contracts";
import type { ForgeAccess, ForgePerson, ForgeReader, ForgeTree, TreeFile } from "../../access/forges/forge";
import { FORGE_READERS } from "../../access/forges/readers";
import { isoDate } from "../../access/memory/commits";
import { fileContent } from "../../access/memory/file-bytes";
import { MemoryRepository } from "../../access/memory/memory-repository";
import { SETTINGS_FILE, SettingsEngine } from "../../engines/settings-engine";
import { decodeLenient } from "../../utilities/bytes";
import type { Forge, ForgeAddress } from "../../utilities/forge-address";
import { WIKILINK } from "../../utilities/references";
import { resolveLinkPath, within } from "../../utilities/repository-path";
import { createDemoBackend } from "./demo-backend";
import type { DemoRepositoryOptions } from "./demo-sample";

export const FORGE_REMOTE = "origin";
export const NO_SYNC =
  "Genbeya in the browser doesn't fetch or push yet: what you change stays in this browser. Clone the repository to work on it with Genbeya.";

/** The page holds at most this many files, and this many bytes of them. */
export const MAX_FILES = 3000;
export const MAX_BYTES = 30_000_000;

/** What was read of a branch on a forge. */
export interface ForgeSnapshot {
  readonly tree: ForgeTree;
  /** The files that were read, by path: their bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Files of the tree that were not read: neither Genbeya's content nor referenced from it, or past the limits. */
  readonly unread: number;
}

/** What the page says about a repository it read from a forge, and keeps with it. */
export interface ForgeSummary {
  readonly forge: Forge;
  /** The forge's website, or a server of its own. */
  readonly host: string;
  /** As the forge spells them. */
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly webUrl: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  readonly branch: string;
  /** The commit that was read. */
  readonly commit: string;
  /** Files of the tree that were not read. */
  readonly unread: number;
  /** Entries of the tree that can't be read: links, submodules, large files. */
  readonly skipped: number;
  readonly truncated: boolean;
}

export interface ForgeBackend {
  readonly managers: Managers;
  readonly summary: ForgeSummary;
  /** The repository the managers work on, for keeping it. */
  readonly repository: MemoryRepository;
}

/** Reads `address` from its forge and opens Genbeya's managers on it. */
export async function openForgeBackend(
  address: ForgeAddress,
  access: ForgeAccess,
  now: () => Date = () => new Date(),
): Promise<ForgeBackend> {
  return createForgeBackend(await readForgeContent(address, access), now);
}

export function summarize({ tree, unread }: ForgeSnapshot): ForgeSummary {
  const { owner, name, webUrl, cloneUrl, defaultBranch, branch, skipped, truncated } = tree;
  return {
    forge: tree.address.forge,
    host: tree.address.host,
    owner,
    name,
    private: tree.private,
    webUrl,
    cloneUrl,
    defaultBranch,
    branch,
    commit: tree.commit.sha,
    unread,
    skipped: skipped.length,
    truncated,
  };
}

/** Reads the settings, then the wiki, the tasks and every Markdown file, then the files they refer to. */
export async function readForgeContent(
  address: ForgeAddress,
  access: ForgeAccess,
  settings = new SettingsEngine(),
  reader: ForgeReader = FORGE_READERS[address.forge],
): Promise<ForgeSnapshot> {
  const tree = await reader.readTree(address, access);
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  const files = new Map<string, Uint8Array>();
  let bytes = 0;
  let total = 0;
  const read = async (wanted: Iterable<TreeFile>) => {
    const batch = [...wanted].filter((file) => {
      const fits = !files.has(file.path) && total < MAX_FILES && bytes + file.size <= MAX_BYTES;
      if (fits) {
        bytes += file.size;
        total++;
      }
      return fits;
    });
    const done = files.size;
    const read = await reader.readFiles(tree, batch, { ...access, progress: (count) => access.progress?.(done + count, total) });
    for (const [path, content] of read) {
      files.set(path, content);
      // Forges that list no sizes (GitLab) count what arrived.
      if (!byPath.get(path)?.size) bytes += content.length;
    }
  };

  const settingsFile = byPath.get(SETTINGS_FILE);
  if (settingsFile) await read([settingsFile]);
  const fallback = settings.defaults(tree.name);
  let roots = fallback;
  try {
    if (files.has(SETTINGS_FILE)) roots = settings.parse(decodeLenient(files.get(SETTINGS_FILE)!), fallback, false);
  } catch {
    // The workspace reports broken settings; the defaults say where to look meanwhile.
  }
  const isContent = (path: string) => within(path, roots.wikiRoot) || within(path, roots.taskRoot) || MARKDOWN.test(path);
  await read(tree.files.filter((file) => isContent(file.path)));

  const referenced = new Set<TreeFile>();
  for (const [path, content] of files) {
    if (!MARKDOWN.test(path)) continue;
    for (const target of referencedPaths(path, decodeLenient(content))) {
      const file = byPath.get(target);
      if (file) referenced.add(file);
    }
  }
  await read(referenced);
  return { tree, files, unread: tree.files.length - files.size };
}

const MARKDOWN = /\.(md|markdown)$/i;
/** `[text](target)`, `![alt](target "title")` and `[text](<target with spaces>)`. */
const MARKDOWN_LINK = /\]\(\s*(?:<([^>\n]+)>|([^)\s]+))/g;

/** The repository paths a Markdown file names: `[[path]]` references and embeds, and relative links and images. */
export function referencedPaths(file: string, text: string): Set<string> {
  const paths = new Set<string>();
  for (const [, target = ""] of text.matchAll(WIKILINK)) {
    const path = target.trim().split("#")[0]!.replace(/^\/+/, "");
    if (path) paths.add(path);
  }
  for (const [, angled, plain] of text.matchAll(MARKDOWN_LINK)) {
    const target = angled ?? plain ?? "";
    if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
    try {
      paths.add(resolveLinkPath(file, decodeURIComponent(target.split(/[?#]/)[0]!)));
    } catch {
      // Not percent-encoded properly: not a link Genbeya follows either.
    }
  }
  return paths;
}

export function createForgeBackend(snapshot: ForgeSnapshot, now: () => Date = () => new Date()): ForgeBackend {
  return backendOn(summarize(snapshot), (options) => forgeRepository(snapshot, options), now);
}

/** The demo's managers on the repository `create` makes, which refuse to reach a remote. */
export function backendOn(
  summary: ForgeSummary,
  create: (options: DemoRepositoryOptions) => MemoryRepository,
  now: () => Date,
): ForgeBackend {
  let repository: MemoryRepository | undefined;
  const managers = createDemoBackend({
    now,
    network: () => Promise.reject(new Error(NO_SYNC)),
    repository: (options) => ({ name: summary.name, repository: (repository = create(options)) }),
  });
  return { managers, summary, repository: repository! };
}

/** The repository as a clone of `snapshot` would be, with its branch checked out and tracking `origin`. */
export function forgeRepository(snapshot: ForgeSnapshot, options: DemoRepositoryOptions): MemoryRepository {
  const repository = new MemoryRepository(options);
  const tree = new Map([...snapshot.files].map(([path, bytes]) => [path, fileContent(bytes)] as const));
  const { branch, commit: head, cloneUrl, defaultBranch } = snapshot.tree;
  const commit = repository.commits.adopt({
    hash: head.sha,
    parents: [],
    tree,
    message: head.message,
    author: signature(head.author),
    committer: signature(head.committer),
  });
  repository.head = { branch };
  repository.branches.set(branch, commit.hash);
  for (const [path, content] of tree) {
    repository.worktree.set(path, content);
    repository.index.set(path, content);
  }
  repository.sync.set(FORGE_REMOTE, cloneUrl);
  const server = repository.remotes.get(FORGE_REMOTE)!;
  server.branches.set(branch, commit.hash);
  repository.tracking.set(`${FORGE_REMOTE}/${branch}`, commit.hash);
  repository.upstreams.set(branch, { remote: FORGE_REMOTE, branch });
  if (branch === defaultBranch) {
    server.head = branch;
    repository.remoteHeads.set(FORGE_REMOTE, branch);
  }
  return repository;
}

const signature = (person: ForgePerson) => {
  const date = new Date(person.date);
  return { name: person.name, email: person.email, date: isoDate(Number.isNaN(date.getTime()) ? new Date(0) : date) };
};
