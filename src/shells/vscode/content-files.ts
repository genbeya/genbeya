/**
 * Pages, tasks and settings that live on the content branch, as documents of
 * the `genbeya-content` scheme. Reads and saves go through the content
 * manager, so each save is committed on the content branch as in the app,
 * and a save over a version changed meanwhile fails instead of overwriting it.
 */
import * as vscode from "vscode";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import type { Repository } from "./repository";

export const CONTENT_SCHEME = "genbeya-content";

interface Known {
  readonly hash: string;
  readonly mtime: number;
  readonly size: number;
}

export class ContentFiles implements vscode.FileSystemProvider {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  /** The version of each file as last read or written, which saves must be based on. */
  private readonly known = new Map<string, Known>();

  constructor(private readonly repository: () => Repository | undefined) {}

  private open(): Repository {
    const repository = this.repository();
    if (!repository) throw vscode.FileSystemError.Unavailable("No Genbeya repository is open.");
    return repository;
  }

  private async read(uri: vscode.Uri) {
    const repository = this.open();
    const path = uri.path.slice(1);
    let file;
    try {
      file = await repository.backend.content.read(repository.id, "content", path);
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { file, known: this.remember(path, file.hash, file.content) };
  }

  private remember(path: string, hash: string, content: string): Known {
    const previous = this.known.get(path);
    if (previous?.hash === hash) return previous;
    const known = { hash, mtime: Math.max(Date.now(), (previous?.mtime ?? 0) + 1), size: encodeText(content).length };
    this.known.set(path, known);
    return known;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { known } = await this.read(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: known.mtime, size: known.size };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return encodeText((await this.read(uri)).file.content);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean }): Promise<void> {
    const repository = this.open();
    const path = uri.path.slice(1);
    const expected = this.known.get(path)?.hash ?? null;
    if (expected === null && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    const file = await repository.backend.content.write(repository.id, "content", path, decodeLenient(content), expected);
    this.remember(path, file.hash, file.content);
    this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    void repository.refresh();
  }

  /** Tells VS Code which open documents changed elsewhere, after the snapshot changed. */
  async checkOpenDocuments(): Promise<void> {
    const open = vscode.workspace.textDocuments.filter((document) => document.uri.scheme === CONTENT_SCHEME);
    const changes: vscode.FileChangeEvent[] = [];
    for (const { uri } of open) {
      const before = this.known.get(uri.path.slice(1))?.hash;
      try {
        const { known } = await this.read(uri);
        if (known.hash !== before) changes.push({ type: vscode.FileChangeType.Changed, uri });
      } catch {
        changes.push({ type: vscode.FileChangeType.Deleted, uri });
      }
    }
    if (changes.length) this.changed.fire(changes);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  readDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("Folders on the content branch are not listed yet.");
  }

  /** Folders need no creating: saving a file creates the folders it is in. */
  createDirectory(): void {
    // VS Code creates the parents of a file it writes first.
  }

  delete(): never {
    throw vscode.FileSystemError.NoPermissions("Files on the content branch can't be deleted here yet.");
  }

  rename(): never {
    throw vscode.FileSystemError.NoPermissions("Files on the content branch can't be moved here yet.");
  }
}
