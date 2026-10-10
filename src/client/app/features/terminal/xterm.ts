/** xterm.js, loaded when the first terminal opens, and its colours from the design tokens. */
import { InjectionToken } from "@angular/core";
import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal } from "@xterm/xterm";

export interface Xterm {
  readonly Terminal: typeof Terminal;
  readonly FitAddon: typeof FitAddon;
}

/** Loads xterm.js on demand, so it is not part of the initial bundle; tests provide a fake. */
export const XTERM = new InjectionToken<() => Promise<Xterm>>("xterm.js", {
  providedIn: "root",
  factory: () => async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
    return { Terminal, FitAddon };
  },
});

/**
 * The terminal's colours from the tokens in effect. xterm draws with
 * concrete colours, so the tokens are read, not referenced. Black and white
 * are greys that stay readable on both the dark and the light background.
 */
export function terminalTheme(style: CSSStyleDeclaration): ITheme {
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const colours = {
    black: token("text-3"),
    red: token("red"),
    green: token("green"),
    yellow: token("yellow"),
    blue: token("blue"),
    magenta: token("purple"),
    cyan: token("cyan"),
    white: token("text-2"),
  };
  return {
    background: token("bg-panel"),
    foreground: token("text"),
    cursor: token("accent"),
    cursorAccent: token("bg-panel"),
    selectionBackground: token("bg-selected"),
    ...colours,
    brightBlack: token("gray"),
    brightRed: colours.red,
    brightGreen: colours.green,
    brightYellow: colours.yellow,
    brightBlue: colours.blue,
    brightMagenta: colours.magenta,
    brightCyan: colours.cyan,
    brightWhite: token("text"),
  };
}
