/**
 * Project settings: defaults, validation and the `.gitdesk.yml` format.
 * `windows` says whether the repository lives on a Windows file system,
 * where folder names such as `GIT~1` or `tasks.` are aliases.
 *
 * Workflow states are written as names, or as `{ name, icon }` once they
 * have an icon; task types as names while they look as usual for their name
 * (see {@link taskType}), or as `{ name, icon, tone }`.
 */
import YAML from "yaml";
import {
  FIELD_TYPES,
  TASK_KEYS,
  taskType,
  TONES,
  type ContentArea,
  type FieldDefinition,
  type Settings,
  type TaskType,
} from "../contracts/model";
import { validateRepositoryPath, within } from "../utilities/repository-path";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";

export const SETTINGS_FILE = ".gitdesk.yml";
const DEFAULT_STATUSES = ["backlog", "todo", "in-progress", "review", "done"];
const DEFAULT_TYPES = ["bug", "feature", "improvement", "chore"].map(taskType);
const LIMITS = { types: 20, fields: 30, options: 30, option: 60 } as const;
/** A Lucide icon name, such as "trending-up". */
const ICON = /^[a-z][a-z0-9-]{0,39}$/;
/** Type names also name template files, so they stay plain. */
export const TYPE_NAME = /^[A-Za-z0-9][\w -]{0,39}$/;
/** Field names are frontmatter keys that never need quoting. */
const FIELD_NAME = /^[A-Za-z][\w-]{0,39}$/;

/**
 * The content area `path` belongs to: the settings file, the task folder
 * with its templates, or the wiki folder with everything pages link to
 * there, such as images; null for code.
 */
export function contentAreaOf(path: string, settings: Pick<Settings, "wikiRoot" | "taskRoot">): ContentArea | null {
  if (path === SETTINGS_FILE) return "settings";
  if (within(path, settings.taskRoot)) return "tasks";
  return within(path, settings.wikiRoot) ? "wiki" : null;
}

/** "GitDesk" → "GD", "my project" → "MP", "atlas" → "ATL". */
function prefixFor(name: string): string {
  const capitals = name.match(/[A-Z]/g) ?? [];
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const prefix =
    capitals.length >= 2 ? capitals.join("") : words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "T").slice(0, 3);
  return prefix.toUpperCase().slice(0, 6) || "T";
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function iconOf(value: unknown, owner: string): string {
  if (typeof value !== "string" || !ICON.test(value)) throw new Error(`Choose an icon for ${owner}.`);
  return value;
}

function validType(entry: unknown): TaskType {
  const { name, icon, tone } = isRecord(entry) ? entry : {};
  const typeName = trimmed(name);
  if (!TYPE_NAME.test(typeName)) throw new Error(`"${typeName}" is not a valid type name: use letters, digits, spaces, - and _.`);
  if (tone != null && !(TONES as readonly unknown[]).includes(tone)) throw new Error(`Choose a known colour for the type ${typeName}.`);
  return { name: typeName, icon: iconOf(icon, `the type ${typeName}`), ...(tone ? { tone: tone as TaskType["tone"] } : {}) };
}

function validField(entry: unknown): FieldDefinition {
  const { name, type = "text", options } = isRecord(entry) ? entry : {};
  const fieldName = trimmed(name);
  if (!FIELD_NAME.test(fieldName))
    throw new Error(`"${fieldName}" is not a valid field name: start with a letter, then use letters, digits, - and _.`);
  if ((TASK_KEYS as readonly string[]).includes(fieldName.toLowerCase())) throw new Error(`${fieldName} is a built-in task property.`);
  if (!(FIELD_TYPES as readonly unknown[]).includes(type)) throw new Error(`The field ${fieldName} must be text, number, date or choice.`);
  if (type !== "choice") return { name: fieldName, type: type as FieldDefinition["type"] };
  const values = Array.isArray(options) ? options.map((option) => (typeof option === "number" ? String(option) : trimmed(option))) : [];
  if (
    !values.length ||
    values.length > LIMITS.options ||
    new Set(values).size !== values.length ||
    values.some((option) => !option || option.length > LIMITS.option)
  )
    throw new Error(`Give the choice field ${fieldName} 1–${LIMITS.options} unique options.`);
  return { name: fieldName, type: "choice", options: values };
}

/** Throws unless the names are unique, ignoring case. */
function unique(names: readonly string[], message: string) {
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error(message);
}

/** Keys that stay out of the file while they hold these values. */
const OPTIONAL: Readonly<Record<string, unknown>> = { hiddenColumns: [], types: DEFAULT_TYPES.map((type) => type.name), fields: [] };

export class SettingsEngine {
  defaults(name: string): Settings {
    return {
      name,
      wikiRoot: "docs",
      wikiHome: "Home.md",
      taskRoot: "tasks",
      taskPrefix: prefixFor(name),
      statuses: [...DEFAULT_STATUSES],
      statusIcons: {},
      hiddenColumns: [],
      types: DEFAULT_TYPES,
      fields: [],
    };
  }

  validate(value: Settings, windows: boolean): Settings {
    if (!isRecord(value)) throw new Error("Invalid settings.");
    const text = (input: unknown, label: string, max: number) => {
      if (typeof input !== "string" || !input.trim() || input.length > max)
        throw new Error(`${label} is required (up to ${max} characters).`);
      return input.trim();
    };
    const folder = (input: unknown, label: string) => validateRepositoryPath(text(input, label, 200), windows);
    const name = text(value.name, "Project name", 120);
    const wikiRoot = folder(value.wikiRoot, "Wiki folder");
    const taskRoot = folder(value.taskRoot, "Task folder");
    const wikiHome = folder(value.wikiHome, "Wiki home");
    if (!wikiHome.endsWith(".md")) throw new Error("The wiki home must be a Markdown file.");
    if (wikiRoot === taskRoot || within(wikiRoot, taskRoot) || within(taskRoot, wikiRoot))
      throw new Error("Wiki and task folders must not contain each other.");
    const taskPrefix = text(value.taskPrefix, "Task prefix", 12).toUpperCase();
    if (!/^[A-Z][A-Z0-9]*$/.test(taskPrefix)) throw new Error("The task prefix uses letters and digits, starting with a letter.");
    const statuses = Array.isArray(value.statuses) ? value.statuses.map(trimmed) : [];
    if (
      statuses.length < 1 ||
      statuses.length > 12 ||
      new Set(statuses).size !== statuses.length ||
      statuses.some((s) => !s || s.length > 40)
    )
      throw new Error("Use 1–12 unique workflow states.");
    if (!isRecord(value.statusIcons)) throw new Error("Invalid icons of workflow states.");
    const icons = value.statusIcons;
    // Icons of states that were renamed or removed are forgotten.
    const statusIcons = Object.fromEntries(
      statuses.filter((status) => Object.hasOwn(icons, status)).map((status) => [status, iconOf(icons[status], `the state ${status}`)]),
    );
    if (!Array.isArray(value.hiddenColumns)) throw new Error("List the hidden columns as workflow states.");
    const hiddenColumns = statuses.filter((status) => (value.hiddenColumns as unknown[]).includes(status));
    if (!Array.isArray(value.types) || value.types.length > LIMITS.types) throw new Error(`List the task types (up to ${LIMITS.types}).`);
    const types = value.types.map(validType);
    unique(
      types.map((type) => type.name),
      "Task type names must be unique.",
    );
    if (!Array.isArray(value.fields) || value.fields.length > LIMITS.fields)
      throw new Error(`List the custom fields (up to ${LIMITS.fields}).`);
    const fields = value.fields.map(validField);
    unique(
      fields.map((field) => field.name),
      "Custom field names must be unique.",
    );
    return { name, wikiRoot, wikiHome, taskRoot, taskPrefix, statuses, statusIcons, hiddenColumns, types, fields };
  }

  /** Reads a settings file over `fallback`; unknown keys are ignored here and kept by {@link serialize}. */
  parse(content: string, fallback: Settings, windows: boolean): Settings {
    const document = YAML.parseDocument(withoutByteOrderMark(content));
    if (document.errors.length) throw new Error(document.errors[0]!.message);
    const data: unknown = document.toJS() ?? {};
    if (!isRecord(data)) throw new Error("Settings must be a YAML mapping.");
    const { statuses, types, fields } = data;
    const entries: Record<string, unknown>[] | null = Array.isArray(statuses)
      ? statuses.map((entry) => (isRecord(entry) ? entry : { name: entry }))
      : null;
    // Wrong shapes reach validation, which explains them.
    return this.validate(
      {
        ...fallback,
        ...(data as Partial<Settings>),
        statuses: entries ? entries.map((entry) => entry["name"] as string) : fallback.statuses,
        statusIcons: entries
          ? Object.fromEntries(
              entries.filter((entry) => entry["icon"] != null).map((entry) => [String(entry["name"]), entry["icon"] as string]),
            )
          : fallback.statusIcons,
        types: Array.isArray(types)
          ? types.map((type) => (typeof type === "string" ? taskType(type.trim()) : (type as TaskType)))
          : ((types ?? fallback.types) as TaskType[]),
        fields: (fields ?? fallback.fields) as FieldDefinition[],
      },
      windows,
    );
  }

  /**
   * The settings file, written over `previous` in its byte order mark and line endings.
   * Keys whose values did not change are left as they are written.
   */
  serialize(settings: Settings, previous: string | null, windows: boolean): string {
    const valid = this.validate(settings, windows);
    let document = new YAML.Document({});
    let before: Readonly<Record<string, unknown>> = {};
    if (previous !== null) {
      const parsed = YAML.parseDocument(withoutByteOrderMark(previous));
      if (!parsed.errors.length && YAML.isMap(parsed.contents)) {
        document = parsed;
        try {
          before = this.fileData(this.parse(previous, valid, windows));
        } catch {
          /* Invalid settings are rewritten as a whole. */
        }
      }
    }
    for (const [key, value] of Object.entries(this.fileData(valid))) {
      if (same(document.has(key) ? before[key] : OPTIONAL[key], value)) continue;
      // Optional lists stay out of the file while empty.
      if ((key === "hiddenColumns" || key === "fields") && !(value as unknown[]).length) document.delete(key);
      else document.set(key, value);
    }
    // Flow lists keep the usual spelling, [a, b].
    return applyTextStyle(document.toString({ flowCollectionPadding: false }), previous === null ? LF_STYLE : textStyleOf(previous));
  }

  /** Settings in the shape of the file. */
  private fileData({ statusIcons, ...settings }: Settings): Record<string, unknown> {
    const { statuses, types } = settings;
    return {
      ...settings,
      statuses: statuses.map((name) => (statusIcons[name] ? { name, icon: statusIcons[name] } : name)),
      types: types.map((type) => (same(taskType(type.name), type) ? type.name : type)),
    };
  }
}
