import { expect, FILES, MOD, test } from "./app";

test.describe("AI agents", () => {
  test.use({ files: { ...FILES, "AGENTS.md": "# Agents\n\nRun the tests before committing.\n" } });

  test("adds the skill and instructions to the repository, keeping what AGENTS.md says", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+,`);
    const section = window.getByRole("region", { name: "AI agents" });
    await expect(section.getByText("Not added")).toHaveCount(5);
    await section.getByRole("button", { name: "Add to repository" }).click();
    await expect(section.getByRole("button", { name: "Up to date" })).toBeDisabled();

    const skill = repository.read(".claude/skills/genbeya/SKILL.md");
    expect(skill).toContain("`tasks/DP-12.md`");
    expect(repository.read(".agents/skills/genbeya/SKILL.md")).toBe(skill);
    expect(repository.read("AGENTS.md")).toMatch(
      /^# Agents\n\nRun the tests before committing\.\n\n<!-- genbeya:begin -->\n[\s\S]*`DP-12\.md`/,
    );
    expect(repository.read("CLAUDE.md")).toContain("@AGENTS.md");
    expect(repository.read(".github/copilot-instructions.md")).toBeNull();

    await window.keyboard.press(`${MOD}+4`);
    await expect(window.locator("gd-change-row", { hasText: "CLAUDE.md" })).toBeVisible();
  });
});
