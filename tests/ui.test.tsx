import { afterEach, expect, test, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { RepositoryEngine } from "../electron/engine";
import type { DesktopAPI } from "../shared/types";
vi.mock("../src/editor", () => ({
  SourceEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <textarea
      aria-label="Source content"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  SourceDiff: ({ diff }: { diff: any }) => (
    <div data-testid="diff">
      <pre>{diff.original}</pre>
      <pre>{diff.modified}</pre>
    </div>
  ),
}));
afterEach(cleanup);
test("workspace interactions persist wiki, tasks, source edits, commits and settings through the real engine", async () => {
  const base = path.resolve(".test-work");
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "ui-"));
  const git = (...args: string[]) =>
    promisify(execFile)("git", args, { cwd: root });
  try {
    await fs.cp("sample", root, { recursive: true });
    await git("init", "-b", "main");
    await git("config", "user.name", "UI Test");
    await git("config", "user.email", "ui@example.com");
    await git("add", ".");
    await git("commit", "-m", "Initial workspace");
    const engine = await RepositoryEngine.open(root);
    const bridge: any = {};
    for (const method of [
      "snapshot",
      "read",
      "save",
      "createPage",
      "createTask",
      "updateTask",
      "diff",
      "stage",
      "unstage",
      "commit",
      "switchBranch",
      "createBranch",
      "sync",
      "setRemote",
      "saveSettings",
      "commitFiles",
    ])
      bridge[method] = (...args: any[]) =>
        engine.exclusive(() => (engine as any)[method](...args));
    for (const method of ["openRepository", "cloneRepository", "createDemo"])
      bridge[method] = async () => true;
    window.gitdesk = bridge as DesktopAPI;
    window.confirm = () => true;
    const { default: App } = await import("../src/App");
    render(<App />);
    const idle = () =>
      waitFor(() =>
        expect(
          document.querySelector(".app-shell")?.getAttribute("aria-busy"),
        ).toBe("false"),
      );
    fireEvent.click(screen.getByRole("button", { name: "Explore a demo" }));
    await screen.findByRole("heading", { name: "Welcome to Atlas" });
    await idle();
    fireEvent.click(
      screen.getByRole("button", { name: "New page", exact: true }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Page path, relative to the wiki root",
      }),
      { target: { value: "Architecture/Database" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create", exact: true }),
    );
    await screen.findByRole("textbox", { name: "Source content" });
    await idle();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await idle();
    fireEvent.change(screen.getByRole("textbox", { name: "Source content" }), {
      target: { value: "# Database\n\nFiles remain authoritative.\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save", exact: true }),
      ).toBeNull(),
    );
    expect(
      (await engine.read("docs/Architecture/Database.md")).content,
    ).toContain("Files remain authoritative");
    await idle();
    fireEvent.click(
      within(document.querySelector("nav")!).getByRole("button", {
        name: /Tasks/,
      }),
    );
    expect(screen.getByRole("heading", { name: "Task board" })).toBeTruthy();
    expect(document.querySelectorAll(".task-card")).toHaveLength(7);
    fireEvent.click(
      screen.getByRole("button", { name: "New task", exact: true }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Title", exact: true }),
      { target: { value: "UI integration task" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Description · Markdown" }),
      { target: { value: "A task created through the interface." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create task", exact: true }),
    );
    await screen.findByRole("heading", { name: "UI integration task" });
    await idle();
    fireEvent.click(
      screen
        .getByRole("heading", { name: "UI integration task" })
        .closest("button")!,
    );
    fireEvent.change(screen.getByLabelText("Status", { exact: true }), {
      target: { value: "review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save task", exact: true }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await idle();
    expect(
      (await engine.snapshot()).tasks.find(
        (t) => t.title === "UI integration task",
      )!.status,
    ).toBe("review");
    await idle();
    const moved = (await engine.snapshot()).tasks.find(
      (t) => t.title === "UI integration task",
    )!;
    const doneColumn = [...document.querySelectorAll(".board-column")].find(
      (n) => n.querySelector("header strong")?.textContent === "Done",
    )!;
    fireEvent.drop(doneColumn, { dataTransfer: { getData: () => moved.path } });
    await idle();
    expect(
      (await engine.snapshot()).tasks.find((t) => t.id === moved.id)!.status,
    ).toBe("done");
    fireEvent.click(
      within(document.querySelector("nav")!).getByRole("button", {
        name: "Code",
        exact: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "index.ts" }));
    await screen.findByRole("textbox", { name: "Source content" });
    await idle();
    fireEvent.change(screen.getByRole("textbox", { name: "Source content" }), {
      target: { value: "export const edited = true;\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save file" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    await idle();
    expect((await engine.read("src/index.ts")).content).toContain(
      "edited = true",
    );
    fireEvent.click(
      within(document.querySelector("nav")!).getByRole("button", {
        name: /Version control/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stage src/index.ts", exact: true }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Unstage src/index.ts",
          exact: true,
        }),
      ).toBeTruthy(),
    );
    await idle();
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "Commit through UI" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Commit staged changes" }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "Commit message" })
          .getAttribute("value") ??
          (
            screen.getByRole("textbox", {
              name: "Commit message",
            }) as HTMLTextAreaElement
          ).value,
      ).toBe(""),
    );
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "History & graph" }));
    await waitFor(() =>
      expect(document.querySelector(".history-row strong")!.textContent).toBe(
        "Commit through UI",
      ),
    );
    fireEvent.click(document.querySelector(".history-row")!);
    await screen.findByRole("heading", { name: "Commit through UI" });
    await idle();
    fireEvent.click(
      screen.getByRole("button", { name: "Project settings", exact: true }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "Atlas POC" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(document.querySelector(".project strong")!.textContent).toBe(
        "Atlas POC",
      ),
    );
    expect((await engine.snapshot()).settings.name).toBe("Atlas POC");
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
