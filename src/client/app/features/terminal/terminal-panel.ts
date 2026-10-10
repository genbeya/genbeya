import { ChangeDetectionStrategy, Component, inject, ViewEncapsulation } from "@angular/core";
import { LucideChevronDown, LucidePlus, LucideSquareTerminal, LucideX } from "@lucide/angular";
import { MOD_KEY } from "../../core/hotkeys";
import { Terminals } from "../../core/terminals";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { TerminalView } from "./terminal-view";

/** The bottom panel of the shell: a tab per terminal, as tall as the user drags it. */
@Component({
  selector: "gd-terminal-panel",
  imports: [Resizable, ResizeHandle, TerminalView, LucideChevronDown, LucidePlus, LucideSquareTerminal, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // xterm.js builds its own DOM, which emulated encapsulation would not reach.
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./terminal-panel.css",
  template: `
    <section
      class="terminal-panel"
      aria-label="Terminal"
      gdResizable="terminal"
      edge="top"
      [initial]="280"
      [min]="120"
      [max]="1200"
      #panel="gdResizable"
      [hidden]="!terminals.shown()"
    >
      <div [gdResizeHandle]="panel"></div>
      <header class="terminal-header">
        <div class="terminal-tabs" role="tablist" aria-label="Terminals">
          @for (tab of terminals.tabs(); track tab.key) {
            <div class="terminal-tab" [class.is-active]="tab.key === terminals.active()">
              <button
                type="button"
                role="tab"
                class="terminal-tab-name"
                [attr.aria-selected]="tab.key === terminals.active()"
                (click)="terminals.select(tab.key)"
              >
                <svg lucideSquareTerminal [size]="14" aria-hidden="true"></svg>{{ tab.title }}
              </button>
              <button type="button" class="icon-btn" [attr.aria-label]="'Close ' + tab.title" (click)="terminals.close(tab.key)">
                <svg lucideX [size]="13" aria-hidden="true"></svg>
              </button>
            </div>
          }
        </div>
        @if (terminals.available()) {
          <button type="button" class="icon-btn" aria-label="New terminal" title="New terminal" (click)="terminals.add()">
            <svg lucidePlus [size]="15" aria-hidden="true"></svg>
          </button>
        }
        <span class="grow"></span>
        <button type="button" class="icon-btn" aria-label="Hide terminal" [title]="hideTitle" (click)="terminals.toggle()">
          <svg lucideChevronDown [size]="15" aria-hidden="true"></svg>
        </button>
      </header>
      @if (terminals.available() === false) {
        <p class="terminal-unavailable">The terminal is not available in this build.</p>
      } @else {
        <div class="terminal-body">
          @for (tab of terminals.tabs(); track tab.key) {
            <gd-terminal-view
              role="tabpanel"
              [attr.aria-label]="tab.title"
              [key]="tab.key"
              [active]="terminals.shown() && tab.key === terminals.active()"
              [hidden]="tab.key !== terminals.active()"
            />
          }
        </div>
      }
    </section>
  `,
})
export class TerminalPanel {
  protected readonly terminals = inject(Terminals);
  protected readonly hideTitle = `Hide (${MOD_KEY}+\`)`;
}
