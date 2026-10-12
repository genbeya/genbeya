/**
 * Agent files: which files teach which coding agents to use Genbeya, and how
 * they are merged into what a repository already has. Genbeya owns the skill
 * files whole; in instruction files people also write themselves it owns
 * only a block between marker lines, which it inserts or replaces.
 *
 * Repositories may still have what GitDesk, as Genbeya was called before,
 * wrote: its blocks are replaced in place, and its skill files are
 * replaced by Genbeya's, under the new skill name.
 */
import { AGENT_TARGETS, type AgentFile, type AgentTarget, type Settings } from "../contracts/model";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";
import { agentsImport, section, skill, SKILL_NAME } from "./agent-instructions";
import { SETTINGS_FILE } from "./settings-engine";

/** Marker lines around the block, first Genbeya's, then those GitDesk wrote. */
const MARKERS = [
  { begin: "<!-- genbeya:begin -->", end: "<!-- genbeya:end -->" },
  { begin: "<!-- gitdesk:begin -->", end: "<!-- gitdesk:end -->" },
] as const;
const [{ begin: BEGIN, end: END }] = MARKERS;
/** The skill's name before Genbeya was renamed from GitDesk. */
const LEGACY_SKILL_NAME = "gitdesk";

/** Where each target is read from; skills by Claude Code (and Copilot, Cursor), or by Codex, Gemini CLI and others. */
const PATHS: Readonly<Record<AgentTarget, string>> = {
  claudeSkill: `.claude/skills/${SKILL_NAME}/SKILL.md`,
  agentsSkill: `.agents/skills/${SKILL_NAME}/SKILL.md`,
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md",
};
/** The skill files GitDesk wrote, which Genbeya's replace. */
const LEGACY_PATHS: Readonly<Partial<Record<AgentTarget, string>>> = {
  claudeSkill: `.claude/skills/${LEGACY_SKILL_NAME}/SKILL.md`,
  agentsSkill: `.agents/skills/${LEGACY_SKILL_NAME}/SKILL.md`,
};
/** Files Genbeya writes whole; the others hold a marked block. */
const WHOLE_FILES: readonly AgentTarget[] = ["claudeSkill", "agentsSkill"];

export interface AgentInstructions {
  readonly target: AgentTarget;
  readonly path: string;
  /** The whole file, or the marked block (without a final line break). */
  readonly text: string;
  /** True when Genbeya owns only a marked block of the file. */
  readonly block: boolean;
  /** Where GitDesk wrote this file, which this one replaces where the checkout has it; null for files that did not move. */
  readonly replaces: string | null;
}

/**
 * The start and end offsets of the marked block in `text`, or null without
 * one: Genbeya's block, or GitDesk's while there is none of Genbeya's.
 */
function findBlock(text: string, path: string): { start: number; end: number } | null {
  // Markers count on lines of their own only, so text that mentions them is left alone.
  const line = (marker: string) => new RegExp(`^${marker}[ \\t]*(?=\\r?$)`, "m");
  for (const { begin: open, end: close } of MARKERS) {
    const begin = line(open).exec(text);
    const end = begin && line(close).exec(text.slice(begin.index));
    if (!begin && !line(close).test(text)) continue;
    if (!begin || !end) throw new Error(`${path} has unmatched markers: ${open} must come before ${close}, each on a line of its own.`);
    return { start: begin.index, end: begin.index + end.index + end[0].length };
  }
  return null;
}

export class AgentEngine {
  /**
   * Every target's file, written as if `selected` were added: instruction
   * files point to a skill, and CLAUDE.md to AGENTS.md, only when those are
   * added too. They name the repository's `settingsFile`.
   */
  files(settings: Settings, selected: readonly AgentTarget[], settingsFile = SETTINGS_FILE): AgentInstructions[] {
    const values = { ...settings, settingsFile };
    const skillOf = (preferred: readonly AgentTarget[]) => {
      const target = preferred.find((candidate) => selected.includes(candidate));
      return target ? PATHS[target] : null;
    };
    const marked = (text: string) => `${BEGIN}\n\n${text}\n\n${END}`;
    const forAgents = section(values, skillOf(["agentsSkill", "claudeSkill"]));
    const texts: Record<AgentTarget, string> = {
      claudeSkill: skill(values),
      agentsSkill: skill(values),
      agents: marked(forAgents),
      claude: marked(selected.includes("agents") ? agentsImport() : section(values, skillOf(["claudeSkill", "agentsSkill"]))),
      copilot: marked(forAgents),
    };
    return AGENT_TARGETS.map((target) => ({
      target,
      path: PATHS[target],
      text: texts[target],
      block: !WHOLE_FILES.includes(target),
      replaces: LEGACY_PATHS[target] ?? null,
    }));
  }

  /**
   * `existing` (null for a missing file) with the generated text: the whole
   * file, or the block replaced or appended below the rest. Keeps the byte
   * order mark and line endings, and every character outside the block.
   */
  merge(file: AgentInstructions, existing: string | null): string {
    const style = existing === null ? LF_STYLE : textStyleOf(existing);
    if (!file.block || existing === null || !withoutByteOrderMark(existing).trim()) {
      return applyTextStyle(file.block ? `${file.text}\n` : file.text, style);
    }
    const block = file.text.replaceAll("\n", style.eol);
    const found = findBlock(existing, file.path);
    if (found) return existing.slice(0, found.start) + block + existing.slice(found.end);
    const separator = existing.endsWith("\n") ? style.eol : style.eol + style.eol;
    return existing + separator + block + style.eol;
  }

  /** With `replaced`, the file GitDesk wrote for the same target is there, which updating replaces. */
  stateOf(file: AgentInstructions, existing: string | null, replaced = false): AgentFile["state"] {
    if (replaced) return "outdated";
    if (existing === null || (file.block && !findBlock(existing, file.path))) return "missing";
    return this.merge(file, existing) === existing ? "current" : "outdated";
  }
}
