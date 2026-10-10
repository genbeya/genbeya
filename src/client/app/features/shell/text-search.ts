/**
 * Full-text search as the user types: waits for a pause, asks the content
 * manager, and keeps the last answer on screen until the next one arrives.
 * Answers to outdated queries are dropped.
 */
import { computed, effect, inject, signal, untracked, type Signal, type WritableSignal } from "@angular/core";
import type { SearchOptions, SearchResults } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { sameJson, debounced } from "../../core/signals";
import { WorkspaceApi } from "../../core/workspace-api";

export const SEARCH_DELAY = 250;

interface Request {
  readonly text: string;
  readonly options: Required<SearchOptions>;
}

export interface TextSearch {
  readonly options: WritableSignal<Required<SearchOptions>>;
  /** Null until there is text to search for. */
  readonly results: Signal<SearchResults | null>;
  readonly error: Signal<string | null>;
  /** True while the shown answer is not for the current text and options. */
  readonly loading: Signal<boolean>;
}

/** Searches for `text` (null or blank: nothing) with the options it holds. */
export function textSearch(text: Signal<string | null>): TextSearch {
  const api = inject(WorkspaceApi);
  const options = signal<Required<SearchOptions>>({ caseSensitive: false, wholeWord: false, regex: false });
  const request = computed<Request | null>(() => (text()?.trim() ? { text: text()!, options: options() } : null), { equal: sameJson });
  const settled = debounced(request, SEARCH_DELAY);
  const answer = signal<{ request: Request; results: SearchResults | null; error: string | null } | null>(null);
  let ticket = 0;

  effect(() => {
    const next = settled();
    const mine = ++ticket;
    if (!next) return;
    untracked(() =>
      api.content.search(next.text, next.options).then(
        (results) => mine === ticket && answer.set({ request: next, results, error: null }),
        (error: unknown) => mine === ticket && answer.set({ request: next, results: null, error: messageOf(error) }),
      ),
    );
  });

  const current = computed(() => (request() ? answer() : null));
  return {
    options,
    results: computed(() => current()?.results ?? null),
    error: computed(() => current()?.error ?? null),
    loading: computed(() => !!request() && !sameJson(current()?.request, request())),
  };
}
