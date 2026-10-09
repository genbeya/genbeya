import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { LucideArrowRight, LucideCloudDownload, LucideFolderOpen, LucideServer, LucideX } from "@lucide/angular";
import { describeLocation, type Location } from "../../../../contracts/model";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { HostIcon, initials } from "../shell/repository-mark";
import { ShellUi } from "../shell/shell-ui";

/** "just now", "5 min ago", "3 h ago", "2 d ago", or a date. */
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(time).toLocaleDateString();
}

@Component({
  selector: "gd-welcome",
  imports: [HostIcon, LucideArrowRight, LucideCloudDownload, LucideFolderOpen, LucideServer, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./welcome.css",
  host: { class: "welcome" },
  template: `
    <div class="welcome-panel">
      <div class="welcome-brand">
        <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--accent)" />
          <path d="M10 9v14M10 16h7a5 5 0 0 0 5-5V9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" />
          <circle cx="10" cy="9" r="2.6" fill="#fff" />
          <circle cx="10" cy="23" r="2.6" fill="#fff" />
          <circle cx="22" cy="9" r="2.6" fill="#fff" />
        </svg>
        <h1>GitDesk</h1>
      </div>

      <div class="welcome-actions">
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="session.pick()">
          <svg lucideFolderOpen [size]="18" aria-hidden="true"></svg>
          <span class="grow">Open folder</span>
          <kbd class="kbd">{{ mod }} O</kbd>
        </button>
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="ui.openRemote()">
          <svg lucideServer [size]="18" aria-hidden="true"></svg>
          <span class="grow">Open on WSL or SSH</span>
        </button>
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="ui.openClone()">
          <svg lucideCloudDownload [size]="18" aria-hidden="true"></svg>
          <span class="grow">Clone repository</span>
        </button>
      </div>

      @if (recent().length) {
        <section class="welcome-recent" aria-labelledby="recent-heading">
          <h2 id="recent-heading">Recent</h2>
          @for (entry of recent(); track entry.openedAt) {
            <div class="recent-row">
              <button type="button" class="recent-open" [disabled]="busy()" (click)="session.open(entry.location)">
                <span class="recent-mark" aria-hidden="true">{{ initials(entry.name) }}</span>
                <span class="grow">
                  <span class="recent-name">{{ entry.name }}</span>
                  <span class="recent-path ellipsis"
                    ><gd-host-icon [location]="entry.location" [size]="11" />{{ describe(entry.location) }}</span
                  >
                </span>
                <span class="recent-time">{{ ago(entry.openedAt) }}</span>
                <svg lucideArrowRight [size]="14" class="recent-arrow" aria-hidden="true"></svg>
              </button>
              <button
                type="button"
                class="recent-forget"
                [attr.aria-label]="'Remove ' + entry.name + ' from recent'"
                title="Remove from list"
                (click)="forget(entry.location)"
              >
                <svg lucideX [size]="13" aria-hidden="true"></svg>
              </button>
            </div>
          }
        </section>
      }
      @if (busy()) {
        <div class="welcome-busy"><span class="spinner"></span> Opening…</div>
      }
    </div>
  `,
})
export class Welcome {
  protected readonly session = inject(Session);
  protected readonly ui = inject(ShellUi);
  private readonly repositories = inject(Repositories);
  protected readonly mod = MOD_KEY;
  protected readonly recent = this.repositories.recent;
  protected readonly busy = computed(() => this.session.phase() === "opening");
  protected readonly initials = initials;
  protected readonly describe = describeLocation;
  protected readonly ago = ago;

  constructor() {
    hotkey(
      "mod+o",
      () => void this.session.pick(),
      computed(() => !this.busy()),
    );
  }

  protected forget(location: Location) {
    void this.repositories.forget(location);
  }
}
