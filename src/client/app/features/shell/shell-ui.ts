/** Opens the shell's overlays from anywhere: the command palette, shortcut help, the repository dialogs and GitDesk links. */
import { Injectable, inject } from "@angular/core";
import type { GitdeskLink } from "../../../../contracts/gitdesk-link";
import type { Location } from "../../../../contracts/model";
import { describeLinkItem } from "../../../../utilities/gitdesk-link";
import { Dialogs } from "../../core/dialogs";
import { LinkOpener } from "../../core/link-opener";
import { Session } from "../../core/session";

export type PaletteMode = "all" | "branches";

@Injectable({ providedIn: "root" })
export class ShellUi {
  private readonly dialogs = inject(Dialogs);
  private readonly session = inject(Session);
  private readonly links = inject(LinkOpener);

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

  /** Asks for a URL, starting with `url`, and where to clone it. Resolves to false when cancelled. */
  async openClone(url = ""): Promise<boolean> {
    const { CloneDialog } = await import("../welcome/repository-dialogs");
    const request = await this.dialogs.open<{ url: string; parent: Location }>(CloneDialog, url);
    if (!request) return false;
    await this.session.clone(request.url, request.parent);
    return true;
  }

  /** Shows the item a GitDesk link names; without a known clone of its repository, offers to clone it. */
  async openLink(link: GitdeskLink): Promise<void> {
    if (await this.links.open(link)) return;
    const clone = await this.dialogs.confirm({
      title: "Repository not cloned here",
      message:
        `None of your recent repositories has the remote ${link.remote}. Clone it to open ${describeLinkItem(link.item)}, ` +
        "or open your existing clone once so GitDesk knows it.",
      confirm: "Clone…",
    });
    if (clone && (await this.openClone(link.remote))) await this.links.open(link);
  }
}
