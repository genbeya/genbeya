/**
 * Unsaved work across the app. Editors report whether they are dirty;
 * navigation, repository switches and closing the window ask before
 * discarding it.
 */
import { DestroyRef, effect, Injectable, inject, signal, type Signal } from "@angular/core";
import type { CanDeactivateFn } from "@angular/router";
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

  /** True when nothing is unsaved or the user agrees to discard it. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.any()) return true;
    const discard = await this.dialogs.confirm({
      title: "Discard unsaved changes?",
      message: "Your edits have not been saved.",
      confirm: "Discard changes",
      danger: true,
    });
    if (discard) this.owners.set(new Set());
    return discard;
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
