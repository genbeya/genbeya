/**
 * Agent files: which files teach which coding agents to use Genbeya, and how
 * they are merged into what a repository already has. Genbeya owns the skill
 * files whole; in instruction files people also write themselves it owns
 * only a block between marker lines, which it inserts or replaces.
 */
import { AGENT_TARGETS, type AgentFile, type AgentTarget, type Settings } from "../contracts/model";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";
import { agentsImport, section, skill, SKILL_NAME } from "./agent-instructions";

const BEGIN = "<!-- genbeya:begin -->";
const END = "<!-- genbeya:end -->";

/** Where each target is read from; skills by Claude Code (and Copilot, Cursor), or by Codex, Gemini CLI and others. */
const PATHS: Readonly<Record<AgentTarget, string>> = {
  claudeSkill: `.claude/skills/${SKILL_NAME}/SKILL.md`,
  agentsSkill: `.agents/skills/${SKILL_NAME}/SKILL.md`,
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md",
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
}

/** The start and end offsets of the marked block in `text`, or null without one. */
function findBlock(text: string, path: string): { start: number; end: number } | null {
  // Markers count on lines of their own only, so text that mentions them is left alone.
  const line = (marker: string) => new RegExp(`^${marker}[ \\t]*(?=\\r?$)`, "m");
  const begin = line(BEGIN).exec(text);
  const end = begin && line(END).exec(text.slice(begin.index));
  if (!begin && !line(END).test(text)) return null;
  if (!begin || !end)
    throw new Error(`${path} has unmatched Genbeya markers: ${BEGIN} must come before ${END}, each on a line of its own.`);
  return { start: begin.index, end: begin.index + end.index + end[0].length };
}

export class AgentEngine {
  /**
   * Every target's file, written as if `selected` were added: instruction
   * files point to a skill, and CLAUDE.md to AGENTS.md, only when those are
   * added too.
   */
  files(settings: Settings, selected: readonly AgentTarget[]): AgentInstructions[] {
    const skillOf = (preferred: readonly AgentTarget[]) => {
      const target = preferred.find((candidate) => selected.includes(candidate));
      return target ? PATHS[target] : null;
    };
    const marked = (text: string) => `${BEGIN}\n\n${text}\n\n${END}`;
    const forAgents = section(settings, skillOf(["agentsSkill", "claudeSkill"]));
    const texts: Record<AgentTarget, string> = {
      claudeSkill: skill(settings),
      agentsSkill: skill(settings),
      agents: marked(forAgents),
      claude: marked(selected.includes("agents") ? agentsImport() : section(settings, skillOf(["claudeSkill", "agentsSkill"]))),
      copilot: marked(forAgents),
    };
    return AGENT_TARGETS.map((target) => ({ target, path: PATHS[target], text: texts[target], block: !WHOLE_FILES.includes(target) }));
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

  stateOf(file: AgentInstructions, existing: string | null): AgentFile["state"] {
    if (existing === null || (file.block && !findBlock(existing, file.path))) return "missing";
    return this.merge(file, existing) === existing ? "current" : "outdated";
  }
}
