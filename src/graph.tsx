import type { Commit } from "../shared/types";
const colors = [
  "#169a87",
  "#7085d4",
  "#cf954f",
  "#a977be",
  "#538faf",
  "#c9797e",
];
export function CommitGraph({
  commits,
  selected,
  onSelect,
}: {
  commits: Commit[];
  selected: string | null;
  onSelect: (c: Commit) => void;
}) {
  const active: string[] = [];
  const rows = commits.map((commit, index) => {
    let lane = active.indexOf(commit.hash);
    // A branch tip has no child above it, so no line enters its lane from the top.
    const before = [...active];
    if (lane < 0) {
      lane = active.indexOf("");
      if (lane < 0) lane = active.length;
      active[lane] = commit.hash;
    }
    active[lane] = "";
    const edges: { from: number; to: number; color: string }[] = [];
    commit.parents.forEach((parent, p) => {
      let target = active.indexOf(parent);
      if (target < 0) {
        target = p === 0 && active[lane] === "" ? lane : active.indexOf("");
        if (target < 0) target = active.length;
        active[target] = parent;
      }
      edges.push({
        from: lane,
        to: target,
        color: colors[target % colors.length],
      });
    });
    before.forEach((id, l) => {
      if (id && l !== lane)
        edges.push({ from: l, to: l, color: colors[l % colors.length] });
    });
    return { commit, index, lane, before, edges };
  });
  const lanes = Math.max(
    2,
    ...rows.flatMap((r) => [r.lane + 1, ...r.edges.map((e) => e.to + 1)]),
  );
  const width = lanes * 18 + 22;
  return (
    <div className="history-list">
      {rows.map(({ commit, lane, before, edges }) => (
        <button
          key={commit.hash}
          className={
            "history-row " + (selected === commit.hash ? "selected" : "")
          }
          onClick={() => onSelect(commit)}
        >
          <svg
            width={width}
            height="65"
            aria-label={commit.parents.length > 1 ? "Merge commit" : "Commit"}
            style={{ flexShrink: 0 }}
          >
            {before.map((id, l) =>
              id ? (
                <path
                  key={"in" + l}
                  d={`M ${15 + l * 18} 0 L ${15 + l * 18} 27`}
                  stroke={colors[l % colors.length]}
                  strokeWidth="2"
                  fill="none"
                />
              ) : null,
            )}
            {edges.map((e, i) => (
              <path
                key={i}
                d={`M ${15 + e.from * 18} 27 C ${15 + e.from * 18} 46 ${15 + e.to * 18} 46 ${15 + e.to * 18} 65`}
                stroke={e.color}
                strokeWidth="2"
                fill="none"
              />
            ))}
            <circle
              cx={15 + lane * 18}
              cy="27"
              r={commit.parents.length > 1 ? 5 : 4}
              fill="white"
              stroke={colors[lane % colors.length]}
              strokeWidth="2"
            />
          </svg>
          <span className="commit-copy">
            <strong>{commit.subject}</strong>
            <span>
              {commit.author} · {new Date(commit.date).toLocaleDateString()}{" "}
              {commit.refs && <em>{commit.refs}</em>}
            </span>
          </span>
          <code>{commit.hash.slice(0, 7)}</code>
        </button>
      ))}
    </div>
  );
}
