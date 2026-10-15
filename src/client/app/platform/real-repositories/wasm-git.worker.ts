/**
 * The demo's wasm-git worker: libgit2 compiled to WebAssembly, loaded
 * through its OPFS auto-loader, clones repositories into the origin private
 * file system. Only the transport and the storage happen here; the page
 * reads the clone's Git directory from OPFS and imports it into the demo's
 * in-memory model. OPFS's synchronous access handles need a worker.
 */
import type { Cloned, OpfsVariant, Probe, Pushed, WorkerRequest, WorkerResponse, WrittenCommit } from "./wasm-git-protocol";

interface OpfsGit {
  readonly variant: OpfsVariant;
  readonly module: { HEAPU8: Uint8Array };
  readonly FS: EmscriptenFs;
  clone(url: string, name: string): Promise<string[]>;
  syncRepo(name: string): Promise<boolean>;
  writeFile(name: string, path: string, content: string): Promise<void>;
  repoDir(name: string): string;
  run(args: readonly string[]): Promise<unknown>;
}

interface EmscriptenFs {
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  mkdir(path: string): void;
  unlink(path: string): void;
  chdir(path: string): void;
}

interface AutoLoader {
  selectOpfsVariant(): OpfsVariant | null;
  loadOpfsGit(options: { user: string; email: string; moduleOverrides: object }): Promise<OpfsGit>;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  location: Location;
  crossOriginIsolated: boolean;
};

/** wasm-git's files sit next to the app's, in `wasm-git/` (angular.json, the demo build). */
const loaderUrl = new URL("wasm-git/lg2_opfs_auto.js", scope.location.href).href;
let output: string[] = [];
let loader: Promise<AutoLoader> | null = null;
let git: Promise<OpfsGit> | null = null;
let loadMilliseconds = 0;

const autoLoader = () => (loader ??= import(/* @vite-ignore */ loaderUrl) as Promise<AutoLoader>);

function loadGit(): Promise<OpfsGit> {
  return (git ??= (async () => {
    const started = performance.now();
    const loaded = await (
      await autoLoader()
    ).loadOpfsGit({
      // Commits the experiment might write are the visitor's, as in the demo.
      user: "You",
      email: "you@example.com",
      moduleOverrides: { print: (line: string) => output.push(line), printErr: (line: string) => output.push(line) },
    });
    loadMilliseconds = performance.now() - started;
    return loaded;
  })());
}

async function probe(): Promise<Probe> {
  const wasm = WebAssembly as unknown as Record<string, unknown>;
  return {
    variant: (await autoLoader()).selectOpfsVariant(),
    crossOriginIsolated: scope.crossOriginIsolated === true,
    jspi: typeof wasm["Suspending"] === "function" || typeof wasm["promising"] === "function",
    opfs: typeof navigator.storage?.getDirectory === "function",
  };
}

async function clone(url: string, name: string): Promise<Cloned> {
  const first = !git;
  const opened = await loadGit();
  output = [];
  const started = performance.now();
  await opened.clone(url, name);
  const cloneMilliseconds = performance.now() - started;
  return {
    variant: opened.variant,
    loadMilliseconds: first ? Math.round(loadMilliseconds) : 0,
    cloneMilliseconds: Math.round(cloneMilliseconds),
    wasmMemoryBytes: opened.module.HEAPU8.buffer.byteLength,
    // The JSPI and Asyncify builds keep a copy of the clone in memory (MEMFS) besides OPFS.
    fileSystemBytes: opened.variant === "pthreads" ? 0 : bytesBelow(opened.FS, `/opfs/${name}`),
    output: output.join("\n"),
  };
}

/**
 * Records `commits` in the clone with lg2, one after the other on its
 * checked-out branch, and pushes the branch. lg2's `add` stages changed and
 * new files only, so the page refuses commits that delete files.
 */
async function push(name: string, commits: readonly WrittenCommit[]): Promise<Pushed> {
  const opened = await loadGit();
  output = [];
  const started = performance.now();
  if (!(await opened.syncRepo(name))) throw new Error("The clone is no longer stored in this browser.");
  const folder = opened.repoDir(name);
  // lg2 resolves the repository from the working folder, which each command may reset.
  const run = async (args: readonly string[]) => {
    opened.FS.chdir(folder);
    await opened.run(args);
  };
  for (const commit of commits) {
    for (const [path, content] of commit.files) {
      // The threaded build writes through to OPFS and needs the folders; the others create them.
      if (opened.variant === "pthreads")
        path
          .split("/")
          .slice(0, -1)
          .reduce((parent, part) => {
            const next = `${parent}/${part}`;
            try {
              opened.FS.mkdir(next);
            } catch {
              // It exists.
            }
            return next;
          }, folder);
      // WasmFS's OPFS backend writes over an existing file without truncating it first.
      if (opened.variant === "pthreads")
        try {
          opened.FS.unlink(`${folder}/${path}`);
        } catch {
          // A new file.
        }
      await opened.writeFile(name, path, content);
    }
    await run(["add", ...commit.files.map(([path]) => path)]);
    await run(["commit", "-m", commit.message]);
  }
  await run(["push"]);
  return { milliseconds: Math.round(performance.now() - started), output: output.join("\n") };
}

/** The size of the files below `path` in Emscripten's file system. */
function bytesBelow(fs: EmscriptenFs, path: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = fs.readdir(path);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;
    const stat = fs.stat(`${path}/${entry}`);
    total += fs.isDir(stat.mode) ? bytesBelow(fs, `${path}/${entry}`) : stat.size;
  }
  return total;
}

scope.onmessage = async ({ data: request }) => {
  try {
    const value =
      request.kind === "probe"
        ? await probe()
        : request.kind === "clone"
          ? await clone(request.url, request.name)
          : await push(request.name, request.commits);
    scope.postMessage({ id: request.id, ok: true, value });
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
