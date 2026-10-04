import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Workspace } from "../core/workspace";
import type { DesktopAPI } from "../shared/api";

// Monaco does not run in jsdom; a textarea stands in for it.
vi.mock("../src/editor/Editor", () => ({
  SourceEditor: ({ value, onChange }: { value: string; onChange(v: string): void }) => (
    <textarea aria-label="Editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff">
      <pre>{original}</pre>
      <pre>{modified}</pre>
    </div>
  ),
}));

const exec = promisify(execFile);
let root = "";
let workspace: Workspace;

const files: Record<string, string> = {
  ".gitdesk.yml": "name: Test Project\ntaskPrefix: TP\n",
  "docs/Home.md": "# Home\n\n[TOC]\n\n## Section one\n\nSee [[Guide]] and TP-1.\n\n## Section two\n\nEnd. [[Glossary]]\n",
  "docs/Guide.md": "# Guide\n\nHow it works.\n",
  "tasks/TP-1.md": "---\nid: TP-1\ntitle: First task\nstatus: todo\npriority: high\n---\n\n- [ ] Check me\n",
  "src/index.ts": "export const value = 1;\n",
};

beforeAll(async () => {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  Element.prototype.scrollIntoView = () => undefined;
  window.confirm = () => true;
  const base = path.resolve(".test-work");
  await fs.mkdir(base, { recursive: true });
  root = await fs.mkdtemp(path.join(base, "ui-"));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "UI Test");
  await git("config", "user.email", "ui@example.com");
  await git("config", "core.autocrlf", "false");
  for (const [p, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), content);
  }
  await git("add", ".");
  await git("commit", "-q", "-m", "Initial");
  workspace = await Workspace.open({ kind: "local", path: root });

  const desktop: Partial<DesktopAPI> = {
    restore: () => workspace.snapshot(),
    recent: async () => [],
    preferences: async () => ({ theme: "system", reopenLast: true, autoSyncContent: false, plantumlServer: "" }),
    setPreferences: async (value) => ({ theme: "system", reopenLast: true, autoSyncContent: false, plantumlServer: "", ...value }),
    image: async () => "",
  };
  window.gitdesk = new Proxy(desktop as DesktopAPI, {
    get: (target, method: string) =>
      method in target
        ? (target as any)[method]
        : typeof (workspace as any)[method] === "function"
          ? (...args: unknown[]) => workspace.exclusive(() => (workspace as any)[method](...args))
          : undefined,
  });
});

afterAll(async () => {
  cleanup();
  workspace?.dispose();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
});

const read = (p: string) => fs.readFile(path.join(root, p), "utf8");
const key = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });

test("wiki, tasks, version control and settings work end to end", async () => {
  const { default: App } = await import("../src/app/App");
  render(<App />);

  // The home page renders with a table of contents and resolved wiki links.
  await screen.findByRole("heading", { level: 1, name: "Home" });
  expect(screen.getByRole("link", { name: "Section one" }).getAttribute("href")).toBe("#section-one");
  expect(screen.getByRole("link", { name: "TP-1" })).toBeTruthy();

  // Links to missing pages are marked and keep their target.
  expect(screen.getByRole("link", { name: "Glossary" }).className).toBe("md-missing");

  // Follow a wiki link, then go back with Alt+Left.
  fireEvent.click(screen.getByRole("link", { name: "Guide" }));
  await screen.findByRole("heading", { level: 1, name: "Guide" });
  key("ArrowLeft", { altKey: true });
  await screen.findByRole("heading", { level: 1, name: "Home" });

  // E edits, Ctrl+S saves to disk, Escape returns to reading.
  key("e");
  fireEvent.change(await screen.findByRole("textbox", { name: "Editor" }), {
    target: { value: "# Home\n\nEdited in the app.\n" },
  });
  key("s", { ctrlKey: true });
  await waitFor(async () => expect(await read("docs/Home.md")).toContain("Edited in the app."));
  key("Escape");
  await screen.findByText("Edited in the app.");

  // N creates a page.
  key("n");
  const dialog = await screen.findByRole("dialog", { name: "New page" });
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Notes/Meeting" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await screen.findByRole("heading", { level: 1, name: "Meeting" });
  expect(await read("docs/Notes/Meeting.md")).toBe("# Meeting\n\n");

  // Tasks: the board shows the task; C creates another.
  key("2", { ctrlKey: true });
  await screen.findByText("First task");
  key("c");
  const title = await screen.findByPlaceholderText("Task title");
  fireEvent.change(title, { target: { value: "Second task" } });
  key("s", { ctrlKey: true });
  await screen.findByRole("heading", { level: 1, name: "Second task" });
  expect(await read("tasks/TP-2.md")).toMatch(/id: TP-2\ntitle: Second task\nstatus: backlog/);
  key("Escape");

  // Opening a task renders its description; checkboxes save immediately.
  fireEvent.click(screen.getByText("First task"));
  const panel = await screen.findByRole("dialog", { name: "Task TP-1" });
  fireEvent.click(within(panel).getByRole("checkbox"));
  await waitFor(async () => expect(await read("tasks/TP-1.md")).toContain("- [x] Check me"));

  // Property chips change the task right away.
  fireEvent.click(within(panel).getByRole("button", { name: "Priority" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Low" }));
  await waitFor(async () => expect(await read("tasks/TP-1.md")).toContain("priority: low"));
  key("Escape");

  // Dragging a card to another column changes its status.
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const done = screen.getByRole("region", { name: "Done" });
  const card = (await workspace.snapshot())!.tasks.find((t) => t.id === "TP-2")!;
  fireEvent.drop(done, { dataTransfer: { getData: () => card.path } });
  await waitFor(async () => expect(await read("tasks/TP-2.md")).toContain("status: done"));

  // Changes: commit everything with Ctrl+Enter.
  key("4", { ctrlKey: true });
  const message = await screen.findByRole("textbox", { name: "Commit message" });
  fireEvent.change(message, { target: { value: "Work from the UI" } });
  await act(async () => {
    key("Enter", { ctrlKey: true });
  });
  await waitFor(async () => expect((await workspace.log(0, 1))[0].subject).toBe("Work from the UI"));
  expect((await workspace.snapshot())!.changes).toEqual([]);

  // History lists the commit.
  key("5", { ctrlKey: true });
  expect(await screen.findAllByText("Work from the UI")).not.toHaveLength(0);

  // Settings are written to .gitdesk.yml.
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const name = await screen.findByDisplayValue("Test Project");
  fireEvent.change(name, { target: { value: "Renamed Project" } });
  fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
  await waitFor(async () => expect(await read(".gitdesk.yml")).toContain("name: Renamed Project"));
  expect(screen.queryByRole("alert")).toBeNull();
}, 60_000);
