import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { Demo } from "../../core/demo";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";

/** Says that this is the web demo, and offers to start over or get the app; nothing in the demo build otherwise. */
@Component({
  selector: "gd-demo-badge",
  imports: [CdkMenu, CdkMenuTrigger, Icon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (demo.active) {
      <button
        type="button"
        class="demo-badge"
        title="About this demo"
        [cdkMenuTriggerFor]="menu"
        #trigger="cdkMenuTriggerFor"
        [class.is-open]="trigger.isOpen()"
      >
        <span class="demo-pill">Demo</span>
        <span class="grow ellipsis">Runs in your browser</span>
        <svg gd-icon name="chevrons-up-down" [size]="13"></svg>
      </button>
      <ng-template #menu>
        <div class="menu" cdkMenu [style.width.px]="280">
          <p class="demo-note">
            Genbeya runs here in your browser, on a sample project with a simulated remote. Nothing you do is saved or sent anywhere, and
            reloading the page starts over.
          </p>
          <div class="menu-separator"></div>
          <button gd-menu-item (selected)="demo.reset()"><svg icon gd-icon name="undo-2" [size]="14"></svg>Reset demo</button>
          @if (demo.realRepositories) {
            <button gd-menu-item (selected)="demo.openFromUrl()">
              <svg icon gd-icon name="flask-conical" [size]="14"></svg>Open a repository from a URL (experimental)
            </button>
            @if (demo.isClone()) {
              <button gd-menu-item (selected)="demo.pushWithWasmGit()">
                <svg icon gd-icon name="cloud-upload" [size]="14"></svg>Push new commits with wasm-git (experimental)
              </button>
            }
          }
          <button gd-menu-item (selected)="demo.download()">
            <svg icon gd-icon name="external-link" [size]="14"></svg>Download Genbeya
          </button>
        </div>
      </ng-template>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .demo-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 30px;
      padding: 0 8px 0 7px;
      border: 0;
      border-radius: var(--radius);
      background: none;
      color: var(--text-2);
      font-size: 12.5px;
      text-align: left;
    }
    .demo-badge:hover,
    .demo-badge.is-open {
      background: var(--bg-hover);
      color: var(--text);
    }
    .demo-badge svg {
      flex: none;
      color: var(--text-3);
    }
    .demo-pill {
      flex: none;
      padding: 0 6px;
      border-radius: 4px;
      background: var(--accent-soft);
      color: var(--accent-text);
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
      line-height: 18px;
      text-transform: uppercase;
    }
    .demo-note {
      margin: 6px 8px 8px;
      color: var(--text-2);
      font-size: 12px;
      line-height: 1.45;
    }
  `,
})
export class DemoBadge {
  protected readonly demo = inject(Demo);
}
