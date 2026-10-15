import { DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { Location } from "../../../../contracts/model";
import { Demo, type OpenedClone, type StoredClone } from "../../core/demo";
import { DialogFrame } from "../../ui/dialog-frame";
import { Icon } from "../../ui/icon";
import { relativeTime } from "../../ui/relative-time";

/** The playground of wasm-git's author, which allows cross-origin requests. */
const PLAYGROUND = "https://wasm-git.petersalomonsen.com/test";
/** Where `scripts/cors-relay.mjs` listens. */
const LOCAL_RELAY = "http://127.0.0.1:8787";

const VARIANTS = { pthreads: "threaded (cross-origin isolated)", jspi: "JSPI", asyncify: "Asyncify" } as const;

/** The experiment with real repositories: clones a public repository into this browser, or opens one cloned before. */
@Component({
  selector: "gd-real-repository-dialog",
  imports: [DialogFrame, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Open a repository from a URL" [width]="520" (submitted)="clone()">
      <p class="dialog-hint">
        <strong>Experimental.</strong> wasm-git clones a public repository into this browser's private storage, and the demo opens a copy of
        it. The server must allow requests from this page, or go through a relay. What you change stays in the page.
      </p>
      <label class="field">
        Repository URL
        <input class="input mono" spellcheck="false" [value]="url()" (input)="url.set($any($event.target).value)" />
      </label>
      <label class="check">
        <input type="checkbox" [checked]="relayed()" (change)="relayed.set($any($event.target).checked)" />
        Through a relay
      </label>
      @if (relayed()) {
        <label class="field">
          Relay
          <input class="input mono" spellcheck="false" [value]="relay()" (input)="relay.set($any($event.target).value)" />
        </label>
        <p class="dialog-hint">The relay sees which repository you clone; it fetches public https:// repositories only.</p>
      }
      @if (support(); as support) {
        <p class="dialog-hint" data-testid="wasm-git-variant">{{ support }}</p>
      }
      @if (problem()) {
        <p class="problem" role="alert">{{ problem() }}</p>
      }
      @if (stored().length) {
        <div class="field">
          Stored in this browser
          @for (clone of stored(); track clone.name) {
            <div class="stored">
              <span class="grow ellipsis mono" [title]="clone.url">{{ clone.url }}</span>
              <span class="when">{{ relativeTime(clone.clonedAt, now, "short") }}</span>
              <button type="button" class="btn btn-default btn-s" [disabled]="busy()" (click)="reopen(clone)"><span>Open</span></button>
              <button
                type="button"
                class="btn btn-ghost btn-s"
                [attr.aria-label]="'Delete the clone of ' + clone.url"
                [disabled]="busy()"
                (click)="remove(clone)"
              >
                <svg gd-icon name="trash-2" [size]="13"></svg>
              </button>
            </div>
          }
        </div>
      }
      <footer>
        @if (busy()) {
          <span class="grow busy"><span class="spinner"></span> {{ busy() }}</span>
        }
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!!busy() || !url().trim()"><span>Clone and open</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }
    .stored {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: normal;
    }
    .when {
      color: var(--text-3);
      font-size: 12px;
    }
    .problem {
      color: var(--red);
      font-size: 12.5px;
      white-space: pre-wrap;
    }
    .busy {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-2);
      font-size: 12.5px;
    }
  `,
})
export class RealRepositoryDialog {
  protected readonly dialog = inject<DialogRef<Location>>(DialogRef);
  private readonly controls = inject(Demo).realRepositories!;
  protected readonly url = signal(PLAYGROUND);
  protected readonly relayed = signal(false);
  protected readonly relay = signal(LOCAL_RELAY);
  protected readonly stored = signal<StoredClone[]>([]);
  protected readonly busy = signal("");
  protected readonly support = signal("");
  protected readonly problem = signal("");
  protected readonly relativeTime = relativeTime;
  protected readonly now = Date.now();

  constructor() {
    void this.refresh();
    void this.controls.probe().then(
      (probe) => {
        console.info("[real-repositories] probe", JSON.stringify(probe));
        this.support.set(
          probe.variant
            ? `This browser gets wasm-git's ${VARIANTS[probe.variant]} build.`
            : "This browser has no origin private file system, so it can't keep a clone.",
        );
      },
      () => this.support.set("wasm-git didn't load in this browser."),
    );
  }

  protected clone(): Promise<void> {
    return this.run("Cloning…", () => this.controls.clone(this.url(), this.relayed() ? this.relay().trim() : null));
  }

  protected reopen(clone: StoredClone): Promise<void> {
    return this.run("Opening…", () => this.controls.reopen(clone.name));
  }

  protected async remove(clone: StoredClone): Promise<void> {
    await this.controls.remove(clone.name);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.stored.set(await this.controls.stored().catch(() => []));
  }

  private async run(label: string, action: () => Promise<OpenedClone>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(label);
    this.problem.set("");
    try {
      const { location, measurement } = await action();
      // For the spike's measurements (wiki: Architecture/Demo-real-repositories).
      console.info("[real-repositories]", JSON.stringify(measurement));
      this.dialog.close(location);
    } catch (error) {
      this.problem.set(error instanceof Error ? error.message : String(error));
      await this.refresh();
    } finally {
      this.busy.set("");
    }
  }
}
