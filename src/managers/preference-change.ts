/** Validating a change of the user's preferences; shared by the workspace manager and the web demo's. */
import {
  EDITOR_FONTS,
  PARTS,
  type EditorFont,
  type PartChoices,
  type PartPreferences,
  type Preferences,
  type Theme,
} from "../contracts/model";
import { parseVersion } from "../utilities/version";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
/** The repositories opened last are enough to offer the tour once in each. */
const TOUR_OFFERS = 100;
/** Repositories with parts hidden in them alone; the oldest are forgotten first. */
const PART_REPOSITORIES = 200;

const isRepositoryKey = (key: unknown): key is string =>
  typeof key === "string" && key.length > 0 && key.length < 5000 && !/[\0\r\n]/.test(key);

/** `current` with the preferences `change` names; refuses values of the wrong kind. */
export function changePreferences(current: Preferences, change: unknown): Preferences {
  const value = (change ?? {}) as Partial<Record<keyof Preferences, unknown>>;
  const next = { ...current };
  if (value.theme !== undefined) {
    if (!THEMES.includes(value.theme as Theme)) throw new Error("Choose the system, light or dark theme.");
    next.theme = value.theme as Theme;
  }
  if (value.editorFont !== undefined) {
    if (!EDITOR_FONTS.includes(value.editorFont as EditorFont)) throw new Error("Choose one of the editor fonts Genbeya ships.");
    next.editorFont = value.editorFont as EditorFont;
  }
  for (const key of ["reopenLast", "autoSyncContent", "minimap", "ligatures", "tourSeen"] as const)
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") throw new Error(`Invalid ${key} preference.`);
      next[key] = value[key];
    }
  if (value.lastSeenVersion !== undefined) {
    if (!parseVersion(value.lastSeenVersion)) throw new Error("Invalid lastSeenVersion preference.");
    next.lastSeenVersion = (value.lastSeenVersion as string).trim();
  }
  if (value.tourOffered !== undefined) {
    const keys = value.tourOffered;
    if (!Array.isArray(keys) || !keys.every(isRepositoryKey)) throw new Error("Invalid tourOffered preference.");
    next.tourOffered = keys.slice(-TOUR_OFFERS);
  }
  if (value.parts !== undefined) next.parts = partPreferences(value.parts);
  return next;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Choices per part, true or false, in the app's order. */
function partChoices(value: unknown): PartChoices {
  if (
    !isRecord(value) ||
    Object.entries(value).some(([part, on]) => !(PARTS as readonly string[]).includes(part) || typeof on !== "boolean")
  )
    throw new Error(`Invalid parts preference: choose true or false for ${PARTS.join(", ")}.`);
  return Object.fromEntries(PARTS.filter((part) => part in value).map((part) => [part, value[part]]));
}

function partPreferences(value: unknown): PartPreferences {
  const { all, repositories } = isRecord(value) ? value : {};
  if (!isRecord(repositories) || !Object.keys(repositories).every(isRepositoryKey)) throw new Error("Invalid parts preference.");
  const entries = Object.entries(repositories);
  return {
    all: partChoices(all),
    repositories: Object.fromEntries(entries.slice(-PART_REPOSITORIES).map(([key, choices]) => [key, partChoices(choices)])),
  };
}
