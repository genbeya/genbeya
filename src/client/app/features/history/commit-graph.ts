/** Lays out the commit graph: one row per commit, lines on lanes. */
import type { Commit } from "../../../../contracts/model";

export interface GraphRow {
  readonly commit: Commit;
  /** Lane of the commit's dot. */
  readonly lane: number;
  /** Lanes whose line enters from the top and ends in the dot. */
  readonly into: readonly number[];
  /** Lines passing the row: from a lane at the top to a lane at the bottom. */
  readonly through: readonly (readonly [number, number])[];
  /** Lanes the dot connects to at the bottom (its parents). */
  readonly out: readonly number[];
}

/**
 * Commits come newest first, in topological order. Each lane holds the
 * commit it waits for; a commit takes the lane that waits for it and hands
 * it to its first parent. When the first parent is already awaited further
 * right, that line bends left, so the main line stays put.
 */
export function layoutGraph(commits: readonly Commit[]): { rows: GraphRow[]; lanes: number } {
  const waiting: (string | null)[] = [];
  let lanes = 1;
  const rows = commits.map((commit): GraphRow => {
    const into = waiting.flatMap((id, lane) => (id === commit.hash ? [lane] : []));
    let lane = into[0] ?? waiting.indexOf(null);
    if (lane < 0) lane = waiting.length;
    for (const entering of into) waiting[entering] = null;
    const bottom = new Map<number, number>();
    waiting.forEach((id, index) => id && bottom.set(index, index));

    const out = commit.parents.map((parent, index) => {
      const existing = waiting.indexOf(parent);
      if (index === 0 && existing > lane && waiting[lane] == null) {
        waiting[existing] = null;
        waiting[lane] = parent;
        bottom.set(existing, lane);
        return lane;
      }
      if (existing >= 0) return existing;
      let target = index === 0 && waiting[lane] == null ? lane : waiting.indexOf(null);
      if (target < 0) target = waiting.length;
      waiting[target] = parent;
      return target;
    });
    while (waiting.length && waiting.at(-1) == null) waiting.pop();
    const through = [...bottom.entries()];
    lanes = Math.max(lanes, lane + 1, ...out.map((target) => target + 1), ...through.map(([from]) => from + 1));
    return { commit, lane, into, through, out };
  });
  return { rows, lanes };
}
