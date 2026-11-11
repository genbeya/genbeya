/**
 * Which parts of the app show: those the project uses (`unused` in
 * `.genbeya.yml` lists the others) and the user doesn't hide, with the parts
 * that need a hidden one. Planning, the time log and pull requests show by
 * themselves once the project uses them, unless the user chose otherwise.
 * Files are never touched; references into a hidden part still open it.
 */
import { computed, effect, Injectable, inject, untracked } from "@angular/core";
import {
  AUTOMATIC_PARTS,
  PART_NEEDS,
  PARTS,
  repositoryKey,
  shownParts,
  SKIPPABLE_AREAS,
  type Part,
  type SkippedArea,
  type PartChoices,
  type Snapshot,
} from "../../../contracts/model";
import { PLANNING_FIELDS, timeLogOf } from "../../../utilities/planning";
import { Session } from "./session";

/** The views of the sidebar that are parts, in its order. */
const VIEW_PARTS = ["wiki", "tasks", "code", "changes", "history", "pulls"] as const satisfies readonly Part[];

const PLANNING_NAMES = new Set<string>(Object.values(PLANNING_FIELDS));

/** Whether the project uses an automatic part: planning fields, a time log, pull request files. */
export function usesPart(part: Part, snapshot: Pick<Snapshot, "settings" | "tasks" | "pulls">): boolean {
  const logs = () => snapshot.tasks.some((task) => timeLogOf(task.body).entries.length > 0);
  switch (part) {
    case "planning":
      return snapshot.settings.fields.some((field) => PLANNING_NAMES.has(field.name)) || logs();
    case "timelog":
      return logs();
    case "pulls":
      return snapshot.pulls.length > 0;
    default:
      return true;
  }
}

@Injectable({ providedIn: "root" })
export class Parts {
  private readonly session = inject(Session);
  private readonly key = computed(() => {
    const location = this.session.snapshot()?.location;
    return location ? repositoryKey(location) : null;
  });
  /** What the project leaves out. */
  readonly unused = computed(() => this.session.snapshot()?.settings.unused ?? []);
  /** Whether the user's choices are for this repository alone, rather than the ones for every repository. */
  readonly ownChoice = computed(() => {
    const key = this.key();
    return !!key && Object.hasOwn(this.session.preferences().parts.repositories, key);
  });
  /** What the user chose here: this repository's choices, else the ones for every repository. */
  readonly choices = computed((): PartChoices => {
    const { all, repositories } = this.session.preferences().parts;
    const key = this.key();
    return (key && repositories[key]) || all;
  });
  /** Automatic parts the project uses now. */
  private readonly inUse = computed(() => {
    const snapshot = this.session.snapshot();
    return new Set(AUTOMATIC_PARTS.filter((part) => !snapshot || usesPart(part, snapshot)));
  });
  /** Whether a part is left to the project's use of it, rather than the user's choice. */
  readonly isAutomatic = (part: Part): boolean => AUTOMATIC_PARTS.includes(part) && this.choices()[part] === undefined;
  /** What the user doesn't see here, the project's unused parts aside. */
  readonly hidden = computed(() =>
    PARTS.filter((part) => {
      const choice = this.choices()[part];
      return choice === false || (choice === undefined && AUTOMATIC_PARTS.includes(part) && !this.inUse().has(part));
    }),
  );
  readonly shown = computed(() => shownParts([...this.unused(), ...this.hidden()]));

  isShown(part: Part): boolean {
    return this.shown().has(part);
  }

  /**
   * What the palette offers: what shows, and automatic parts the project
   * doesn't use yet, so the first pull request can be opened from there.
   */
  readonly offered = computed(() => {
    const unused = this.unused();
    const waiting = AUTOMATIC_PARTS.filter((part) => this.isAutomatic(part) && !unused.includes(part));
    return new Set([...this.shown(), ...waiting]);
  });

  /** The first view that shows, where a repository opens; Settings when none does. */
  readonly home = computed(() => VIEW_PARTS.find((part) => this.isShown(part)) ?? "settings");

  /**
   * Areas the user turned off, or the project doesn't use: snapshots leave
   * them out, so a large repository doesn't read tasks nobody shows. Parts
   * that are off only until the project uses them are still read, to notice that.
   */
  readonly skipped = computed((): SkippedArea[] => {
    const choices = this.choices();
    const off = new Set<Part>([...this.unused(), ...PARTS.filter((part) => choices[part] === false)]);
    return SKIPPABLE_AREAS.filter((area) => off.has(area));
  });

  constructor() {
    effect(() => {
      const skipped = this.skipped();
      untracked(() => void this.session.skipAreas(skipped));
    });
  }

  /**
   * Shows or hides `part` for the user: in this repository alone, or in
   * every repository that has no choices of its own. Showing a part shows
   * the parts it needs, so it can show.
   */
  async setShown(part: Part, show: boolean, everywhere: boolean): Promise<void> {
    const { all, repositories } = this.session.preferences().parts;
    const key = this.key();
    const changed: Record<string, boolean> = { ...(everywhere || !key ? all : (repositories[key] ?? all)), [part]: show };
    if (show) for (let need = PART_NEEDS[part]; need; need = PART_NEEDS[need]) if (!this.isShown(need)) changed[need] = true;
    const others = Object.fromEntries(Object.entries(repositories).filter(([other]) => other !== key));
    await this.session.setPreferences({
      parts: everywhere || !key ? { all: changed, repositories: others } : { all, repositories: { ...others, [key]: changed } },
    });
  }

  /** Makes this repository follow the choices for every repository again, or keep its own, starting from those. */
  async setOwnChoice(own: boolean): Promise<void> {
    const { all, repositories } = this.session.preferences().parts;
    const key = this.key();
    if (!key) return;
    const others = Object.fromEntries(Object.entries(repositories).filter(([other]) => other !== key));
    await this.session.setPreferences({ parts: { all, repositories: own ? { ...others, [key]: this.choices() } : others } });
  }
}
