import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  CheckCheck,
  Columns2,
  FileCode2,
  Minus,
  Plus,
  RefreshCw,
  Rows2,
  Undo2,
} from "lucide-react";
import type { Change, Diff } from "../../../shared/api";
import { api, errorMessage } from "../../api";
import { modKey, useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { Button, EmptyState, IconButton, Spinner } from "../../components/controls";
import { useDialogs } from "../../components/Dialog";
import { usePanelWidth } from "../../components/Resizer";
import { DiffEditor } from "../../editor/Editor";
import "./changes.css";

const isStaged = (c: Change) => c.index !== " " && c.index !== "?";
const isUnstaged = (c: Change) => c.worktree !== " ";
const letter = (c: Change, staged: boolean) => (staged ? c.index : c.index === "?" ? "U" : c.worktree);

export function useInlineDiff() {
  const [inline, setInline] = useState(() => {
    try {
      return localStorage.getItem("diff:inline") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setInline((value) => {
      try {
        localStorage.setItem("diff:inline", value ? "0" : "1");
      } catch {
        /* Convenience only. */
      }
      return !value;
    });
  return [inline, toggle] as const;
}

export function DiffPane({
  path,
  load,
  badge,
  actions,
}: {
  path: string;
  load(): Promise<Diff>;
  badge?: string;
  actions?: React.ReactNode;
}) {
  const { snapshot } = useWorkspace();
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inline, toggleInline] = useInlineDiff();
  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => !cancelled && (setDiff(d), setError(null)))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path, badge, snapshot.version]);
  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title mono diff-path ellipsis">{path}</div>
        {badge && <span className="diff-badge">{badge}</span>}
        <span className="grow" />
        {actions}
        <IconButton label={inline ? "Side by side" : "Inline"} onClick={toggleInline}>
          {inline ? <Columns2 size={15} /> : <Rows2 size={15} />}
        </IconButton>
      </header>
      {error ? (
        <EmptyState title="Can't show this diff">
          <p className="selectable">{error}</p>
        </EmptyState>
      ) : !diff ? (
        <div className="editor-loading">
          <Spinner />
        </div>
      ) : diff.binary ? (
        <EmptyState title="Binary file">
          <p>GitDesk does not show differences for binary files.</p>
        </EmptyState>
      ) : (
        <DiffEditor path={path} original={diff.original} modified={diff.modified} inline={inline} />
      )}
    </div>
  );
}

export function ChangesView() {
  const { snapshot, run, busy } = useWorkspace();
  const { route, navigate } = useRouter();
  const dialogs = useDialogs();
  const r = route.view === "changes" ? route : { view: "changes" as const };
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const { width, handle } = usePanelWidth("changes", 340, 260, 600);

  const staged = useMemo(() => snapshot.changes.filter(isStaged), [snapshot.changes]);
  const unstaged = useMemo(() => snapshot.changes.filter(isUnstaged), [snapshot.changes]);
  const { head, remotes } = snapshot;
  const remote = head.upstream?.split("/")[0] ?? remotes[0]?.name;

  // Keep a valid selection: fall back to the first change.
  useEffect(() => {
    const list = r.staged ? staged : unstaged;
    if (r.file && list.some((c) => c.path === r.file)) return;
    const first = unstaged[0] ?? staged[0];
    if (first) navigate({ view: "changes", file: first.path, staged: !unstaged[0] }, { replace: true });
    else if (r.file) navigate({ view: "changes" }, { replace: true });
  }, [staged, unstaged, r.file, r.staged]);

  const commitAll = staged.length === 0 && !amend;
  const canCommit = !!message.trim() && (amend || snapshot.changes.length > 0);
  const commit = async () => {
    if (!canCommit) return;
    const done = await run(async () => {
      if (commitAll) await api().stage(snapshot.changes.map((c) => c.path));
      await api().commit(message, amend);
      return true;
    }, amend ? "Commit amended" : "Committed");
    if (done) {
      setMessage("");
      setAmend(false);
    }
  };
  useHotkey("mod+enter", () => void commit());

  const toggleAmend = async (value: boolean) => {
    setAmend(value);
    if (value && !message.trim()) setMessage(await api().lastCommitMessage());
  };

  const discard = async (paths: string[]) => {
    const ok = await dialogs.confirm({
      title: paths.length === 1 ? "Discard changes" : `Discard ${paths.length} changes`,
      message:
        paths.length === 1
          ? `Discard your changes to ${paths[0]}? This cannot be undone.`
          : "Discard all unstaged changes? Untracked files are deleted. This cannot be undone.",
      confirm: "Discard",
      danger: true,
    });
    if (ok) await run(() => api().discard(paths));
  };

  const row = (c: Change, isStagedList: boolean) => {
    const selected = r.file === c.path && !!r.staged === isStagedList;
    const slash = c.path.lastIndexOf("/");
    return (
      <div
        key={(isStagedList ? "s:" : "w:") + c.path}
        role="button"
        tabIndex={0}
        className={`change-row ${selected ? "is-selected" : ""}`}
        onClick={() => navigate({ view: "changes", file: c.path, staged: isStagedList }, { replace: true })}
        onDoubleClick={() => navigate({ view: "code", file: c.path })}
        title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
      >
        <span className="change-name ellipsis">
          {c.path.slice(slash + 1)}
          <span className="change-dir">{slash > 0 ? c.path.slice(0, slash) : ""}</span>
        </span>
        <span className="change-actions">
          <IconButton label="Open file" onClick={(e) => (e.stopPropagation(), navigate({ view: "code", file: c.path }))}>
            <FileCode2 size={13} />
          </IconButton>
          {!isStagedList && (
            <IconButton label="Discard changes" onClick={(e) => (e.stopPropagation(), void discard([c.path]))}>
              <Undo2 size={13} />
            </IconButton>
          )}
          <IconButton
            label={isStagedList ? "Unstage" : "Stage"}
            onClick={(e) => {
              e.stopPropagation();
              void run(() => (isStagedList ? api().unstage([c.path]) : api().stage([c.path])));
            }}
          >
            {isStagedList ? <Minus size={13} /> : <Plus size={13} />}
          </IconButton>
        </span>
        <span className={`status-letter ${letter(c, isStagedList)}`}>{letter(c, isStagedList)}</span>
      </div>
    );
  };

  const current = r.file ? snapshot.changes.find((c) => c.path === r.file) : undefined;
  return (
    <div className="view">
      <div className="view-body">
        <aside className="side-panel" style={{ width }}>
          <div className="commit-box">
            <textarea
              className="textarea commit-message"
              aria-label="Commit message"
              placeholder={`Commit message (${modKey}+Enter)`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="row">
              <label className="checkbox">
                <input type="checkbox" checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} />
                Amend last commit
              </label>
              <span className="grow" />
              <Button variant="primary" disabled={!canCommit || busy} onClick={() => void commit()}>
                {amend ? "Amend" : commitAll ? `Commit all ${snapshot.changes.length || ""}`.trim() : `Commit ${staged.length}`}
              </Button>
            </div>
          </div>
          <div className="sync-bar">
            <span className="grow ellipsis faint">
              {head.upstream ?? (remote ? `no upstream on ${remote}` : "no remote")}
            </span>
            {head.ahead > 0 && (
              <span className="sync-count">
                <ArrowUp size={11} />
                {head.ahead}
              </span>
            )}
            {head.behind > 0 && (
              <span className="sync-count">
                <ArrowDown size={11} />
                {head.behind}
              </span>
            )}
            <IconButton label={`Fetch from ${remote}`} disabled={!remote || busy} onClick={() => void run(() => api().sync("fetch", remote!), "Fetched")}>
              <RefreshCw size={14} />
            </IconButton>
            <IconButton label={`Pull from ${remote}`} disabled={!remote || busy || !head.branch} onClick={() => void run(() => api().sync("pull", remote!), "Pulled")}>
              <ArrowDownToLine size={14} />
            </IconButton>
            <IconButton label={`Push to ${remote}`} disabled={!remote || busy || !head.branch} onClick={() => void run(() => api().sync("push", remote!), "Pushed")}>
              <ArrowUpFromLine size={14} />
            </IconButton>
          </div>
          <div className="side-panel-scroll">
            {staged.length > 0 && (
              <section>
                <div className="panel-heading">
                  Staged <span className="count">{staged.length}</span>
                  <span className="grow" />
                  <IconButton label="Unstage all" onClick={() => void run(() => api().unstage(staged.map((c) => c.path)))}>
                    <Minus size={13} />
                  </IconButton>
                </div>
                {staged.map((c) => row(c, true))}
              </section>
            )}
            <section>
              <div className="panel-heading">
                Changes <span className="count">{unstaged.length}</span>
                <span className="grow" />
                {unstaged.length > 0 && (
                  <>
                    <IconButton label="Discard all" onClick={() => void discard(unstaged.map((c) => c.path))}>
                      <Undo2 size={13} />
                    </IconButton>
                    <IconButton label="Stage all" onClick={() => void run(() => api().stage(unstaged.map((c) => c.path)))}>
                      <Plus size={13} />
                    </IconButton>
                  </>
                )}
              </div>
              {unstaged.map((c) => row(c, false))}
              {!unstaged.length && <p className="no-changes">Nothing to stage.</p>}
            </section>
          </div>
        </aside>
        {handle}
        <section className="wiki-main">
          {current && r.file ? (
            <DiffPane
              key={r.file + r.staged}
              path={r.file}
              badge={r.staged ? "Staged" : current.index === "?" ? "Untracked" : "Working tree"}
              load={() => api().diff(r.file!, r.staged ? "index" : "worktree", r.staged ? current.oldPath : undefined)}
            />
          ) : (
            <EmptyState icon={<CheckCheck size={20} />} title="Working tree clean">
              <p>Nothing to commit on {head.branch ?? "this checkout"}.</p>
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}
