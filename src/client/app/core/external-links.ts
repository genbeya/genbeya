import { Injectable, inject } from "@angular/core";
import { SHELL } from "../platform/platform";

/** Only web and mail links leave the app; repository content cannot open anything else. */
export const isExternalUrl = (url: string): boolean => /^(https?|mailto):/i.test(url);

/** Opens web and mail links in the system's browser or mail app. */
@Injectable({ providedIn: "root" })
export class ExternalLinks {
  private readonly shell = inject(SHELL);

  async open(url: string): Promise<void> {
    if (isExternalUrl(url)) await this.shell.openExternal(url);
  }
}
