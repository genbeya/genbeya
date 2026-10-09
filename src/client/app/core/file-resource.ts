/**
 * A file kept current with the disk. Every snapshot change re-reads it.
 * While `editing`, a newer version is not swapped in, since the draft is
 * based on the loaded one; `changedOnDisk` reports it instead.
 */
import { effect, inject, signal, untracked, type Signal } from "@angular/core";
import type { FileContent, Scope } from "../../../contracts/model";
import { messageOf } from "./notifications";
import { Session } from "./session";
import { WorkspaceApi } from "./workspace-api";

export interface FileResource {
  readonly file: Signal<FileContent | null>;
  readonly error: Signal<string | null>;
  readonly changedOnDisk: Signal<boolean>;
  /** Replaces the loaded version, e.g. with the result of a save. */
  set(file: FileContent): void;
  reload(): Promise<void>;
}

export function fileResource(scope: Scope, path: Signal<string | null>, editing: Signal<boolean>): FileResource {
  const api = inject(WorkspaceApi);
  const session = inject(Session);
  const file = signal<FileContent | null>(null);
  const error = signal<string | null>(null);
  const changedOnDisk = signal(false);
  let request = 0;

  const read = async (fresh: boolean) => {
    const target = untracked(path);
    if (!target) return;
    const ticket = ++request;
    try {
      const next = await api.content.read(scope, target);
      if (ticket !== request) return;
      const current = untracked(file);
      if (!fresh && current?.hash === next.hash) return;
      if (!fresh && current && untracked(editing)) changedOnDisk.set(true);
      else {
        file.set(next);
        error.set(null);
        changedOnDisk.set(false);
      }
    } catch (failure) {
      if (ticket !== request || !fresh) return;
      file.set(null);
      error.set(messageOf(failure));
    }
  };

  effect(() => {
    path();
    untracked(() => {
      file.set(null);
      error.set(null);
      changedOnDisk.set(false);
      void read(true);
    });
  });
  effect(() => {
    // The snapshot version changes whenever the repository does.
    if (session.snapshot()?.version) untracked(() => void read(false));
  });

  return {
    file: file.asReadonly(),
    error: error.asReadonly(),
    changedOnDisk: changedOnDisk.asReadonly(),
    set: (next) => {
      file.set(next);
      changedOnDisk.set(false);
    },
    reload: () => read(true),
  };
}

/** Markdown without its YAML frontmatter block. */
export const stripFrontmatter = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
