import { TestBed } from "@angular/core/testing";
import type { AgentFile, AgentTarget, Snapshot } from "../../../../contracts/model";
import { Notifications } from "../../core/notifications";
import { openRepository, settle } from "../../testing/component-harness";
import { snapshot } from "../../testing/fake-platform";
import { AgentFiles } from "./agent-files";

const PATHS: Record<AgentTarget, string> = {
  claudeSkill: ".claude/skills/genbeya/SKILL.md",
  agentsSkill: ".agents/skills/genbeya/SKILL.md",
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md",
};

const files = (states: Partial<Record<AgentTarget, AgentFile["state"]>> = {}, ignored: AgentTarget[] = []): AgentFile[] =>
  (Object.keys(PATHS) as AgentTarget[]).map((target) => ({
    target,
    path: PATHS[target],
    text: `Text of ${PATHS[target]} using TP-12`,
    state: states[target] ?? "missing",
    ignored: ignored.includes(target),
  }));

async function render(answer: AgentFile[] | Error) {
  const harness = await openRepository();
  if (answer instanceof Error) harness.managers.content.agentFiles.mockRejectedValue(answer);
  else harness.managers.content.agentFiles.mockResolvedValue(answer);
  const fixture = TestBed.createComponent(AgentFiles);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const box = (path: string) => element.querySelector<HTMLInputElement>(`input[data-path="${path}"]`)!;
  const checked = () =>
    [...element.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].filter((b) => b.checked).map((b) => b.dataset["path"]);
  const button = () => element.querySelector<HTMLButtonElement>(".agent-actions button")!;
  return { ...harness, fixture, element, box, checked, button };
}

describe("AgentFiles", () => {
  it("offers the skills, AGENTS.md and CLAUDE.md when the repository has none of the files", async () => {
    const { element, checked, button, managers } = await render(files());
    expect(managers.content.agentFiles).toHaveBeenCalledWith("w1", ["claudeSkill", "agentsSkill", "agents", "claude"]);
    expect(checked()).toEqual([PATHS.claudeSkill, PATHS.agentsSkill, "AGENTS.md", "CLAUDE.md"]);
    expect([...element.querySelectorAll(".agent-state")].map((state) => state.textContent!.trim())).toEqual(Array(5).fill("Not added"));
    expect(button().textContent!.trim()).toBe("Add to repository");
    expect(button().disabled).toBe(false);
  });

  it("adds the chosen files and says where to commit them", async () => {
    const { box, button, fixture, managers } = await render(files());
    const success = vi.spyOn(TestBed.inject(Notifications), "success");
    box("CLAUDE.md").click();
    await settle(fixture);
    expect(managers.content.agentFiles).toHaveBeenLastCalledWith("w1", ["claudeSkill", "agentsSkill", "agents"]);
    managers.content.addAgentFiles.mockResolvedValue([
      { path: PATHS.claudeSkill, result: "created" },
      { path: PATHS.agentsSkill, result: "created" },
      { path: "AGENTS.md", result: "unchanged" },
    ]);
    managers.content.agentFiles.mockResolvedValue(files({ claudeSkill: "current", agentsSkill: "current", agents: "current" }));
    button().click();
    await settle(fixture);
    expect(managers.content.addAgentFiles).toHaveBeenCalledWith("w1", ["claudeSkill", "agentsSkill", "agents"]);
    expect(success).toHaveBeenCalledWith("Added 2 agent files. Review and commit them in Changes.");
    expect(button().textContent!.trim()).toBe("Up to date");
    expect(button().disabled).toBe(true);
  });

  it("keeps to the files the repository already has, and offers to update outdated ones", async () => {
    const { checked, button, element } = await render(files({ agents: "outdated", claude: "current" }));
    expect(checked()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(element.textContent).toContain("Outdated");
    expect(button().textContent!.trim()).toBe("Update");
  });

  it("previews the generated text and warns about ignored files", async () => {
    const { element } = await render(files({}, ["claudeSkill"]));
    const preview = element.querySelector<HTMLDetailsElement>("details")!;
    expect(preview.querySelector("summary")!.textContent!.trim()).toBe("Preview");
    expect(preview.querySelector("pre")!.textContent).toBe(`Text of ${PATHS.claudeSkill} using TP-12`);
    expect(element.querySelectorAll(".agent-warning")).toHaveLength(1);
    expect(element.querySelector(".agent-warning")!.textContent).toContain(".gitignore");
  });

  it("checks the files again only when something they depend on changes", async () => {
    const { managers, session, fixture } = await render(files());
    const checks = () => managers.content.agentFiles.mock.calls.length;
    const before = checks();
    const refresh = async (change: Partial<Snapshot>) => {
      managers.workspace.snapshot.mockResolvedValue(snapshot(change));
      await session.refresh();
      await settle(fixture);
    };
    await refresh({ changes: [{ path: "src/app.ts", index: " ", worktree: "M" }] });
    expect(checks()).toBe(before);
    await refresh({ changes: [{ path: ".claude/", index: "?", worktree: "?" }] });
    expect(checks()).toBe(before + 1);
    await refresh({ changes: [{ path: ".claude/", index: "?", worktree: "?" }], settingsHash: "h2" });
    expect(checks()).toBe(before + 2);
  });

  it("explains why the files could not be checked", async () => {
    const { element, button } = await render(new Error("CLAUDE.md has unmatched Genbeya markers"));
    expect(element.querySelector(".agent-error")!.textContent).toContain("CLAUDE.md has unmatched Genbeya markers");
    expect(button().disabled).toBe(true);
  });
});
