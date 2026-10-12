/**
 * Myers' difference algorithm on lines, as Git's default diff finds them.
 * Diffs, merges and staging in the in-memory repository all build on it.
 */

/** Lines `aStart` up to `aEnd` of the first version become lines `bStart` up to `bEnd` of the second; 0-based. */
export interface LineChange {
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

/** Edits beyond this many make the rest of the files one change: quick, and still correct. */
const MAX_EDITS = 4000;

/** A text's lines, each with its line break; the last one may lack it. */
export const splitLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** The runs of lines that differ between `a` and `b`, in order. */
export function diffLines(a: readonly string[], b: readonly string[]): LineChange[] {
  // Lines both versions start or end with are never part of a change.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const changes = middle(a.slice(start, endA), b.slice(start, endB));
  return changes.map((change) => ({
    aStart: change.aStart + start,
    aEnd: change.aEnd + start,
    bStart: change.bStart + start,
    bEnd: change.bEnd + start,
  }));
}

/** Myers' greedy algorithm with its trace, walked back into runs of changed lines. */
function middle(a: readonly string[], b: readonly string[]): LineChange[] {
  const n = a.length;
  const m = b.length;
  if (!n && !m) return [];
  if (!n || !m) return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, MAX_EDITS) && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];

  // Back from the end: each step of the trace is one removed or added line after a diagonal of equal ones.
  const removed = new Uint8Array(n);
  const added = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const previous = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && previous[offset + k - 1]! < previous[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = previous[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (down) added[--y] = 1;
    else removed[--x] = 1;
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && !removed[i] && !added[j]) {
      i++;
      j++;
      continue;
    }
    const aStart = i;
    const bStart = j;
    while (i < n && removed[i]) i++;
    while (j < m && added[j]) j++;
    changes.push({ aStart, aEnd: i, bStart, bEnd: j });
  }
  return changes;
}
