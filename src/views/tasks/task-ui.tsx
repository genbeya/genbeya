import { CircleCheck, CircleDashed } from "lucide-react";
import { PRIORITIES, type Task, type TaskInput } from "../../../shared/api";

export const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function statusColor(index: number, count: number) {
  if (index === count - 1) return "var(--green)";
  if (index === 0) return "var(--gray)";
  return ["var(--blue)", "var(--yellow)", "var(--purple)", "var(--orange)"][(index - 1) % 4];
}

/** A ring that fills as the status advances; the final state is a check. */
export function StatusIcon({ status, statuses, size = 14 }: { status: string; statuses: string[]; size?: number }) {
  const index = statuses.indexOf(status);
  const color = index < 0 ? "var(--text-3)" : statusColor(index, statuses.length);
  if (index === statuses.length - 1) return <CircleCheck size={size} color={color} strokeWidth={2.2} />;
  if (index <= 0) return <CircleDashed size={size} color={color} strokeWidth={2.2} />;
  const progress = index / (statuses.length - 1);
  const r = 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={r * 2}
        strokeDasharray={`${c * progress} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: string; size?: number }) {
  if (priority === "urgent")
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--orange)" />
        <path d="M7 3.8v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="7" cy="10.4" r="1" fill="#fff" />
      </svg>
    );
  const level = { high: 3, medium: 2, low: 1 }[priority] ?? 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={level ? 9 - i * 3 : 6}
          width="3"
          height={level ? 3.5 + i * 3 : 2}
          rx="1"
          fill={i < level ? "var(--text-2)" : "var(--line-strong)"}
        />
      ))}
    </svg>
  );
}

export const priorityRank = (p: string) => {
  const index = (PRIORITIES as readonly string[]).indexOf(p);
  return index < 0 ? PRIORITIES.length : index;
};

/** Highest priority first, then the newest numbered task. */
export function compareTasks(a: Task, b: Task) {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority) return byPriority;
  const na = Number(/(\d+)$/.exec(a.id)?.[1] ?? 0);
  const nb = Number(/(\d+)$/.exec(b.id)?.[1] ?? 0);
  return nb - na || a.title.localeCompare(b.title);
}

export const inputOf = (t: Task): TaskInput => ({
  title: t.title,
  status: t.status,
  priority: t.priority,
  assignee: t.assignee,
  labels: t.labels,
  body: t.body,
});

/** Generated UUIDs are abbreviated; human-readable IDs are shown whole. */
export const displayId = (id: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id);

const LABEL_HUES = [250, 160, 25, 210, 320, 45, 280, 185];
export function labelColor(label: string) {
  let hash = 0;
  for (const c of label) hash = (hash * 33 + c.charCodeAt(0)) | 0;
  return `hsl(${LABEL_HUES[Math.abs(hash) % LABEL_HUES.length]} 65% 60%)`;
}

export function Label({ name }: { name: string }) {
  return (
    <span className="label-chip">
      <i style={{ background: labelColor(name) }} />
      {name}
    </span>
  );
}
