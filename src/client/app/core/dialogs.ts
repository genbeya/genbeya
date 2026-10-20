/** Prompts and confirmations as in-app dialogs. */
import { Dialog } from "@angular/cdk/dialog";
import { Overlay } from "@angular/cdk/overlay";
import { Injectable, inject, type Type } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { ConfirmDialog, type ConfirmOptions } from "../ui/confirm-dialog";
import { PromptDialog, type PromptOptions } from "../ui/prompt-dialog";

@Injectable({ providedIn: "root" })
export class Dialogs {
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);

  /** Opens `component` as a modal dialog near the top (or as far down as `top`, with extra `backdrop` and `panel` classes); resolves with its result. */
  open<R, D = unknown>(
    component: Type<unknown>,
    data?: D,
    placement: { top?: string; backdrop?: string; panel?: string } = {},
  ): Promise<R | undefined> {
    const reference = this.dialog.open<R, D>(component, {
      data,
      backdropClass: ["dialog-backdrop", ...(placement.backdrop ? [placement.backdrop] : [])],
      panelClass: ["dialog-pane", ...(placement.panel ? [placement.panel] : [])],
      positionStrategy: this.overlay
        .position()
        .global()
        .centerHorizontally()
        .top(placement.top ?? "12vh"),
      autoFocus: "first-tabbable",
      restoreFocus: true,
    });
    return firstValueFrom(reference.closed);
  }

  async prompt(options: PromptOptions): Promise<string | null> {
    return (await this.open<string, PromptOptions>(PromptDialog, options)) ?? null;
  }

  async confirm(options: ConfirmOptions): Promise<boolean> {
    return (await this.open<boolean, ConfirmOptions>(ConfirmDialog, options)) ?? false;
  }

  /** Asks before throwing away unsaved edits of one thing, e.g. "this page". */
  discardEdits(subject: string): Promise<boolean> {
    return this.confirm({
      title: "Discard changes?",
      message: `Your changes to ${subject} have not been saved.`,
      confirm: "Discard changes",
      danger: true,
    });
  }
}
