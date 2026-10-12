import { format, resolveConfig } from "prettier";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { AGENT_TARGETS, type AgentTarget, type Settings } from "../contracts/model";
import { AgentEngine, type AgentInstructions } from "./agent-engine";
import { SettingsEngine } from "./settings-engine";

const engine = new AgentEngine();
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
const genbeya: Settings = { ...new SettingsEngine().defaults("Genbeya"), wikiRoot: "docs", taskRoot: "tasks" };
const custom: Settings = {
  ...genbeya,
  wikiRoot: "handbook",
  wikiHome: "Start.md",
  taskRoot: "work/items",
  taskPrefix: "ACME",
  statuses: ["open", "doing", "closed"],
};
const ALL = [...AGENT_TARGETS];

const fileOf = (target: AgentTarget, settings = genbeya, selected: readonly AgentTarget[] = ALL): AgentInstructions =>
  engine.files(settings, selected).find((file) => file.target === target)!;

describe("AgentEngine", () => {
  it("puts the skill where Claude Code and other agents look, next to the instruction files", () => {
    expect(engine.files(genbeya, ALL).map(({ target, path, block }) => ({ target, path, block }))).toEqual([
      { target: "claudeSkill", path: ".claude/skills/genbeya/SKILL.md", block: false },
      { target: "agentsSkill", path: ".agents/skills/genbeya/SKILL.md", block: false },
      { target: "agents", path: "AGENTS.md", block: true },
      { target: "claude", path: "CLAUDE.md", block: true },
      { target: "copilot", path: ".github/copilot-instructions.md", block: true },
    ]);
    expect(fileOf("claudeSkill").text).toBe(fileOf("agentsSkill").text);
  });

  it("writes a skill with a name and a description that names the task prefix and folders", () => {
    const text = fileOf("claudeSkill", custom).text;
    const frontmatter = YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!) as Record<string, string>;
    expect(frontmatter["name"]).toBe("genbeya");
    expect(frontmatter["description"]).toContain("ACME-12");
    expect(frontmatter["description"]).toContain("work/items/");
    expect(frontmatter["description"]!.length).toBeLessThanOrEqual(1024);
  });

  it("fills in the folders and the task prefix of the project", () => {
    const text = fileOf("agentsSkill", custom).text;
    expect(text).toContain("`work/items/ACME-12.md`");
    expect(text).toContain("id: ACME-12");
    expect(text).toContain("`handbook/Start.md`");
    expect(text).toContain("[[ACME-12]]");
    expect(text).not.toMatch(/GD-|`docs\/|`tasks\//);
    for (const target of ["agents", "copilot"] as const) {
      expect(fileOf(target, custom).text).toContain("`work/items/` named after their ID (`ACME-12.md`)");
      expect(fileOf(target, custom).text).toContain("`handbook/Start.md`");
    }
  });

  it("leaves workflow states to .genbeya.yml, so changing them changes nothing", () => {
    const reordered = { ...custom, statuses: ["closed", "open"], hiddenColumns: ["open"] };
    expect(engine.files(reordered, ALL)).toEqual(engine.files(custom, ALL));
    expect(fileOf("claudeSkill", custom).text).not.toContain("doing");
  });

  it("quotes a description that would not parse as plain YAML", () => {
    const text = fileOf("claudeSkill", { ...custom, taskRoot: "work: items" }).text;
    const frontmatter = YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!) as Record<string, string>;
    expect(frontmatter["description"]).toContain("Tasks live in work: items/");
  });

  it("tells agents to find each area where .genbeya-content says it lives", () => {
    for (const target of ["agentsSkill", "agents"] as const) {
      expect(fileOf(target).text).toContain("`.genbeya-content`");
      expect(fileOf(target).text).toMatch(/`branch`[\s\S]*`checkout`/);
    }
  });

  it("points instruction files to the skill that is added", () => {
    expect(fileOf("agents").text).toContain("(`.agents/skills/genbeya/SKILL.md`)");
    expect(fileOf("agents", genbeya, ["claudeSkill", "agents"]).text).toContain("(`.claude/skills/genbeya/SKILL.md`)");
    expect(fileOf("agents", genbeya, ["agents"]).text).not.toContain("SKILL.md");
    expect(fileOf("claude", genbeya, ["claudeSkill", "agentsSkill", "claude"]).text).toContain("(`.claude/skills/genbeya/SKILL.md`)");
  });

  it("lets CLAUDE.md import AGENTS.md when that is added too", () => {
    expect(fileOf("claude").text).toContain("\n@AGENTS.md\n");
    expect(fileOf("claude").text).not.toContain("tasks/");
    const alone = fileOf("claude", genbeya, ["claude"]).text;
    expect(alone).not.toContain("@AGENTS.md");
    expect(alone).toContain("Use tasks instead of an internal todo list.");
  });

  it("marks the blocks it owns", () => {
    for (const target of ["agents", "claude", "copilot"] as const)
      expect(fileOf(target).text).toMatch(/^<!-- genbeya:begin -->\n\n[\s\S]+\n\n<!-- genbeya:end -->$/);
  });

  it("writes Markdown that Prettier leaves as it is", async () => {
    const options = { ...(await resolveConfig("AGENTS.md")), parser: "markdown" };
    for (const settings of [genbeya, custom])
      for (const file of engine.files(settings, ALL)) {
        const content = engine.merge(file, null);
        expect(await format(content, options), file.path).toBe(content);
      }
  });

  describe("merging", () => {
    const agents = fileOf("agents");
    const block = agents.text;

    it("creates new files with just the generated text", () => {
      expect(engine.merge(agents, null)).toBe(`${block}\n`);
      expect(engine.merge(fileOf("claudeSkill"), null)).toBe(fileOf("claudeSkill").text);
    });

    it("appends the block below the existing text, leaving it alone", () => {
      const existing = "# Agents\n\nRun `npm test`.  \n";
      expect(engine.merge(agents, existing)).toBe(`${existing}\n${block}\n`);
      expect(engine.merge(agents, "# Agents")).toBe(`# Agents\n\n${block}\n`);
      expect(engine.merge(agents, "")).toBe(`${block}\n`);
    });

    it("replaces only the block, and changes nothing when it is current", () => {
      const outdated = engine.merge(fileOf("agents", custom), "# Agents\n\nBefore.\n");
      const around = `${outdated}\nAfter the block.\n`;
      const updated = engine.merge(agents, around);
      expect(updated).toBe(`# Agents\n\nBefore.\n\n${block}\n\nAfter the block.\n`);
      expect(engine.merge(agents, updated)).toBe(updated);
    });

    it("keeps the byte order mark and Windows line endings", () => {
      const existing = `${BOM}# Agents${CRLF}${CRLF}Keep\nthis mixed line.${CRLF}`;
      const merged = engine.merge(agents, existing);
      expect(merged).toBe(`${existing}${CRLF}${block.replaceAll("\n", CRLF)}${CRLF}`);
      expect(engine.merge(fileOf("agents", custom), merged).startsWith(`${BOM}# Agents${CRLF}${CRLF}Keep\nthis mixed line.${CRLF}`)).toBe(
        true,
      );
      expect(engine.merge(agents, merged)).toBe(merged);
      const skill = fileOf("agentsSkill");
      expect(engine.merge(skill, `old${CRLF}`)).toBe(skill.text.replaceAll("\n", CRLF));
    });

    it("refuses a block without its end", () => {
      expect(() => engine.merge(agents, "<!-- genbeya:begin -->\nhalf\n")).toThrow("AGENTS.md has unmatched markers");
      expect(() => engine.merge(agents, "<!-- genbeya:end -->\n<!-- genbeya:begin -->\n")).toThrow("AGENTS.md");
    });

    it("finds markers only on lines of their own", () => {
      const mention = "Do not edit between `<!-- genbeya:begin -->` and the end marker.\n";
      expect(engine.merge(agents, mention)).toBe(`${mention}\n${block}\n`);
    });
  });

  describe("states", () => {
    it("says whether a file is missing, current or outdated", () => {
      const agents = fileOf("agents");
      expect(engine.stateOf(agents, null)).toBe("missing");
      expect(engine.stateOf(agents, "# Agents\n")).toBe("missing");
      expect(engine.stateOf(agents, engine.merge(agents, "# Agents\n"))).toBe("current");
      expect(engine.stateOf(agents, engine.merge(fileOf("agents", custom), "# Agents\n"))).toBe("outdated");
      const skill = fileOf("claudeSkill");
      expect(engine.stateOf(skill, null)).toBe("missing");
      expect(engine.stateOf(skill, skill.text)).toBe("current");
      expect(engine.stateOf(skill, skill.text.replaceAll("\n", CRLF))).toBe("current");
      expect(engine.stateOf(skill, "edited")).toBe("outdated");
    });
  });

  describe("in repositories GitDesk set up", () => {
    const legacyBlock = "<!-- gitdesk:begin -->\n\n## Tasks and wiki (GitDesk)\n\nOld text.\n\n<!-- gitdesk:end -->";

    it("names the settings file the repository has", () => {
      expect(fileOf("agentsSkill").text).toContain("2. Read `.genbeya.yml` where the settings live.");
      const legacy = engine.files(genbeya, ALL, ".gitdesk.yml");
      for (const file of legacy) expect(file.text, file.path).not.toContain(".genbeya.yml");
      expect(legacy.find((file) => file.target === "agentsSkill")!.text).toContain("2. Read `.gitdesk.yml` where the settings live.");
      expect(legacy.find((file) => file.target === "agents")!.text).toContain("- `.gitdesk.yml` holds the workflow states");
    });

    it("tells agents where GitDesk kept the content branch", () => {
      expect(fileOf("agentsSkill").text).toMatch(/inside `\.git\/gitdesk\/`, the branch named `gitdesk` and the file `\.gitdesk-content`/);
      expect(fileOf("agents").text).toContain("(`.git/gitdesk/` in repositories set up with GitDesk");
    });

    it("replaces the skill files GitDesk wrote, under the old skill name", () => {
      expect(engine.files(genbeya, ALL).map(({ target, replaces }) => [target, replaces])).toEqual([
        ["claudeSkill", ".claude/skills/gitdesk/SKILL.md"],
        ["agentsSkill", ".agents/skills/gitdesk/SKILL.md"],
        ["agents", null],
        ["claude", null],
        ["copilot", null],
      ]);
      const skill = fileOf("claudeSkill");
      expect(engine.stateOf(skill, null, true)).toBe("outdated");
      expect(engine.stateOf(skill, skill.text, true)).toBe("outdated");
    });

    it("replaces GitDesk's block in place, with Genbeya's markers", () => {
      const agents = fileOf("agents");
      const existing = `# Agents\n\n${legacyBlock}\n\nAfter.\n`;
      expect(engine.stateOf(agents, existing)).toBe("outdated");
      const merged = engine.merge(agents, existing);
      expect(merged).toBe(`# Agents\n\n${agents.text}\n\nAfter.\n`);
      expect(merged).not.toContain("gitdesk:");
      expect(engine.stateOf(agents, merged)).toBe("current");
    });

    it("keeps Windows line endings around GitDesk's block", () => {
      const agents = fileOf("agents");
      const existing = `# Agents${CRLF}${CRLF}${legacyBlock.replaceAll("\n", CRLF)}${CRLF}`;
      expect(engine.merge(agents, existing)).toBe(`# Agents${CRLF}${CRLF}${agents.text.replaceAll("\n", CRLF)}${CRLF}`);
    });

    it("prefers Genbeya's block when a file has both, and refuses GitDesk's markers without their end", () => {
      const agents = fileOf("agents");
      const both = `${legacyBlock}\n\n${engine.merge(fileOf("agents", custom), null)}`;
      expect(engine.merge(agents, both)).toBe(`${legacyBlock}\n\n${agents.text}\n`);
      expect(() => engine.merge(agents, "<!-- gitdesk:begin -->\nhalf\n")).toThrow(
        "AGENTS.md has unmatched markers: <!-- gitdesk:begin --> must come before <!-- gitdesk:end -->",
      );
    });
  });
});
