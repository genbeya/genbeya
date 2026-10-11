import type { Change } from "../../../../contracts/model";

/** What a context menu of the change lists acts on: a changed file, or a folder of the tree with the changes in it. */
export interface ChangeTarget {
  readonly path: string;
  readonly folder: boolean;
  readonly changes: readonly Change[];
  /** In the staged list. */
  readonly staged: boolean;
}

/** Untracked files only: nothing to stop tracking. */
export const untracked = (target: ChangeTarget): boolean => target.changes.every((change) => change.index === "?");
