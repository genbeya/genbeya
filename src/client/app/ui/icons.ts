/**
 * The icons that task types and workflow states may use, by Lucide name.
 * The set is small and explicit, so the bundle only carries these icons;
 * names configured by hand outside it fall back to a generic icon.
 */
import {
  LucideArchive,
  LucideBan,
  LucideBookOpen,
  LucideBug,
  LucideCircle,
  LucideCircleCheck,
  LucideCircleDashed,
  LucideCircleDot,
  LucideCircleQuestionMark,
  LucideCircleX,
  LucideClock,
  LucideEye,
  LucideFileText,
  LucideFlag,
  LucideFlaskConical,
  LucideGauge,
  LucideInbox,
  LucideLightbulb,
  LucidePalette,
  LucidePause,
  LucidePlay,
  LucideRocket,
  LucideShield,
  LucideSparkles,
  LucideSquareCheck,
  LucideTrendingUp,
  LucideWrench,
  LucideZap,
  type LucideIcon,
} from "@lucide/angular";
import { GENERIC_TYPE_ICON } from "../../../contracts/model";

const ICONS: ReadonlyMap<string, LucideIcon> = new Map(
  [
    LucideBug,
    LucideSparkles,
    LucideTrendingUp,
    LucideWrench,
    LucideSquareCheck,
    LucideBookOpen,
    LucideFileText,
    LucideCircleQuestionMark,
    LucideFlaskConical,
    LucideLightbulb,
    LucideShield,
    LucideZap,
    LucidePalette,
    LucideGauge,
    LucideRocket,
    LucideCircleDot,
    LucideCircle,
    LucideCircleDashed,
    LucideCircleCheck,
    LucideCircleX,
    LucideClock,
    LucideEye,
    LucidePlay,
    LucidePause,
    LucideBan,
    LucideArchive,
    LucideInbox,
    LucideFlag,
  ].map((icon) => [icon.icon.name, icon]),
);

/** Every icon to choose from, in picker order. */
export const ICON_NAMES: readonly string[] = [...ICONS.keys()];

/** The icon of this name, if the set has it. */
export const knownIcon = (name: string | undefined): LucideIcon | undefined => (name ? ICONS.get(name) : undefined);

/** The icon of this name, or a generic one. */
export const iconFor = (name: string | undefined): LucideIcon => knownIcon(name) ?? ICONS.get(GENERIC_TYPE_ICON)!;
