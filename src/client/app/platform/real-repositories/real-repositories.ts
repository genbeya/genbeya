/**
 * The web demo's experiment with real repositories (wiki:
 * Architecture/Demo-real-repositories): wasm-git clones a public repository
 * into the origin private file system (OPFS) in a worker, and the page
 * imports the clone's Git directory into an in-memory repository that the
 * demo managers open as they open the sample. Clones stay in OPFS, so they
 * open again after a reload without the network.
 */
import { importRepository, type ImportStatistics } from "../../../../access/memory/git-import";
import type { CommitObject } from "../../../../access/memory/commits";
import { GitObjects, type GitDirectory } from "../../../../access/memory/git-objects";
import type { Location } from "../../../../contracts/model";
import { DEMO_FOLDER, type DemoWorkspaceManager } from "../../../../managers/demo/demo-workspace-manager";
import { VISITOR } from "../../../../managers/demo/demo-backend";
import type { Cloned, Probe, Pushed, WorkerCall, WorkerRequest, WorkerResponse, WrittenCommit } from "./wasm-git-protocol";

/** OPFS entries of clones start with this; each has a `<name>.json` beside it. */
const PREFIX = "clone-";

/** A clone kept in this browser's OPFS. */
export interface StoredClone {
  readonly name: string;
  /** The repository's own URL. */
  readonly url: string;
  /** The URL wasm-git cloned from: the repository's, or a relay's in front of it. */
  readonly cloneUrl: string;
  readonly clonedAt: number;
}

/** What one clone or reopening took. */
export interface Measurement {
  readonly variant: string | null;
  readonly loadMilliseconds: number;
  readonly cloneMilliseconds: number;
  readonly importMilliseconds: number;
  readonly wasmMemoryBytes: number;
  readonly workerFileSystemBytes: number;
  /** The page's JavaScript heap before and after the import (Chromium only). */
  readonly heapBefore: number | null;
  readonly heapAfter: number | null;
  readonly gitDirectoryBytes: number;
  readonly statistics: ImportStatistics;
}

export interface OpenedClone {
  readonly location: Location;
  readonly measurement: Measurement;
}

/** The demo's controls for the experiment. */
export interface RealRepositoryControls {
  probe(): Promise<Probe>;
  stored(): Promise<StoredClone[]>;
  /** Clones `url`, through `relay` (a URL prefix) when given, and puts it into the demo's folder. */
  clone(url: string, relay: string | null): Promise<OpenedClone>;
  /** Imports a stored clone again, without the network. */
  reopen(name: string): Promise<OpenedClone>;
  remove(name: string): Promise<void>;
  /** Whether `location` is a clone's copy in the demo's folder. */
  isClone(location: Location): boolean;
  /**
   * Records the commits made in the page on the clone's branch with lg2,
   * pushes them to its remote, and imports the clone again: the commits get
   * Git's IDs, and changes not committed are gone.
   */
  push(location: Location): Promise<OpenedClone & { readonly pushed: number; readonly pushMilliseconds: number }>;
}

/** The OPFS folder name of a clone of `url`: the same URL replaces its earlier clone. */
export function cloneName(url: string): string {
  const slug = url
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return PREFIX + (slug || "repository");
}

/** The URL wasm-git clones from: `relay` in front of the repository's, as `<relay>/<host>/<path>`. */
export function relayedUrl(url: string, relay: string | null): string {
  if (!relay) return url;
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("The relay only fetches https:// repositories.");
  return `${relay.replace(/\/+$/, "")}/${target.host}${target.pathname}`;
}

const inflate = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());

/** A Git directory in OPFS. */
function opfsDirectory(root: FileSystemDirectoryHandle): GitDirectory & { bytes(): Promise<number> } {
  const folder = async (parts: readonly string[]) => {
    let handle = root;
    for (const part of parts) handle = await handle.getDirectoryHandle(part);
    return handle;
  };
  const split = (path: string) => path.split("/").filter(Boolean);
  const entries = (handle: FileSystemDirectoryHandle) =>
    (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  return {
    async read(path) {
      const parts = split(path);
      try {
        const file = await (await folder(parts.slice(0, -1))).getFileHandle(parts.at(-1)!);
        return new Uint8Array(await (await file.getFile()).arrayBuffer());
      } catch {
        return null;
      }
    },
    async list(path) {
      try {
        const names: string[] = [];
        for await (const [name, handle] of entries(await folder(split(path)))) names.push(handle.kind === "directory" ? `${name}/` : name);
        return names;
      } catch {
        return [];
      }
    },
    async bytes() {
      let total = 0;
      const walk = async (handle: FileSystemDirectoryHandle): Promise<void> => {
        for await (const [, child] of entries(handle))
          if (child.kind === "directory") await walk(child as FileSystemDirectoryHandle);
          else total += (await (child as FileSystemFileHandle).getFile()).size;
      };
      await walk(root);
      return total;
    },
  };
}

/** The page's JavaScript heap, after a collection where the browser allows one (Chromium with `--js-flags=--expose-gc`). */
const heap = (): number | null => {
  (globalThis as { gc?: () => void }).gc?.();
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
};

export function createRealRepositories(workspace: DemoWorkspaceManager): RealRepositoryControls {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const call = <T>(request: WorkerCall): Promise<T> => {
    worker ??= Object.assign(new Worker(new URL("./wasm-git.worker", import.meta.url), { type: "module" }), {
      onmessage: ({ data }: MessageEvent<WorkerResponse>) => {
        const pending = waiting.get(data.id);
        waiting.delete(data.id);
        if (data.ok) pending?.resolve(data.value);
        else pending?.reject(new Error(data.error));
      },
    });
    const id = ++next;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker!.postMessage({ ...request, id } satisfies WorkerRequest);
    });
  };
  const root = () => navigator.storage.getDirectory();

  async function writeMeta(clone: StoredClone): Promise<void> {
    const file = await (await root()).getFileHandle(`${clone.name}.json`, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(clone));
    await writable.close();
  }

  async function meta(name: string): Promise<StoredClone | null> {
    try {
      return JSON.parse(await (await (await (await root()).getFileHandle(`${name}.json`)).getFile()).text()) as StoredClone;
    } catch {
      return null;
    }
  }

  async function open(clone: StoredClone, cloned: Cloned | null): Promise<OpenedClone> {
    let repositoryFolder: FileSystemDirectoryHandle;
    try {
      repositoryFolder = await (await root()).getDirectoryHandle(clone.name);
    } catch {
      throw new Error(cloned?.output.trim() || `The clone of ${clone.url} is no longer stored in this browser.`);
    }
    const gitFolder = await repositoryFolder.getDirectoryHandle(".git").catch(() => {
      throw new Error(cloned?.output.trim() || `${clone.url} didn't clone.`);
    });
    const directory = opfsDirectory(gitFolder);
    const heapBefore = heap();
    const { repository, statistics } = await importRepository(directory, inflate, {
      identity: VISITOR,
      remoteUrls: new Map([["origin", clone.url]]),
    });
    const heapAfter = heap();
    const location = workspace.add(clone.name, repository);
    return {
      location,
      measurement: {
        variant: cloned?.variant ?? null,
        loadMilliseconds: cloned?.loadMilliseconds ?? 0,
        cloneMilliseconds: cloned?.cloneMilliseconds ?? 0,
        importMilliseconds: statistics.milliseconds,
        wasmMemoryBytes: cloned?.wasmMemoryBytes ?? 0,
        workerFileSystemBytes: cloned?.fileSystemBytes ?? 0,
        heapBefore,
        heapAfter,
        gitDirectoryBytes: await directory.bytes(),
        statistics,
      },
    };
  }

  const nameOf = (location: Location) => location.path.slice(DEMO_FOLDER.length + 1);

  /** The commits made in the page since the clone's: first parents back to a commit the clone has, oldest first, as lg2 records them. */
  async function newCommits(name: string, location: Location): Promise<WrittenCommit[]> {
    const repository = workspace.repositoryAt(location.path);
    if (!repository) throw new Error("This repository is no longer open.");
    const gitFolder = await (await (await root()).getDirectoryHandle(name)).getDirectoryHandle(".git");
    const objects = await GitObjects.open(opfsDirectory(gitFolder), inflate);
    const checkedOut = (await objects.refs()).find((ref) => ref.name === "HEAD")?.target.replace(/^refs\/heads\//, "");
    if (repository.currentBranch() !== checkedOut)
      throw new Error(`Switch to ${checkedOut ?? "the clone's branch"} first: lg2 commits on the branch the clone has checked out.`);
    const commits: CommitObject[] = [];
    for (let id = repository.headCommit(); id && !(await objects.has(id)); id = commits[0]!.parents[0] ?? null) {
      const commit = repository.commits.get(id);
      if (commit.parents.length > 1) throw new Error("lg2 can't record merges; push commits without merges.");
      commits.unshift(commit);
    }
    if (!commits.length) throw new Error("There are no new commits to push.");
    return commits.map((commit) => {
      const before = repository.treeOf(commit.parents[0] ?? null);
      const deleted = [...before.keys()].filter((path) => !commit.tree.has(path));
      if (deleted.length)
        throw new Error(`lg2's add doesn't record deleted files (${deleted[0]}); push commits that only add or change files.`);
      return { message: commit.message, files: [...commit.tree].filter(([path, content]) => before.get(path) !== content) };
    });
  }

  return {
    probe: () => call<Probe>({ kind: "probe" }),

    async stored() {
      const clones: StoredClone[] = [];
      for await (const [name, handle] of (await root()) as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind !== "directory" || !name.startsWith(PREFIX)) continue;
        const known = await meta(name);
        if (known) clones.push(known);
      }
      return clones.sort((a, b) => b.clonedAt - a.clonedAt);
    },

    async clone(url, relay) {
      const trimmed = url.trim();
      if (!/^https?:\/\//i.test(trimmed)) throw new Error("Enter an http:// or https:// URL of a public repository.");
      const clone: StoredClone = { name: cloneName(trimmed), url: trimmed, cloneUrl: relayedUrl(trimmed, relay), clonedAt: Date.now() };
      const cloned = await call<Cloned>({ kind: "clone", url: clone.cloneUrl, name: clone.name });
      await writeMeta(clone);
      return open(clone, cloned);
    },

    async reopen(name) {
      const clone = await meta(name);
      if (!clone) throw new Error("That clone is no longer stored in this browser.");
      return open(clone, null);
    },

    async remove(name) {
      const folder = await root();
      await folder.removeEntry(name, { recursive: true }).catch(() => undefined);
      await folder.removeEntry(`${name}.json`).catch(() => undefined);
    },

    isClone: (location) => location.kind === "local" && location.path.startsWith(`${DEMO_FOLDER}/${PREFIX}`),

    async push(location) {
      const name = nameOf(location);
      const clone = await meta(name);
      if (!clone) throw new Error("That clone is no longer stored in this browser.");
      const commits = await newCommits(name, location);
      const pushed = await call<Pushed>({ kind: "push", name, commits });
      // lg2 prints push errors and carries on; what the remote has now decides.
      if (/error|rejected|denied|failed/i.test(pushed.output)) throw new Error(pushed.output.trim());
      return { ...(await open(clone, null)), pushed: commits.length, pushMilliseconds: pushed.milliseconds };
    },
  };
}
