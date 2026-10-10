/**
 * The icons that task types and workflow states may use, by Lucide name.
 * The set is small and explicit (see icon-data.ts); names configured by hand
 * outside it fall back to a generic icon.
 */
import type { LucideIconData } from "@lucide/angular";
import { GENERIC_TYPE_ICON } from "../../../contracts/model";
import { ICON_DATA } from "./icon-data";

const ICONS: ReadonlyMap<string, LucideIconData> = new Map(ICON_DATA.map((icon) => [icon.name, icon]));

/** Every icon to choose from, in picker order. */
export const ICON_NAMES: readonly string[] = [...ICONS.keys()];

/** The icon of this name, if the set has it. */
export const knownIcon = (name: string | undefined): LucideIconData | undefined => (name ? ICONS.get(name) : undefined);

/** The icon of this name, or a generic one. */
export const iconFor = (name: string | undefined): LucideIconData => knownIcon(name) ?? ICONS.get(GENERIC_TYPE_ICON)!;
