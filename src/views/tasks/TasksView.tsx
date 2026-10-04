import { useMemo, useRef, useState } from "react";
import { Columns3, LayoutList, ListFilter, Plus, Search, Tag, User, X } from "lucide-react";
import { PRIORITIES, type Task } from "../../../shared/api";
import { api } from "../../api";
import { useHotkey } from "../../app/hotkeys";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { Avatar, Button, EmptyState, IconButton } from "../../components/controls";
import { Menu, type MenuItem } from "../../components/Menu";
import { TaskPanel } from "./TaskPanel";
import { compareTasks, displayId, inputOf, Label, PriorityIcon, StatusIcon, titleCase } from "./task-ui";
import "./tasks.css";

type Layout = "board" | "list";
interface Filters {
  query: string;
  assignee: string | null;
  label: string | null;
  priority: string | null;
}

const storedLayout = (): Layout => {
  try {
    return localStorage.getItem("tasks:layout") === "list" ? "list" : "board";
  } catch {
    return "board";
  }
};

export function TasksView() {
  const { snapshot, run, contentChanged } = useWorkspace();
  const { route, navigate } = useRouter();
  const r = route.view === "tasks" ? route : { view: "tasks" as const };
  const [layout, setLayoutState] = useState<Layout>(storedLayout);
  const [filters, setFilters] = useState<Filters>({ query: "", assignee: null, label: null, priority: null });
  const [moving, setMoving] = useState<Map<string, string>>(new Map());
  const search = useRef<HTMLInputElement>(null);
  const { statuses } = snapshot.settings;

  const setLayout = (value: Layout) => {
    setLayoutState(value);
    try {
      localStorage.setItem("tasks:layout", value);
    } catch {
      /* Layout is a convenience. */
    }
  };

  useHotkey("c", () => navigate({ view: "tasks", create: statuses[0] }), !r.task && !r.create);
  useHotkey("/", () => search.current?.focus());

  const tasks = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return snapshot.tasks
      .map((t) => (moving.has(t.path) ? { ...t, status: moving.get(t.path)! } : t))
      .filter(
        (t) =>
          (!q || [t.id, t.title, t.assignee, ...t.labels].join(" ").toLowerCase().includes(q)) &&
          (!filters.assignee || t.assignee === filters.assignee || (filters.assignee === "-" && !t.assignee)) &&
          (!filters.label || t.labels.includes(filters.label)) &&
          (!filters.priority || t.priority === filters.priority),
      )
      .sort(compareTasks);
  }, [snapshot.tasks, filters, moving]);

  const columns = useMemo(
    () => [...statuses, ...new Set(snapshot.tasks.map((t) => t.status).filter((s) => !statuses.includes(s)))],
    [statuses, snapshot.tasks],
  );

  const move = async (task: Task, status: string) => {
    if (task.status === status || !statuses.includes(status)) return;
    setMoving((m) => new Map(m).set(task.path, status));
    const saved = await run(() => api().updateTask(task.path, { ...inputOf(task), status }, task.hash));
    if (saved) contentChanged();
    setMoving((m) => {
      const next = new Map(m);
      next.delete(task.path);
      return next;
    });
  };

  const open = (task: Task) => navigate({ view: "tasks", task: task.id });
  const selected = r.task ? snapshot.tasks.find((t) => t.id === r.task) : undefined;

  const people = [...new Set(snapshot.tasks.map((t) => t.assignee).filter(Boolean))].sort();
  const labels = [...new Set(snapshot.tasks.flatMap((t) => t.labels))].sort();
  const filterItems = (): MenuItem[] => [
    { heading: "Assignee" },
    ...[["-", "Unassigned"], ...people.map((p) => [p, p])].map(([value, label]) => ({
      label,
      icon: value === "-" ? <User size={14} /> : <Avatar name={value} size={16} />,
      checked: filters.assignee === value,
      onSelect: () => setFilters((f) => ({ ...f, assignee: f.assignee === value ? null : value })),
    })),
    { heading: "Priority" },
    ...PRIORITIES.map((p) => ({
      label: p === "none" ? "No priority" : titleCase(p),
      icon: <PriorityIcon priority={p} />,
      checked: filters.priority === p,
      onSelect: () => setFilters((f) => ({ ...f, priority: f.priority === p ? null : p })),
    })),
    ...(labels.length ? [{ heading: "Label" } as MenuItem] : []),
    ...labels.map((l) => ({
      label: l,
      icon: <Tag size={13} />,
      checked: filters.label === l,
      onSelect: () => setFilters((f) => ({ ...f, label: f.label === l ? null : l })),
    })),
  ];
  const active = [
    filters.assignee && { key: "assignee", text: filters.assignee === "-" ? "Unassigned" : filters.assignee },
    filters.priority && { key: "priority", text: titleCase(filters.priority) },
    filters.label && { key: "label", text: filters.label },
  ].filter(Boolean) as { key: keyof Filters; text: string }[];

  return (
    <div className="view tasks-view">
      <header className="view-header">
        <div className="view-title">Tasks</div>
        <span className="faint">{tasks.length}</span>
        {active.map((f) => (
          <button key={f.key} className="filter-chip" onClick={() => setFilters((x) => ({ ...x, [f.key]: null }))}>
            {f.text}
            <X size={12} />
          </button>
        ))}
        <span className="grow" />
        <label className="filter header-filter">
          <Search size={13} />
          <input
            ref={search}
            value={filters.query}
            placeholder="Filter"
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && (setFilters({ ...filters, query: "" }), search.current?.blur())}
          />
        </label>
        <Menu
          items={filterItems}
          align="end"
          width={230}
          trigger={({ toggle, ref, open }) => (
            <IconButton ref={ref} label="Filter by" active={open || active.length > 0} onClick={toggle}>
              <ListFilter size={15} />
            </IconButton>
          )}
        />
        <div className="segmented">
          <button className={layout === "board" ? "is-active" : ""} onClick={() => setLayout("board")} aria-label="Board">
            <Columns3 size={14} />
          </button>
          <button className={layout === "list" ? "is-active" : ""} onClick={() => setLayout("list")} aria-label="List">
            <LayoutList size={14} />
          </button>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} shortcut="C" onClick={() => navigate({ view: "tasks", create: statuses[0] })}>
          New task
        </Button>
      </header>
      <div className="tasks-body">
        {snapshot.tasks.length === 0 ? (
          <EmptyState icon={<Columns3 size={20} />} title="No tasks yet">
            <p>Each task is a Markdown file in {snapshot.settings.taskRoot}/.</p>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate({ view: "tasks", create: statuses[0] })}>
              Create the first task
            </Button>
          </EmptyState>
        ) : layout === "board" ? (
          <Board columns={columns} tasks={tasks} selected={r.task} onOpen={open} onMove={move} />
        ) : (
          <List columns={columns} tasks={tasks} selected={r.task} onOpen={open} />
        )}
        {(selected || r.create) && (
          <>
            <div className="task-scrim" onClick={() => navigate({ view: "tasks" })} />
            <TaskPanel key={selected?.path ?? "new"} task={selected} createStatus={r.create} />
          </>
        )}
        {r.task && !selected && snapshot.tasks.length > 0 && (
          <div className="task-missing">
            Task {r.task} no longer exists.{" "}
            <button className="plain link" onClick={() => navigate({ view: "tasks" }, { replace: true })}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, selected, onOpen }: { task: Task; selected: boolean; onOpen(): void }) {
  return (
    <div
      className={`task-card ${selected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/gitdesk-task", task.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <div className="task-card-top">
        <span className="task-id mono">{displayId(task.id)}</span>
        {task.assignee && <Avatar name={task.assignee} size={18} />}
      </div>
      <div className="task-card-title">{task.title}</div>
      {(task.priority !== "none" || task.labels.length > 0) && (
        <div className="task-card-meta">
          {task.priority !== "none" && (
            <span className="priority-chip" title={titleCase(task.priority)}>
              <PriorityIcon priority={task.priority} size={13} />
            </span>
          )}
          {task.labels.map((l) => (
            <Label key={l} name={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function Board({
  columns,
  tasks,
  selected,
  onOpen,
  onMove,
}: {
  columns: string[];
  tasks: Task[];
  selected?: string;
  onOpen(task: Task): void;
  onMove(task: Task, status: string): void;
}) {
  const { snapshot } = useWorkspace();
  const { navigate } = useRouter();
  const { statuses } = snapshot.settings;
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="board">
      {columns.map((status) => {
        const cards = tasks.filter((t) => t.status === status);
        const configured = statuses.includes(status);
        return (
          <section
            key={status}
            className={`board-column ${over === status ? "is-over" : ""}`}
            aria-label={titleCase(status)}
            onDragOver={(e) => {
              if (!configured) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(status);
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const task = snapshot.tasks.find((t) => t.path === e.dataTransfer.getData("text/gitdesk-task"));
              if (task) onMove(task, status);
            }}
          >
            <header className="board-column-header">
              <StatusIcon status={status} statuses={statuses} />
              <strong>{titleCase(status)}</strong>
              <span className="faint">{cards.length}</span>
              <span className="grow" />
              {configured && (
                <IconButton label={`New task in ${titleCase(status)}`} onClick={() => navigate({ view: "tasks", create: status })}>
                  <Plus size={14} />
                </IconButton>
              )}
            </header>
            {!configured && <p className="column-note">Not a configured state. Move tasks out of it.</p>}
            <div className="board-cards">
              {cards.map((task) => (
                <TaskCard key={task.path} task={task} selected={selected === task.id} onOpen={() => onOpen(task)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function List({
  columns,
  tasks,
  selected,
  onOpen,
}: {
  columns: string[];
  tasks: Task[];
  selected?: string;
  onOpen(task: Task): void;
}) {
  const { snapshot } = useWorkspace();
  return (
    <div className="task-list">
      {columns.map((status) => {
        const rows = tasks.filter((t) => t.status === status);
        if (!rows.length) return null;
        return (
          <section key={status}>
            <header className="task-list-group">
              <StatusIcon status={status} statuses={snapshot.settings.statuses} />
              <strong>{titleCase(status)}</strong>
              <span className="faint">{rows.length}</span>
            </header>
            {rows.map((task) => (
              <div
                key={task.path}
                role="button"
                tabIndex={0}
                className={`task-row ${selected === task.id ? "is-selected" : ""}`}
                onClick={() => onOpen(task)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(task)}
              >
                <PriorityIcon priority={task.priority} />
                <span className="task-id mono">{displayId(task.id)}</span>
                <StatusIcon status={task.status} statuses={snapshot.settings.statuses} />
                <span className="task-row-title ellipsis">{task.title}</span>
                <span className="grow" />
                {task.labels.map((l) => (
                  <Label key={l} name={l} />
                ))}
                {task.assignee ? <Avatar name={task.assignee} size={20} /> : <span className="avatar-placeholder" />}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
