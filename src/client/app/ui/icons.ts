/**
 * The icons that task types and workflow states may use, by Lucide name.
 * The set is small and explicit; names configured by hand outside it fall
 * back to a generic icon.
 */
import { GENERIC_TYPE_ICON } from "../../../contracts/model";
import type { IconName } from "./icon-data";

/** Every icon to choose from, in picker order. */
export const ICON_NAMES: readonly IconName[] = [
  "bug",
  "sparkles",
  "trending-up",
  "wrench",
  "square-check",
  "book-open",
  "file-text",
  "circle-question-mark",
  "flask-conical",
  "lightbulb",
  "shield",
  "zap",
  "palette",
  "gauge",
  "rocket",
  "circle-dot",
  "circle",
  "circle-dashed",
  "circle-check",
  "circle-x",
  "clock",
  "eye",
  "play",
  "pause",
  "ban",
  "archive",
  "inbox",
  "flag",
];

/** The icon of this name, if the set has it. */
export const knownIcon = (name: string | undefined): IconName | undefined => ICON_NAMES.find((icon) => icon === name);

/** The icon of this name, or a generic one. */
export const iconFor = (name: string | undefined): IconName => knownIcon(name) ?? GENERIC_TYPE_ICON;
