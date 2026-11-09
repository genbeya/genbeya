/**
 * Text files a web page keeps in the browser: in the Origin Private File System (OPFS), a folder only
 * this site's pages can reach, which the browser keeps until the visitor clears the site's data or the
 * page deletes them. Nothing here ever leaves the device. A `Map` stands in for tests.
 */

export interface KeptFiles {
  /** The names of the files kept. */
  list(): Promise<string[]>;
  /** A file's text, or null when it isn't kept. */
  read(name: string): Promise<string | null>;
  /** Replaces a file's text at once: a write that fails leaves the previous text. */
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Asks the browser not to delete kept files when space runs low; true when it agrees. */
  persist(): Promise<boolean>;
  /** How many bytes the site keeps in the browser, as the browser estimates it. */
  usage(): Promise<number>;
}

/** Names are encoded by the caller; anything else could reach outside the folder. */
const NAME = /^[\w.%-]{1,240}$/;

function checkName(name: string): string {
  if (!NAME.test(name) || name === "." || name === "..") throw new Error("Invalid name for a kept file.");
  return name;
}

/** The kept files in a folder of the browser's OPFS, or null when the browser can't keep files there. */
export function opfsFiles(storage: StorageManager | undefined = globalThis.navigator?.storage, folderName = "genbeya"): KeptFiles | null {
  if (
    typeof storage?.getDirectory !== "function" ||
    typeof FileSystemFileHandle === "undefined" ||
    !("createWritable" in FileSystemFileHandle.prototype)
  )
    return null;
  const folder = async () => (await storage.getDirectory()).getDirectoryHandle(folderName, { create: true });
  return {
    async list() {
      const names: string[] = [];
      for await (const [name, handle] of (await folder()) as unknown as AsyncIterable<[string, FileSystemHandle]>)
        if (handle.kind === "file" && NAME.test(name)) names.push(name);
      return names.sort();
    },
    async read(name) {
      try {
        return await (await (await (await folder()).getFileHandle(checkName(name))).getFile()).text();
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") return null;
        throw error;
      }
    },
    async write(name, text) {
      // The writable stream writes to a copy, which replaces the file only when it closes.
      const stream = await (await (await folder()).getFileHandle(checkName(name), { create: true })).createWritable();
      try {
        await stream.write(text);
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
      }
    },
    async remove(name) {
      try {
        await (await folder()).removeEntry(checkName(name));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    },
    persist: async () => (await storage.persisted?.()) || ((await storage.persist?.()) ?? false),
    usage: async () => (await storage.estimate?.())?.usage ?? 0,
  };
}

/** Kept files in memory, for tests. */
export function memoryFiles(files = new Map<string, string>()): KeptFiles & { readonly files: Map<string, string> } {
  return {
    files,
    list: async () => [...files.keys()].sort(),
    read: async (name) => files.get(checkName(name)) ?? null,
    write: async (name, text) => void files.set(checkName(name), text),
    remove: async (name) => void files.delete(checkName(name)),
    persist: async () => true,
    usage: async () => [...files.values()].reduce((sum, text) => sum + text.length, 0),
  };
}
