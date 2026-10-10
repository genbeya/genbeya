import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
} from "@angular/core";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { isMac, matchesHotkey } from "../../core/hotkeys";
import { Theme } from "../../core/theme";
import { Terminals, TOGGLE_TERMINAL } from "../../core/terminals";
import { terminalTheme, XTERM } from "./xterm";

const FONT_SIZE = 13;

/** One tab's terminal: xterm.js showing the tab's shell, sized to fit the panel. */
@Component({
  selector: "gd-terminal-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "terminal-view" },
  template: ``,
})
export class TerminalView {
  readonly key = input.required<number>();
  /** The visible tab of a visible panel: it takes the keyboard. */
  readonly active = input(false);
  private readonly terminals = inject(Terminals);
  private readonly theme = inject(Theme);
  private readonly loadXterm = inject(XTERM);
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private terminal: Terminal | null = null;
  private fit: FitAddon | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => void this.start());
    const resized = new ResizeObserver(() => this.resize());
    resized.observe(this.element);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      resized.disconnect();
      this.terminal?.dispose();
    });
    afterRenderEffect(() => {
      this.theme.resolved();
      if (this.terminal) this.terminal.options.theme = terminalTheme(getComputedStyle(this.element));
    });
    afterRenderEffect(() => {
      if (!this.active()) return;
      this.resize();
      this.terminal?.focus();
    });
  }

  private async start() {
    const { Terminal, FitAddon } = await this.loadXterm();
    const style = getComputedStyle(this.element);
    const fontFamily = style.getPropertyValue("--font-mono").trim();
    // Character cells are measured once; the web font must be there by then.
    await document.fonts.load(`${FONT_SIZE}px ${fontFamily}`).catch(() => undefined);
    if (this.destroyed) return;
    const terminal = new Terminal({
      fontFamily,
      fontSize: FONT_SIZE,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme(style),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.attachCustomKeyEventHandler((event) => this.forTerminal(event, terminal));
    terminal.open(this.element);
    this.terminal = terminal;
    this.fit = fit;
    this.resize();
    const key = this.key();
    terminal.onData((data) => this.terminals.write(key, data));
    terminal.onResize(({ cols, rows }) => this.terminals.resize(key, cols, rows));
    if (this.active()) terminal.focus();
    this.terminals.connect(key, terminal.cols, terminal.rows, {
      write: (data) => terminal.write(data),
      end: (note) => terminal.write(`\r\n\x1b[2m${note}\x1b[22m\r\n`),
    });
  }

  /**
   * False hands a key to the browser instead of the shell: the panel's own
   * shortcut, and copying and pasting with Ctrl as in other Windows and Linux
   * terminals (Ctrl+C without a selection still interrupts).
   */
  private forTerminal(event: KeyboardEvent, terminal: Terminal): boolean {
    if (matchesHotkey(TOGGLE_TERMINAL, event)) return false;
    if (isMac || !event.ctrlKey || event.altKey) return true;
    const key = event.key.toLowerCase();
    return !(key === "v" || (key === "c" && terminal.hasSelection()));
  }

  /** Fits the terminal to its box; hidden tabs have none and keep their size. */
  private resize() {
    if (this.element.offsetWidth && this.element.offsetHeight) this.fit?.fit();
  }
}
