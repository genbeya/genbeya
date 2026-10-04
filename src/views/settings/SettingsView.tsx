import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Settings } from "../../../shared/api";
import { api } from "../../api";
import { modKey, useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { Button, IconButton } from "../../components/controls";
import { useDialogs } from "../../components/Dialog";
import { StatusIcon, titleCase } from "../tasks/task-ui";
import "./settings.css";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {note && <p className="settings-note">{note}</p>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

function StatusEditor({ value, onChange }: { value: string[]; onChange(next: string[]): void }) {
  const [adding, setAdding] = useState("");
  const move = (i: number, d: number) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const name = adding.trim().toLowerCase().replace(/\s+/g, "-");
    if (name && !value.includes(name)) onChange([...value, name]);
    setAdding("");
  };
  return (
    <div className="status-editor">
      {value.map((s, i) => (
        <div key={s} className="status-item">
          <StatusIcon status={s} statuses={value} />
          <span className="grow">{titleCase(s)}</span>
          <span className="faint mono">{s}</span>
          <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton label={`Remove ${s}`} disabled={value.length === 1} onClick={() => onChange(value.filter((x) => x !== s))}>
            <X size={13} />
          </IconButton>
        </div>
      ))}
      <div className="row status-add">
        <input
          className="input"
          placeholder="Add a state"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <Button icon={<Plus size={14} />} disabled={!adding.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { snapshot, run, preferences, setPreferences } = useWorkspace();
  const router = useRouter();
  const dialogs = useDialogs();
  const [form, setForm] = useState<Settings>(snapshot.settings);
  const [base, setBase] = useState({ settings: snapshot.settings, hash: snapshot.settingsHash });
  const dirty = JSON.stringify(form) !== JSON.stringify(base.settings);
  const [plantuml, setPlantuml] = useState(preferences.plantumlServer);

  // Follow saves and external edits to .gitdesk.yml while the form is untouched.
  useEffect(() => {
    if (!dirty && snapshot.settingsHash !== base.hash) {
      setForm(snapshot.settings);
      setBase({ settings: snapshot.settings, hash: snapshot.settingsHash });
    }
  }, [snapshot.settingsHash, dirty]);
  useEffect(() => router.setDirty("settings", dirty), [dirty]);
  useEffect(() => () => router.setDirty("settings", false), []);

  const save = async () => {
    const done = await run(() => api().saveSettings(form, base.hash).then(() => true), "Settings saved");
    // The next snapshot brings the new hash; until then the form counts as clean.
    if (done) setBase((b) => ({ ...b, settings: form }));
  };
  useHotkey("mod+s", () => void save(), dirty);

  const field = (key: keyof Settings) => ({
    className: "input",
    value: form[key] as string,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  const { storage, remotes } = snapshot;
  const setStorage = async (mode: "worktree" | "branch") => {
    if (mode === storage.mode) return;
    const ok = await dialogs.confirm(
      mode === "branch"
        ? {
            title: "Store wiki and tasks on a dedicated branch",
            message: (
              <>
                GitDesk keeps wiki pages, tasks and settings on a branch named <code>gitdesk</code>, checked out
                separately inside <code>.git</code>. Every edit becomes a commit there, and code branches stay
                untouched. If the branch is new, it starts with the committed wiki and tasks of the current branch;
                the files on your code branches are left as they are.
              </>
            ),
            confirm: "Use a dedicated branch",
          }
        : {
            title: "Store wiki and tasks in the checkout",
            message: "GitDesk reads the wiki and tasks from the checked-out branch again. The gitdesk branch is kept.",
            confirm: "Switch",
          },
    );
    if (ok) await run(() => api().setStorage(mode), "Storage updated");
  };

  const editRemote = async (name?: string, url?: string) => {
    const remoteName =
      name ??
      (await dialogs.prompt({
        title: "Add remote",
        label: "Name",
        initial: remotes.length ? "" : "origin",
        placeholder: "origin",
        confirm: "Next",
      }));
    if (!remoteName) return;
    const remoteUrl = await dialogs.prompt({
      title: name ? `Edit ${name}` : `Add ${remoteName}`,
      label: "URL or path",
      initial: url,
      placeholder: "git@github.com:team/project.git",
      confirm: "Save",
      hint: "GitHub, GitLab, Bitbucket, any SSH or HTTPS server, or a local path.",
    });
    if (remoteUrl) await run(() => api().setRemote(remoteName, remoteUrl), "Remote saved");
  };

  return (
    <div className="view">
      <header className="view-header">
        <div className="view-title">Settings</div>
        <span className="grow" />
        {dirty && (
          <>
            <Button variant="ghost" onClick={() => setForm(base.settings)}>
              Discard
            </Button>
            <Button variant="primary" shortcut={`${modKey} S`} onClick={() => void save()}>
              Save changes
            </Button>
          </>
        )}
      </header>
      <div className="content-scroll">
        <div className="settings">
          <Section title="Project" note={<>Shared with everyone through <code>.gitdesk.yml</code>.</>}>
            <Row label="Name">
              <input {...field("name")} />
            </Row>
            <Row label="Task ID prefix" hint={`New tasks are numbered ${form.taskPrefix || "T"}-1, ${form.taskPrefix || "T"}-2, …`}>
              <input {...field("taskPrefix")} className="input mono short" />
            </Row>
            <Row label="Wiki folder">
              <input {...field("wikiRoot")} className="input mono" />
            </Row>
            <Row label="Wiki home page" hint="Relative to the wiki folder.">
              <input {...field("wikiHome")} className="input mono" />
            </Row>
            <Row label="Task folder">
              <input {...field("taskRoot")} className="input mono" />
            </Row>
            <Row label="Workflow" hint="Board columns, in order. The last state counts as done.">
              <StatusEditor value={form.statuses} onChange={(statuses) => setForm({ ...form, statuses })} />
            </Row>
          </Section>

          <Section
            title="Where wiki and tasks live"
            note="On a dedicated branch, documentation and tasks stay the same on every code branch and sync independently."
          >
            <div className="storage-options">
              <button className={`storage-option ${storage.mode === "worktree" ? "is-active" : ""}`} onClick={() => void setStorage("worktree")}>
                <strong>Checked-out branch</strong>
                <span>Files live next to the code and change with each branch. Commit them like code.</span>
              </button>
              <button className={`storage-option ${storage.mode === "branch" ? "is-active" : ""}`} onClick={() => void setStorage("branch")}>
                <strong>Dedicated branch</strong>
                <span>
                  Files live on the <code>{storage.mode === "branch" ? storage.branch : "gitdesk"}</code> branch. Every edit is
                  committed automatically.
                </span>
              </button>
            </div>
            {storage.mode === "branch" && (
              <Row label="Sync automatically" hint="Pull and push the content branch a few seconds after each edit.">
                <input
                  type="checkbox"
                  className="switch"
                  checked={preferences.autoSyncContent}
                  onChange={(e) => void setPreferences({ autoSyncContent: e.target.checked })}
                />
              </Row>
            )}
          </Section>

          <Section title="Remotes" note="Credentials come from your Git credential manager and SSH agent.">
            {remotes.map((r) => (
              <div className="remote-row" key={r.name}>
                <strong>{r.name}</strong>
                <code className="grow ellipsis selectable">{r.url}</code>
                <IconButton label={`Edit ${r.name}`} onClick={() => void editRemote(r.name, r.url)}>
                  <Pencil size={13} />
                </IconButton>
                <IconButton
                  label={`Remove ${r.name}`}
                  onClick={() =>
                    void dialogs
                      .confirm({ title: "Remove remote", message: `Remove ${r.name} (${r.url})?`, confirm: "Remove", danger: true })
                      .then((ok) => {
                        if (ok) void run(() => api().removeRemote(r.name), "Remote removed");
                      })
                  }
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
            <div className="remote-row">
              <Button icon={<Plus size={14} />} onClick={() => void editRemote()}>
                Add remote
              </Button>
            </div>
          </Section>

          <Section title="App" note="Personal preferences for this computer.">
            <Row label="Theme">
              <div className="segmented">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button key={t} className={preferences.theme === t ? "is-active" : ""} onClick={() => void setPreferences({ theme: t })}>
                    {titleCase(t)}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Reopen last repository" hint="On startup.">
              <input
                type="checkbox"
                className="switch"
                checked={preferences.reopenLast}
                onChange={(e) => void setPreferences({ reopenLast: e.target.checked })}
              />
            </Row>
            <Row
              label="PlantUML server"
              hint="Diagrams render with a local plantuml command unless a server is set. The server receives diagram source."
            >
              <input
                className="input mono"
                placeholder="https://plantuml.example.com"
                value={plantuml}
                spellCheck={false}
                onChange={(e) => setPlantuml(e.target.value)}
                onBlur={() => plantuml !== preferences.plantumlServer && void setPreferences({ plantumlServer: plantuml })}
              />
            </Row>
          </Section>
        </div>
      </div>
    </div>
  );
}
