/** Validating a change of the user's preferences; shared by the workspace manager and the web demo's. */
import type { Preferences, Theme } from "../contracts/model";
import { parseVersion } from "../utilities/version";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
/** The repositories opened last are enough to offer the tour once in each. */
const TOUR_OFFERS = 100;

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
  for (const key of ["reopenLast", "autoSyncContent", "minimap", "tourSeen"] as const)
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
  return next;
}
