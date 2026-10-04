import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, GitCommitHorizontal, GitMerge } from "lucide-react";
import type { Commit, CommitDetail } from "../../../shared/api";
import { api, errorMessage } from "../../api";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { Avatar, Button, EmptyState, IconButton, Spinner } from "../../components/controls";
import { usePanelWidth } from "../../components/Resizer";
import { useToast } from "../../components/Toasts";
import { DiffPane } from "../changes/ChangesView";
import { layoutGraph, type GraphRow } from "./graph";
import "./history.css";

const PAGE = 200;
const LANE = 14;
const ROW = 44;
const COLORS = ["var(--accent)", "var(--green)", "var(--orange)", "var(--blue)", "var(--purple)", "var(--yellow)", "var(--red)"];
const color = (lane: number) => COLORS[lane % COLORS.length];
const x = (lane: number) => 12 + lane * LANE;

export function relativeTime(iso: string) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let value = seconds;
  for (const [size, unit] of units) {
    if (Math.abs(value) < size) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.round(value), unit);
    value /= size;
  }
  return "";
}

function Lines({ row, width }: { row: GraphRow; width: number }) {
  const mid = ROW / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  return (
    <svg width={width} height={ROW} className="graph" aria-hidden>
      {row.through.map(([from, to]) => (
        <path key={"t" + from} d={curve(x(from), 0, x(to), ROW)} stroke={color(from)} />
      ))}
      {row.into.map((l) => (
        <path key={"i" + l} d={curve(x(l), 0, x(row.lane), mid)} stroke={color(l)} />
      ))}
      {row.out.map((l, i) => (
        <path key={"o" + i} d={curve(x(row.lane), mid, x(l), ROW)} stroke={color(l === row.lane ? row.lane : l)} />
      ))}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={row.commit.parents.length > 1 ? 4.5 : 3.5}
        fill={row.commit.parents.length > 1 ? "var(--bg-panel)" : color(row.lane)}
        stroke={color(row.lane)}
        strokeWidth="2"
      />
    </svg>
  );
}

function Refs({ refs }: { refs: string[] }) {
  return (
    <>
      {refs.map((ref) => {
        const head = ref.startsWith("HEAD -> ");
        const name = ref.replace(/^HEAD -> /, "").replace(/^tag: /, "");
        const kind = ref.startsWith("tag: ") ? "tag" : name.includes("/") && !head ? "remote" : "branch";
        return (
          <span key={ref} className={`ref-chip ref-${kind} ${head ? "is-head" : ""}`}>
            {name}
          </span>
        );
      })}
    </>
  );
}

export function HistoryView() {
  const { snapshot } = useWorkspace();
  const { route, navigate } = useRouter();
  const r = route.view === "history" ? route : { view: "history" as const };
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { width, handle } = usePanelWidth("history", 520, 340, 900);

  const head = snapshot.head.commit;
  const load = useCallback(async (skip: number) => {
    try {
      const page = await api().log(skip, PAGE);
      setCommits((old) => (skip ? [...(old ?? []), ...page] : page));
      setMore(page.length === PAGE);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  // Reload when HEAD or any branch moves.
  useEffect(() => {
    void load(0);
  }, [head, snapshot.branches.join(), snapshot.remoteBranches.join(), load]);

  const graph = useMemo(() => layoutGraph(commits ?? []), [commits]);
  const graphWidth = Math.min(graph.lanes, 12) * LANE + 12;

  useEffect(() => {
    if (!r.commit && commits?.[0]) navigate({ view: "history", commit: commits[0].hash }, { replace: true });
  }, [r.commit, commits]);

  if (error) return <EmptyState title="Can't read history"><p className="selectable">{error}</p></EmptyState>;
  if (!commits)
    return (
      <div className="editor-loading">
        <Spinner />
      </div>
    );
  if (!commits.length)
    return (
      <EmptyState icon={<GitCommitHorizontal size={20} />} title="No commits yet">
        <p>Commit your first changes in Changes.</p>
      </EmptyState>
    );

  return (
    <div className="view">
      <div className="view-body">
        <aside className="side-panel history-list" style={{ width }}>
          <div className="side-panel-scroll">
            {graph.rows.map((row) => (
              <button
                key={row.commit.hash}
                className={`history-row ${r.commit === row.commit.hash ? "is-selected" : ""}`}
                onClick={() => navigate({ view: "history", commit: row.commit.hash }, { replace: true })}
              >
                <Lines row={row} width={graphWidth} />
                <span className="history-text">
                  <span className="history-subject ellipsis">
                    <Refs refs={row.commit.refs} />
                    {row.commit.subject}
                  </span>
                  <span className="history-meta ellipsis">
                    {row.commit.author} · {relativeTime(row.commit.date)}
                  </span>
                </span>
              </button>
            ))}
            {more && (
              <div className="history-more">
                <Button size="s" variant="ghost" onClick={() => void load(commits.length)}>
                  Load older commits
                </Button>
              </div>
            )}
          </div>
        </aside>
        {handle}
        <section className="wiki-main">{r.commit && <CommitPane key={r.commit} hash={r.commit} file={r.file} />}</section>
      </div>
    </div>
  );
}

function CommitPane({ hash, file }: { hash: string; file?: string }) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api()
      .commitDetail(hash)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e)));
  }, [hash]);

  useEffect(() => {
    if (detail && !file && detail.files[0])
      navigate({ view: "history", commit: hash, file: detail.files[0].path }, { replace: true });
  }, [detail, file]);

  if (error) return <EmptyState title="Can't read this commit"><p>{error}</p></EmptyState>;
  if (!detail)
    return (
      <div className="editor-loading">
        <Spinner />
      </div>
    );
  const { commit, body, files } = detail;
  const selected = files.find((f) => f.path === file);
  return (
    <div className="view">
      <div className="commit-head">
        <div className="commit-title selectable">
          {commit.parents.length > 1 && <GitMerge size={16} className="faint" />}
          <h2>{commit.subject}</h2>
        </div>
        {body && <pre className="commit-body selectable">{body}</pre>}
        <div className="commit-meta">
          <Avatar name={commit.author} size={18} />
          <span title={commit.email}>{commit.author}</span>
          <span className="faint" title={new Date(commit.date).toLocaleString()}>
            {relativeTime(commit.date)}
          </span>
          <span className="grow" />
          <Refs refs={commit.refs} />
          <button
            className="hash-chip mono"
            title="Copy commit ID"
            onClick={() => (void navigator.clipboard?.writeText(commit.hash), toast.success("Commit ID copied"))}
          >
            {commit.hash.slice(0, 8)}
            <Copy size={11} />
          </button>
        </div>
        <div className="commit-files">
          {files.map((f) => (
            <button
              key={f.path}
              className={`commit-file ${f.path === file ? "is-selected" : ""}`}
              onClick={() => navigate({ view: "history", commit: hash, file: f.path }, { replace: true })}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
            >
              <span className={`status-letter ${f.status}`}>{f.status}</span>
              <span className="ellipsis">{f.path}</span>
            </button>
          ))}
          {!files.length && <p className="faint">No file changes.</p>}
        </div>
      </div>
      {selected && (
        <div className="commit-diff">
          <DiffPane
            key={selected.path}
            path={selected.path}
            badge={commit.parents.length > 1 ? "vs. first parent" : undefined}
            load={() => api().diff(selected.path, { commit: hash }, selected.oldPath)}
            actions={
              <IconButton label="Open in code" onClick={() => navigate({ view: "code", file: selected.path })}>
                <GitCommitHorizontal size={15} />
              </IconButton>
            }
          />
        </div>
      )}
    </div>
  );
}
