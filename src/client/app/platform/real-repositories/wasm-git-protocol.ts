/** Messages between the page and the wasm-git worker of the demo's experiment with real repositories. */

export type OpfsVariant = "pthreads" | "jspi" | "asyncify";

/** What the browser offers, before any of wasm-git loads. */
export interface Probe {
  /** The build the auto-loader picks; null without OPFS. */
  readonly variant: OpfsVariant | null;
  readonly crossOriginIsolated: boolean;
  readonly jspi: boolean;
  readonly opfs: boolean;
}

export interface Cloned {
  readonly variant: OpfsVariant;
  /** Loading and starting the WebAssembly module, the first time only. */
  readonly loadMilliseconds: number;
  readonly cloneMilliseconds: number;
  /** The module's linear memory after the clone, in bytes. */
  readonly wasmMemoryBytes: number;
  /** What the worker keeps of the clone in memory besides OPFS, in bytes. */
  readonly fileSystemBytes: number;
  /** What lg2 printed, for errors. */
  readonly output: string;
}

/** A commit made in the page, to record with lg2: the files it changed or added, and its message. */
export interface WrittenCommit {
  readonly files: readonly (readonly [string, string])[];
  readonly message: string;
}

export interface Pushed {
  readonly milliseconds: number;
  readonly output: string;
}

export type WorkerCall =
  | { readonly kind: "probe" }
  | { readonly kind: "clone"; readonly url: string; readonly name: string }
  | { readonly kind: "push"; readonly name: string; readonly commits: readonly WrittenCommit[] };

export type WorkerRequest = WorkerCall & { readonly id: number };

export type WorkerResponse =
  { readonly id: number; readonly ok: true; readonly value: unknown } | { readonly id: number; readonly ok: false; readonly error: string };
