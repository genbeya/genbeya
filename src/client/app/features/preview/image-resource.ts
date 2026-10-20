/**
 * An image of the working tree as a data URL, kept current with the disk:
 * every snapshot change reads it again, and a new version replaces the
 * one shown. A null path reads nothing.
 */
import { effect, inject, signal, untracked, type Signal } from "@angular/core";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";

export interface ImageResource {
  readonly url: Signal<string | null>;
  readonly error: Signal<string | null>;
}

export function imageResource(path: Signal<string | null>): ImageResource {
  const api = inject(WorkspaceApi);
  const session = inject(Session);
  const url = signal<string | null>(null);
  const error = signal<string | null>(null);
  let request = 0;

  const read = async (fresh: boolean) => {
    const target = untracked(path);
    if (!target) return;
    const ticket = ++request;
    try {
      const next = await api.content.image("repo", target);
      if (ticket !== request) return;
      if (next !== untracked(url)) url.set(next);
      error.set(null);
    } catch (failure) {
      // A background read keeps what is shown, unless nothing could be shown yet.
      if (ticket !== request || (!fresh && untracked(url))) return;
      url.set(null);
      error.set(messageOf(failure));
    }
  };

  effect(() => {
    path();
    untracked(() => {
      url.set(null);
      error.set(null);
      void read(true);
    });
  });
  effect(() => {
    // The snapshot version changes whenever the repository does.
    if (session.snapshot()?.version) untracked(() => void read(false));
  });

  return { url: url.asReadonly(), error: error.asReadonly() };
}
