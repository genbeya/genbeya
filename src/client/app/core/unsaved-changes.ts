/**
 * Unsaved work across the app. Editors report whether they are dirty;
 * navigation, repository switches and closing the window ask before
 * discarding it.
 */
import { DestroyRef, effect, Injectable, inject, signal, type Signal } from "@angular/core";
import type { CanDeactivateFn, Route } from "@angular/router";
import { Dialogs } from "./dialogs";

@Injectable({ providedIn: "root" })
export class UnsavedChanges {
  private readonly dialogs = inject(Dialogs);
  private readonly owners = signal<ReadonlySet<object>>(new Set());
  readonly any = () => this.owners().size > 0;

  mark(owner: object, dirty: boolean): void {
    this.owners.update((owners) => {
      if (owners.has(owner) === dirty) return owners;
      const next = new Set(owners);
      if (dirty) next.add(owner);
      else next.delete(owner);
      return next;
    });
  }

  /**
   * True when nothing is unsaved or the user agrees to discard it. The
   * editors stop being tracked when they are destroyed, so edits stay
   * protected if the discard does not happen after all.
   */
  confirmDiscard(): Promise<boolean> {
    if (!this.any()) return Promise.resolve(true);
    return this.dialogs.confirm({
      title: "Discard unsaved changes?",
      message: "Your edits have not been saved.",
      confirm: "Discard changes",
      danger: true,
    });
  }
}

/** Reports `dirty` for the lifetime of the calling component. */
export function trackUnsaved(dirty: Signal<boolean>): void {
  const unsaved = inject(UnsavedChanges);
  const owner = {};
  effect(() => unsaved.mark(owner, dirty()));
  inject(DestroyRef).onDestroy(() => unsaved.mark(owner, false));
}

/** Leaving a route asks before discarding unsaved edits. */
export const confirmLeave: CanDeactivateFn<unknown> = () => inject(UnsavedChanges).confirmDiscard();

/**
 * Route options for a view whose editors are keyed by query parameters:
 * leaving the route, or changing one of `keys`, asks before discarding.
 * Angular skips the guard for query parameter changes unless told otherwise.
 */
export function guardedBy(...keys: string[]): Pick<Route, "canDeactivate" | "runGuardsAndResolvers"> {
  return {
    canDeactivate: [confirmLeave],
    runGuardsAndResolvers: (from, to) => keys.some((key) => from.queryParamMap.get(key) !== to.queryParamMap.get(key)),
  };
}
