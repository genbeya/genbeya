/**
 * Text files below one root on a host, versioned by content hash: a write
 * names the version it is based on and fails when the file changed since,
 * so concurrent edits are never silently overwritten.
 */
import { decodeText, encodeText, sha256 } from "../../utilities/bytes";
import { HostError, isMissing, type EntryKind, type Host } from "../hosts/host";

export const TEXT_LIMIT = 2 * 1024 * 1024;
export const IMAGE_LIMIT = 10 * 1024 * 1024;

export interface VersionedFile {
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

export class FileStore {
  constructor(
    readonly host: Host,
    readonly root: string,
  ) {}

  async read(path: string): Promise<VersionedFile> {
    const content = decodeText(await this.host.read(this.root, path, TEXT_LIMIT), path);
    return { path, content, hash: sha256(content) };
  }

  readBytes(path: string, limit: number): Promise<Uint8Array> {
    return this.host.read(this.root, path, limit);
  }

  /** Reads many text files; unreadable ones map to null, undecodable ones to their error. */
  async readMany(paths: readonly string[]): Promise<(VersionedFile | Error | null)[]> {
    const contents = await this.host.readMany(this.root, paths, TEXT_LIMIT);
    return contents.map((data, i) => {
      if (!data) return null;
      try {
        const content = decodeText(data, paths[i]!);
        return { path: paths[i]!, content, hash: sha256(content) };
      } catch (error) {
        return error as Error;
      }
    });
  }

  /** The current version, or null when the file does not exist. */
  async versionOf(path: string): Promise<string | null> {
    try {
      return (await this.read(path)).hash;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** Writes `content` if the file is still at `expectedHash` (null: does not exist yet). */
  async write(path: string, content: string, expectedHash: string | null): Promise<VersionedFile> {
    const data = encodeText(content);
    if (data.length > TEXT_LIMIT) throw new Error("Files are limited to 2 MiB.");
    const actual = await this.versionOf(path);
    if (actual !== null && expectedHash === null) throw new HostError("EXISTS", path);
    if (actual !== expectedHash) throw new Error(`${path} changed on disk. Reload it before saving; your edits are kept.`);
    await this.host.write(this.root, path, data, actual === null);
    return { path, content, hash: sha256(content) };
  }

  remove(path: string): Promise<void> {
    return this.host.remove(this.root, path);
  }

  /**
   * Moves entries in order, refusing before the first move when a target
   * exists; a target differing from its source only in case is left to the
   * host, which knows whether they are the same entry.
   */
  async moveAll(moves: readonly (readonly [string, string])[]): Promise<void> {
    for (const [from, to] of moves) if (from.toLowerCase() !== to.toLowerCase() && (await this.kind(to))) throw new HostError("EXISTS", to);
    for (const [from, to] of moves) await this.host.move(this.root, from, to);
  }

  kind(path: string): Promise<EntryKind> {
    return this.host.kind(this.root, path);
  }
}
