/**
 * Applies the appearance preferences: the theme (`data-theme` on the page, and
 * the shell's native parts), and the editor font with or without ligatures.
 */
import { computed, DestroyRef, effect, Injectable, inject, signal } from "@angular/core";
import type { EditorFont } from "../../../contracts/model";
import { SHELL } from "../platform/platform";

/** The font stack of each editor font: the bundled font, then the usual fallbacks. */
const FONT_STACKS: Readonly<Record<EditorFont, string>> = {
  "jetbrains-mono": '"JetBrains Mono Variable"',
  "fira-code": '"Fira Code Variable"',
  "cascadia-code": '"Cascadia Code Variable"',
  "roboto-mono": '"Roboto Mono Variable"',
};
const FALLBACK = '"Cascadia Code", Consolas, monospace';
import { Session } from "./session";

@Injectable({ providedIn: "root" })
export class Theme {
  private readonly session = inject(Session);
  private readonly systemLight = signal(matchMedia("(prefers-color-scheme: light)").matches);
  /** The theme in effect, for code that draws its own colours (editors, diagrams). */
  readonly resolved = computed<"light" | "dark">(() => {
    const theme = this.session.preferences().theme;
    return theme === "system" ? (this.systemLight() ? "light" : "dark") : theme;
  });

  constructor() {
    const shell = inject(SHELL);
    const media = matchMedia("(prefers-color-scheme: light)");
    const follow = (event: MediaQueryListEvent) => this.systemLight.set(event.matches);
    media.addEventListener("change", follow);
    inject(DestroyRef).onDestroy(() => media.removeEventListener("change", follow));
    effect(() => {
      const theme = this.session.preferences().theme;
      document.documentElement.dataset["theme"] = theme;
      shell.setTheme(theme);
    });
    effect(() => {
      const { editorFont, ligatures } = this.session.preferences();
      const root = document.documentElement.style;
      root.setProperty("--font-mono", `${FONT_STACKS[editorFont] ?? FONT_STACKS["jetbrains-mono"]}, ${FALLBACK}`);
      root.setProperty("--mono-ligatures", ligatures ? "normal" : "none");
    });
  }
}
