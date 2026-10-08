/**
 * The node:fs calls the engine and state store make, over Tauri commands
 * (desktop/tauri/src-tauri/src/fs.rs). Errors keep Node's `code` so the
 * engine's ENOENT/EEXIST/EPERM handling works unchanged.
 */
import { invoke } from "@tauri-apps/api/core";

type Kind = "file" | "dir" | "symlink" | "other";

export async function call<T>(command: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) {
  try {
    return await invoke<T>(command, args, headers ? { headers } : undefined);
  } catch (failure) {
    const { code, message } = (failure ?? {}) as { code?: string; message?: string };
    throw Object.assign(new Error(message ?? String(failure)), { code: code ?? "EIO" });
  }
}

const stats = ({ kind, size }: { kind: Kind; size: number }) => ({
  size,
  isFile: () => kind === "file",
  isDirectory: () => kind === "dir",
  isSymbolicLink: () => kind === "symlink",
});

type Encoding = "utf8" | { encoding?: "utf8" } | undefined;

export const promises = {
  lstat: async (path: string) => stats(await call("fs_stat", { path, follow: false })),
  stat: async (path: string) => stats(await call("fs_stat", { path, follow: true })),
  async readFile(path: string, encoding?: Encoding) {
    const data = Buffer.from(await call<ArrayBuffer>("fs_read", { path }));
    return encoding ? data.toString("utf8") : data;
  },
  writeFile: (path: string, data: string | Uint8Array, options?: { flag?: string }) =>
    call<void>("fs_write", typeof data === "string" ? Buffer.from(data, "utf8") : data, {
      path: encodeURIComponent(path),
      exclusive: options?.flag === "wx" ? "1" : "0",
    }),
  mkdir: (path: string, options?: { recursive?: boolean }) =>
    call<void>("fs_mkdir", { path, recursive: !!options?.recursive }),
  readdir: (path: string) => call<string[]>("fs_readdir", { path }),
  rename: (from: string, to: string) => call<void>("fs_rename", { from, to }),
  rmdir: (path: string) => call<void>("fs_remove", { path, dir: true }),
  unlink: (path: string) => call<void>("fs_remove", { path, dir: false }),
};

/**
 * Only used to word an error after a failed process start; Rust already
 * reports a missing working directory in that case (src/process.rs).
 */
export const existsSync = () => true;

export default { promises, existsSync };
