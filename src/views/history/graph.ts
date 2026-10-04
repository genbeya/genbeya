import type { Commit } from "../../../shared/api";

export interface GraphRow {
  commit: Commit;
  /** Lane of the commit's dot. */
  lane: number;
  /** Lanes whose line enters from the top and ends in the dot. */
  into: number[];
  /** Lines passing the row: from a lane at the top to a lane at the bottom. */
  through: [number, number][];
  /** Lanes the dot connects to at the bottom (its parents). */
  out: number[];
}

/**
 * Lays out commits (newest first, topologically ordered) on lanes. Each lane
 * holds the commit it is waiting for; a commit takes the lane that waits for
 * it and hands it to its first parent. When the first parent is already
 * awaited further right, that line bends left so the main line stays put.
 */
export function layoutGraph(commits: Commit[]) {
  const waiting: (string | null)[] = [];
  let lanes = 1;
  const rows: GraphRow[] = commits.map((commit) => {
    const into = waiting.flatMap((id, l) => (id === commit.hash ? [l] : []));
    let lane = into[0] ?? waiting.indexOf(null);
    if (lane < 0) lane = waiting.length;
    for (const l of into) waiting[l] = null;
    const bottom = new Map<number, number>();
    waiting.forEach((id, l) => id && bottom.set(l, l));

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
    while (waiting.length && waiting[waiting.length - 1] == null) waiting.pop();
    const through = [...bottom.entries()];
    lanes = Math.max(lanes, lane + 1, ...out.map((l) => l + 1), ...through.map(([l]) => l + 1));
    return { commit, lane, into, through, out };
  });
  return { rows, lanes };
}
