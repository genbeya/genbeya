import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, ViewEncapsulation } from "@angular/core";
import { LucideChevronDown, LucidePlus, LucideSquareTerminal, LucideX } from "@lucide/angular";
import { CTRL_KEY } from "../../core/hotkeys";
import { Terminals } from "../../core/terminals";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { TerminalView } from "./terminal-view";

/**
 * The bottom panel of the shell: a tab per terminal, as tall as the user
 * drags it. The tabs follow the ARIA tabs pattern with manual activation:
 * arrows move between tabs, Enter opens one (its terminal takes the
 * keyboard), Delete closes one.
 */
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
            @let selected = tab.key === terminals.active();
            <button
              type="button"
              role="tab"
              class="terminal-tab"
              [id]="'terminal-tab-' + tab.key"
              [attr.aria-controls]="'terminal-tabpanel-' + tab.key"
              [attr.aria-selected]="selected"
              [tabIndex]="selected ? 0 : -1"
              aria-keyshortcuts="Delete"
              [class.is-active]="selected"
              (click)="terminals.select(tab.key)"
              (keydown)="moveFocus($event)"
              (keydown.delete)="close(tab.key)"
            >
              <svg lucideSquareTerminal [size]="14" aria-hidden="true"></svg>{{ tab.title }}
              <!-- For the mouse; the keyboard closes the focused tab with Delete. A button inside a tab is not allowed. -->
              <span class="terminal-tab-close" aria-hidden="true" title="Close (Delete)" (click)="$event.stopPropagation(); close(tab.key)">
                <svg lucideX [size]="13"></svg>
              </span>
            </button>
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
              [id]="'terminal-tabpanel-' + tab.key"
              [attr.aria-labelledby]="'terminal-tab-' + tab.key"
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
  protected readonly hideTitle = `Hide (${CTRL_KEY}+\`)`;
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  /** Left and Right (wrapping), Home and End move the focus between tabs. */
  protected moveFocus(event: KeyboardEvent) {
    const tabs = [...this.element.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.indexOf(event.currentTarget as HTMLElement);
    const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (index < 0 || target === undefined) return;
    event.preventDefault();
    tabs[(target + tabs.length) % tabs.length]!.focus();
  }

  /** Closes a tab and focuses its neighbour, after the terminal that becomes active took the focus. */
  protected close(key: number) {
    const index = this.terminals.tabs().findIndex((tab) => tab.key === key);
    this.terminals.close(key);
    const rest = this.terminals.tabs();
    const neighbour = rest[Math.min(index, rest.length - 1)];
    if (neighbour)
      afterNextRender(
        { read: () => this.element.querySelector<HTMLElement>(`#terminal-tab-${neighbour.key}`)?.focus() },
        { injector: this.injector },
      );
  }
}
