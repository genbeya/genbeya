import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { describeLocation, type Location } from "../../../../contracts/model";
import { APP_VERSION } from "../../core/app-version";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Repositories } from "../../core/repositories";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { relativeTime } from "../../ui/relative-time";
import { DemoBadge } from "../demo/demo-badge";
import { Onboarding } from "../onboarding/onboarding";
import { HostIcon, initials } from "../shell/repository-mark";
import { ShellUi } from "../shell/shell-ui";

@Component({
  selector: "gd-welcome",
  imports: [DemoBadge, HostIcon, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./welcome.css",
  host: { class: "welcome" },
  template: `
    <div class="welcome-panel">
      <div class="welcome-brand">
        <!-- branding/genbeya-small.svg, the mark for up to 48 pixels. -->
        <svg viewBox="0 0 512 512" width="40" height="40" aria-hidden="true" stroke-linejoin="round" stroke-linecap="round">
          <g transform="matrix(1 -0.42 0 1 0 149.4)">
            <rect x="28" y="0" width="134" height="240" rx="4" fill="#22313d" stroke="#22313d" stroke-width="16" />
            <rect x="56" y="28" width="78" height="184" rx="2" fill="#fff" stroke="#fff" stroke-width="12" />
            <path d="M80 86 H110 M80 138 H110" fill="none" stroke="#22313d" stroke-width="22" />
          </g>
          <g transform="matrix(1 0.42 0 1 0 -65.64)">
            <rect x="350" y="0" width="134" height="240" rx="4" fill="#22313d" stroke="#22313d" stroke-width="16" />
            <rect x="378" y="28" width="78" height="184" rx="2" fill="#fff" stroke="#fff" stroke-width="12" />
            <path d="M402 86 H432 M402 138 H432" fill="none" stroke="#22313d" stroke-width="22" />
          </g>
          <path d="M196 60 L256 36 L316 60 L316 296 L256 270 L196 296 Z" fill="#7c7ff2" stroke="#7c7ff2" stroke-width="16" />
          <path d="M234 100 V222 M234 206 C234 176 282 182 282 146" fill="none" stroke="#fff" stroke-width="22" />
          <circle cx="234" cy="98" r="24" fill="#fff" />
          <circle cx="234" cy="226" r="24" fill="#fff" />
          <circle cx="282" cy="140" r="24" fill="#fff" />
          <path d="M256 312 L484 404 L256 496 L28 404 Z" fill="#7c7ff2" stroke="#7c7ff2" stroke-width="16" />
        </svg>
        <h1>Genbeya</h1>
      </div>

      @if (onboarding.introduce()) {
        <section class="welcome-intro" aria-labelledby="intro-heading">
          <h2 id="intro-heading">Welcome to Genbeya</h2>
          <p>
            A wiki, a task board, a code editor and version control for a Git repository, all kept as plain files in it. Open a repository
            below for a short tour of it, or try Genbeya on a sample project first.
          </p>
          <button type="button" class="btn btn-primary btn-m" [disabled]="busy()" (click)="onboarding.createSample()">
            <svg gd-icon name="flask-conical" [size]="14"></svg><span>Try Genbeya with a sample project</span>
          </button>
        </section>
      }

      <div class="welcome-actions">
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="session.pick()">
          <svg gd-icon name="folder-open" [size]="18"></svg>
          <span class="grow">Open folder</span>
          <kbd class="kbd">{{ mod }} O</kbd>
        </button>
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="ui.openRemote()">
          <svg gd-icon name="server" [size]="18"></svg>
          <span class="grow">Open on WSL or SSH</span>
        </button>
        <button type="button" class="welcome-action" [disabled]="busy()" (click)="ui.openClone()">
          <svg gd-icon name="cloud-download" [size]="18"></svg>
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
                <span class="recent-time">{{ relativeTime(entry.openedAt, now, "short") }}</span>
                <svg gd-icon name="arrow-right" [size]="14" class="recent-arrow"></svg>
              </button>
              <button
                type="button"
                class="recent-forget"
                [attr.aria-label]="'Remove ' + entry.name + ' from recent'"
                title="Remove from list"
                (click)="forget(entry.location)"
              >
                <svg gd-icon name="x" [size]="13"></svg>
              </button>
            </div>
          }
        </section>
      }
      @if (busy()) {
        <div class="welcome-busy"><span class="spinner"></span> Opening…</div>
      }

      <gd-demo-badge />

      <footer class="welcome-footer">
        <span>Genbeya {{ version }}</span>
        <button type="button" class="btn btn-ghost btn-s" (click)="onboarding.showWhatsNew()"><span>What's new</span></button>
        <button type="button" class="btn btn-ghost btn-s" (click)="onboarding.openDocs()">
          <span>Documentation</span><svg gd-icon name="external-link" [size]="12"></svg>
        </button>
      </footer>
    </div>
  `,
})
export class Welcome {
  protected readonly session = inject(Session);
  protected readonly ui = inject(ShellUi);
  protected readonly onboarding = inject(Onboarding);
  private readonly repositories = inject(Repositories);
  protected readonly mod = MOD_KEY;
  protected readonly version = APP_VERSION;
  protected readonly recent = this.repositories.recent;
  protected readonly busy = computed(() => this.session.phase() === "opening");
  protected readonly initials = initials;
  protected readonly describe = describeLocation;
  protected readonly relativeTime = relativeTime;
  protected readonly now = Date.now();

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
