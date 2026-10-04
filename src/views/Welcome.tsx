import { useEffect, useState } from "react";
import { ArrowRight, CloudDownload, FolderOpen, Server, X } from "lucide-react";
import { describeLocation, type RecentEntry } from "../../shared/api";
import { api } from "../api";
import { Kbd, Spinner } from "../components/controls";
import type { RepositoryActions } from "../app/App";
import { modKey, useHotkey } from "../app/hotkeys";
import { hostIcon, initials } from "../app/Sidebar";
import { CloneDialog, RemoteDialog } from "./RepositoryDialogs";
import "./Welcome.css";

const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(time).toLocaleDateString();
};

export function Welcome({ busy, actions }: { busy: boolean; actions: RepositoryActions }) {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [dialog, setDialog] = useState<"remote" | "clone" | null>(null);
  useEffect(() => {
    void api().recent().then(setRecent);
  }, []);
  useHotkey("mod+o", () => void actions.pick(), !busy);

  return (
    <div className="welcome">
      <div className="welcome-panel">
        <div className="welcome-brand">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M10 9v14M10 16h7a5 5 0 0 0 5-5V9" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <circle cx="10" cy="9" r="2.6" fill="#fff" />
            <circle cx="10" cy="23" r="2.6" fill="#fff" />
            <circle cx="22" cy="9" r="2.6" fill="#fff" />
          </svg>
          <h1>GitDesk</h1>
        </div>

        <div className="welcome-actions">
          <button className="welcome-action" disabled={busy} onClick={() => void actions.pick()}>
            <FolderOpen size={18} />
            <span className="grow">Open folder</span>
            <Kbd>{modKey} O</Kbd>
          </button>
          <button className="welcome-action" disabled={busy} onClick={() => setDialog("remote")}>
            <Server size={18} />
            <span className="grow">Open on WSL or SSH</span>
          </button>
          <button className="welcome-action" disabled={busy} onClick={() => setDialog("clone")}>
            <CloudDownload size={18} />
            <span className="grow">Clone repository</span>
          </button>
        </div>

        {recent.length > 0 && (
          <section className="welcome-recent">
            <h2>Recent</h2>
            {recent.map((entry) => (
              <div key={describeLocation(entry.location) + entry.location.kind} className="recent-row">
                <button className="recent-open" disabled={busy} onClick={() => void actions.open(entry.location)}>
                  <span className="recent-mark">{initials(entry.name)}</span>
                  <span className="grow">
                    <span className="recent-name">{entry.name}</span>
                    <span className="recent-path ellipsis">
                      {hostIcon(entry.location.kind, 11)}
                      {describeLocation(entry.location)}
                    </span>
                  </span>
                  <span className="recent-time">{ago(entry.openedAt)}</span>
                  <ArrowRight size={14} className="recent-arrow" />
                </button>
                <button
                  className="recent-forget"
                  aria-label={`Remove ${entry.name} from recent`}
                  title="Remove from list"
                  onClick={() => void api().forget(entry.location).then(() => api().recent().then(setRecent))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </section>
        )}
        {busy && (
          <div className="welcome-busy">
            <Spinner /> Opening…
          </div>
        )}
      </div>
      {dialog === "remote" && <RemoteDialog onClose={() => setDialog(null)} onOpen={(l) => (setDialog(null), void actions.open(l))} />}
      {dialog === "clone" && <CloneDialog onClose={() => setDialog(null)} onClone={(u, p) => (setDialog(null), void actions.clone(u, p))} />}
    </div>
  );
}
