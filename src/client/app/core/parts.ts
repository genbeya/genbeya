/**
 * Which parts of the app show: those the project uses (`unused` in
 * `.genbeya.yml` lists the others) and the user doesn't hide, with the parts
 * that need a hidden one. Files are never touched; references into a hidden
 * part still open it.
 */
import { computed, Injectable, inject } from "@angular/core";
import { PART_NEEDS, PARTS, repositoryKey, shownParts, type Part } from "../../../contracts/model";
import { Session } from "./session";

/** The views of the sidebar that are parts, in its order. */
const VIEW_PARTS = ["wiki", "tasks", "code", "changes", "history", "pulls"] as const satisfies readonly Part[];

@Injectable({ providedIn: "root" })
export class Parts {
  private readonly session = inject(Session);
  private readonly key = computed(() => {
    const location = this.session.snapshot()?.location;
    return location ? repositoryKey(location) : null;
  });
  /** What the project leaves out. */
  readonly unused = computed(() => this.session.snapshot()?.settings.unused ?? []);
  /** The parts the project uses, with the parts that need an unused one left out too. */
  readonly used = computed(() => shownParts(this.unused()));
  /** Whether the user's choices are for this repository alone, rather than the ones for every repository. */
  readonly ownChoice = computed(() => {
    const key = this.key();
    return !!key && Object.hasOwn(this.session.preferences().hiddenParts.repositories, key);
  });
  /** What the user hides here: this repository's choice, else the one for every repository. */
  readonly hidden = computed((): readonly Part[] => {
    const { all, repositories } = this.session.preferences().hiddenParts;
    const key = this.key();
    return (key && repositories[key]) || all;
  });
  readonly shown = computed(() => shownParts([...this.unused(), ...this.hidden()]));

  isShown(part: Part): boolean {
    return this.shown().has(part);
  }

  /** The first view that shows, where a repository opens; Settings when none does. */
  readonly home = computed(() => VIEW_PARTS.find((part) => this.isShown(part)) ?? "settings");

  /**
   * Hides or shows `part` for the user: in this repository alone, or in
   * every repository that has no choice of its own. Showing a part shows
   * the parts it needs, so it can show.
   */
  async setHidden(part: Part, hide: boolean, everywhere: boolean): Promise<void> {
    const { all, repositories } = this.session.preferences().hiddenParts;
    const key = this.key();
    const current = new Set(everywhere || !key ? all : (repositories[key] ?? all));
    if (hide) current.add(part);
    else for (let need: Part | undefined = part; need; need = PART_NEEDS[need]) current.delete(need);
    const parts = PARTS.filter((candidate) => current.has(candidate));
    const others = Object.fromEntries(Object.entries(repositories).filter(([other]) => other !== key));
    await this.session.setPreferences({
      hiddenParts: everywhere || !key ? { all: parts, repositories: others } : { all, repositories: { ...others, [key]: parts } },
    });
  }

  /** Makes this repository follow the choice for every repository again, or keep its own, starting from that one. */
  async setOwnChoice(own: boolean): Promise<void> {
    const { all, repositories } = this.session.preferences().hiddenParts;
    const key = this.key();
    if (!key) return;
    const others = Object.fromEntries(Object.entries(repositories).filter(([other]) => other !== key));
    await this.session.setPreferences({ hiddenParts: { all, repositories: own ? { ...others, [key]: this.hidden() } : others } });
  }
}
