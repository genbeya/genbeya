/** Opens the shell's overlays from anywhere: the command palette, shortcut help, and the repository dialogs. */
import { Injectable, inject } from "@angular/core";
import type { Location } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";

export type PaletteMode = "all" | "branches";

@Injectable({ providedIn: "root" })
export class ShellUi {
  private readonly dialogs = inject(Dialogs);
  private readonly session = inject(Session);

  async openPalette(mode: PaletteMode = "all"): Promise<void> {
    const { Palette } = await import("./palette");
    await this.dialogs.open(Palette, mode, { top: "13vh", backdrop: "palette-backdrop" });
  }

  async showHelp(): Promise<void> {
    const { ShortcutHelp } = await import("./shortcut-help");
    await this.dialogs.open(ShortcutHelp);
  }

  async openRemote(): Promise<void> {
    const { RemoteDialog } = await import("../welcome/repository-dialogs");
    const location = await this.dialogs.open<Location>(RemoteDialog);
    if (location) await this.session.open(location);
  }

  async openClone(): Promise<void> {
    const { CloneDialog } = await import("../welcome/repository-dialogs");
    const request = await this.dialogs.open<{ url: string; parent: Location }>(CloneDialog);
    if (request) await this.session.clone(request.url, request.parent);
  }
}
