import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Ellipsis, Pencil, Plus, Tag, Trash2, User, X, Code2 } from "lucide-react";
import { PRIORITIES, type Task, type TaskInput } from "../../../shared/api";
import { api } from "../../api";
import { modKey, useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { Avatar, Button, IconButton } from "../../components/controls";
import { useDialogs } from "../../components/Dialog";
import { Menu, type MenuItem } from "../../components/Menu";
import { useToast } from "../../components/Toasts";
import { SourceEditor } from "../../editor/Editor";
import { Markdown, toggleTaskAt } from "../../markdown/Markdown";
import { useLinkTargets, useWikiActions } from "../wiki/actions";
import { displayId, inputOf, Label, PriorityIcon, StatusIcon, titleCase } from "./task-ui";

/** Status, priority, assignee and labels as compact menu buttons. */
export function TaskProperties({ value, onChange }: { value: TaskInput; onChange(patch: Partial<TaskInput>): void }) {
  const { snapshot } = useWorkspace();
  const dialogs = useDialogs();
  const { statuses } = snapshot.settings;
  const people = useMemo(
    () => [...new Set(snapshot.tasks.map((t) => t.assignee).filter(Boolean))].sort(),
    [snapshot.tasks],
  );
  const labels = useMemo(
    () => [...new Set([...snapshot.tasks.flatMap((t) => t.labels), ...value.labels])].sort(),
    [snapshot.tasks, value.labels],
  );
  const statusItems: MenuItem[] = [
    ...statuses.map((s) => ({
      label: titleCase(s),
      icon: <StatusIcon status={s} statuses={statuses} />,
      checked: s === value.status,
      onSelect: () => onChange({ status: s }),
    })),
  ];
  const priorityItems: MenuItem[] = PRIORITIES.map((p) => ({
    label: p === "none" ? "No priority" : titleCase(p),
    icon: <PriorityIcon priority={p} />,
    checked: p === value.priority,
    onSelect: () => onChange({ priority: p }),
  }));
  const assigneeItems: MenuItem[] = [
    { label: "Unassigned", icon: <User size={14} />, checked: !value.assignee, onSelect: () => onChange({ assignee: "" }) },
    ...people.map((p) => ({
      label: p,
      icon: <Avatar name={p} size={16} />,
      checked: p === value.assignee,
      onSelect: () => onChange({ assignee: p }),
    })),
    "separator",
    {
      label: "Someone else…",
      icon: <Plus size={14} />,
      onSelect: () =>
        void dialogs
          .prompt({ title: "Assign", label: "Name", placeholder: "alice", confirm: "Assign" })
          .then((name) => name && onChange({ assignee: name })),
    },
  ];
  const labelItems: MenuItem[] = [
    ...labels.map((l) => ({
      label: l,
      icon: <Tag size={13} />,
      checked: value.labels.includes(l),
      onSelect: () =>
        onChange({ labels: value.labels.includes(l) ? value.labels.filter((x) => x !== l) : [...value.labels, l] }),
    })),
    ...(labels.length ? (["separator"] as MenuItem[]) : []),
    {
      label: "New label…",
      icon: <Plus size={14} />,
      onSelect: () =>
        void dialogs
          .prompt({ title: "New label", label: "Label", placeholder: "backend", confirm: "Add" })
          .then((label) => label && onChange({ labels: [...new Set([...value.labels, label])] })),
    },
  ];
  return (
    <div className="task-properties">
      <Menu
        items={statusItems}
        trigger={({ toggle, ref }) => (
          <button ref={ref} className="property" onClick={toggle} aria-label="Status">
            <StatusIcon status={value.status} statuses={statuses} />
            {titleCase(value.status)}
          </button>
        )}
      />
      <Menu
        items={priorityItems}
        trigger={({ toggle, ref }) => (
          <button ref={ref} className="property" onClick={toggle} aria-label="Priority">
            <PriorityIcon priority={value.priority} />
            {value.priority === "none" ? "No priority" : titleCase(value.priority)}
          </button>
        )}
      />
      <Menu
        items={assigneeItems}
        trigger={({ toggle, ref }) => (
          <button ref={ref} className="property" onClick={toggle} aria-label="Assignee">
            {value.assignee ? <Avatar name={value.assignee} size={16} /> : <User size={14} />}
            {value.assignee || "Unassigned"}
          </button>
        )}
      />
      <Menu
        items={labelItems}
        trigger={({ toggle, ref }) => (
          <button ref={ref} className="property" onClick={toggle} aria-label="Labels">
            {value.labels.length ? value.labels.map((l) => <Label key={l} name={l} />) : (
              <>
                <Tag size={13} />
                Labels
              </>
            )}
          </button>
        )}
      />
    </div>
  );
}

const EMPTY = (status: string): TaskInput => ({
  title: "",
  status,
  priority: "none",
  assignee: "",
  labels: [],
  body: "",
});

/**
 * The task drawer. Viewing renders the description and saves property
 * changes immediately; E switches to editing title and description.
 */
export function TaskPanel({ task: fromSnapshot, createStatus }: { task?: Task; createStatus?: string }) {
  const { snapshot, run, contentChanged } = useWorkspace();
  // Saves return the new version before the next snapshot arrives. Edits
  // are queued and each builds on the latest version, so quick successive
  // changes neither conflict nor undo each other.
  const [saved, setSaved] = useState<Task | null>(null);
  const seen = useRef(fromSnapshot?.hash);
  const latest = useRef(fromSnapshot);
  if (fromSnapshot?.hash !== seen.current) {
    seen.current = fromSnapshot?.hash;
    latest.current = fromSnapshot;
  }
  useEffect(() => setSaved(null), [fromSnapshot?.hash]);
  const task = saved ?? fromSnapshot;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const router = useRouter();
  const wiki = useWikiActions();
  const dialogs = useDialogs();
  const toast = useToast();
  const creating = !task;
  const [editing, setEditing] = useState(creating);
  const [draft, setDraft] = useState<TaskInput>(() => (task ? inputOf(task) : EMPTY(createStatus ?? snapshot.settings.statuses[0])));
  const base = useRef(JSON.stringify(draft));
  const dirty = editing && JSON.stringify(draft) !== base.current;
  const { pages, tasks } = useLinkTargets();

  useEffect(() => router.setDirty("task", dirty), [dirty]);
  useEffect(() => () => router.setDirty("task", false), []);

  const close = () => router.navigate({ view: "tasks" });
  // The version the edit started from: saving fails if the file changed since.
  const editBase = useRef<string | null>(null);
  const saving = useRef(false);
  const startEditing = () => {
    if (!task) return;
    const value = inputOf(task);
    editBase.current = (latest.current ?? task).hash;
    base.current = JSON.stringify(value);
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => {
    if (dirty && !window.confirm("Discard your changes to this task?")) return;
    if (creating) close();
    else setEditing(false);
  };

  const save = useCallback(async () => {
    if (!draft.title.trim()) return toast.error("Give the task a title first.");
    if (saving.current) return;
    saving.current = true;
    try {
      await persist();
    } finally {
      saving.current = false;
    }
  }, [draft, creating, task, run, contentChanged, router, toast]);

  const persist = async () => {
    if (creating) {
      const created = await run(() => api().createTask(draft));
      if (!created) return;
      contentChanged();
      base.current = JSON.stringify(draft);
      router.setDirty("task", false);
      router.navigate({ view: "tasks", task: created.id }, { replace: true });
      return;
    }
    const updated = await run(() => api().updateTask(task!.path, draft, editBase.current ?? task!.hash));
    if (!updated) return;
    latest.current = updated;
    setSaved(updated);
    contentChanged();
    base.current = JSON.stringify(draft);
    setEditing(false);
  };

  /** Property edits while viewing are saved right away. */
  const patch = (change: Partial<TaskInput> | ((current: Task) => Partial<TaskInput>)) => {
    if (editing || !task) {
      if (typeof change !== "function") setDraft((d) => ({ ...d, ...change }));
      return;
    }
    queue.current = queue.current.then(async () => {
      const current = latest.current ?? task;
      const values = typeof change === "function" ? change(current) : change;
      const updated = await run(() => api().updateTask(current.path, { ...inputOf(current), ...values }, current.hash));
      if (updated) {
        latest.current = updated;
        setSaved(updated);
        contentChanged();
      }
    });
  };

  const toggleCheckbox = (offset: number) => patch((current) => ({ body: toggleTaskAt(current.body, offset) }));

  const remove = async () => {
    if (!task) return;
    const ok = await dialogs.confirm({
      title: "Delete task",
      message: `Delete ${displayId(task.id)} “${task.title}”? Git history keeps the file.`,
      confirm: "Delete",
      danger: true,
    });
    if (ok && (await run(() => api().deleteTask(task.path).then(() => true), "Task deleted"))) {
      contentChanged();
      close();
    }
  };

  useHotkey("e", startEditing, !editing && !!task);
  useHotkey("escape", () => (editing ? cancel() : close()));
  useHotkey(["mod+s", "mod+enter"], () => void save(), editing);

  const menu: MenuItem[] = task
    ? [
        { label: "Copy ID", icon: <Copy size={14} />, onSelect: () => (void navigator.clipboard?.writeText(task.id), toast.success("ID copied")) },
        { label: "Open file", icon: <Code2 size={14} />, onSelect: () => router.navigate({ view: "code", file: task.path }) },
        "separator",
        { label: "Delete task…", icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() },
      ]
    : [];

  const shown = editing ? draft : task ? inputOf(task) : draft;
  return (
    <aside className="task-panel" role="dialog" aria-label={creating ? "New task" : `Task ${task!.id}`}>
      <header className="task-panel-header">
        <span className="task-panel-id mono">{task ? displayId(task.id) : "New task"}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="grow" />
        {editing ? (
          <>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="primary" shortcut={`${modKey} S`} onClick={() => void save()}>
              {creating ? "Create task" : "Save"}
            </Button>
          </>
        ) : (
          <>
            <Button icon={<Pencil size={13} />} shortcut="E" onClick={startEditing}>
              Edit
            </Button>
            <Menu
              items={menu}
              align="end"
              trigger={({ toggle, ref, open }) => (
                <IconButton ref={ref} label="Task actions" active={open} onClick={toggle}>
                  <Ellipsis size={16} />
                </IconButton>
              )}
            />
          </>
        )}
        <IconButton label="Close (Esc)" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="task-panel-body">
        {editing ? (
          <textarea
            className="task-title-input"
            autoFocus={creating}
            rows={1}
            placeholder="Task title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          />
        ) : (
          <h1 className="task-title selectable">{task!.title}</h1>
        )}
        <TaskProperties value={shown} onChange={patch} />
        <div className="task-description">
          {editing ? (
            <div className="task-body-editor">
              <SourceEditor
                path={(task?.path ?? "new-task") + ".md"}
                value={draft.body}
                onChange={(body) => setDraft((d) => ({ ...d, body }))}
                onSave={() => void save()}
                lineNumbers={false}
                autoFocus={!creating}
              />
            </div>
          ) : task!.body.trim() ? (
            <Markdown
              source={task!.body}
              path={task!.path}
              pages={pages}
              tasks={tasks}
              onLink={wiki.followLink}
              onToggleTask={toggleCheckbox}
              className="task-markdown"
            />
          ) : (
            <button className="task-empty-body" onClick={startEditing}>
              Add a description…
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
