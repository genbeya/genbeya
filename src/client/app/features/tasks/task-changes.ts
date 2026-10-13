/** Changes to a task in words, for its activity; without Angular, so the VS Code extension shows them too. */
import type { TaskChange, TaskField } from "../../../../contracts/model";
import { epicName, titleCase } from "./task-model";

const valueText = (field: TaskField, value: string): string =>
  field === "status" || field === "priority"
    ? titleCase(value)
    : field === "type"
      ? value
        ? titleCase(value)
        : "none"
      : field === "epic"
        ? epicName(value)
        : field === "assignee"
          ? value || "nobody"
          : `“${value}”`;

const counted = (count: number, verb: string) => (count === 1 ? `${verb} a comment` : `${verb} ${count} comments`);

/** One change in words: "status Todo → In progress". */
export function describeChange(change: TaskChange): string {
  switch (change.kind) {
    case "created":
      return "created the task";
    case "field":
      return `${change.field} ${valueText(change.field, change.from)} → ${valueText(change.field, change.to)}`;
    case "labels":
      return `labels ${[...change.added.map((label) => `+${label}`), ...change.removed.map((label) => `−${label}`)].join(" ")}`;
    case "description":
      return "edited the description";
    case "comments":
      return [
        change.added && counted(change.added, "added"),
        change.edited && counted(change.edited, "edited"),
        change.removed && counted(change.removed, "deleted"),
      ]
        .filter(Boolean)
        .join(", ");
    case "custom":
      return `${change.field} ${change.from || "none"} → ${change.to || "none"}`;
    case "other":
      return `changed ${change.fields.join(", ")}`;
  }
}
