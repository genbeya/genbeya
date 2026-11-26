/**
 * The kit as a host shows it: the built dist/kit, served from its own origin, with a test host
 * that records every message the kit posts. Each message is checked against the protocol.
 */
import { expect, test as base, type Page } from "@playwright/test";
import { checkFromKit, KIT_PROTOCOL, type FromKit, type ToKit } from "../../src/shells/kit/protocol";

declare global {
  interface Window {
    hostInbox: unknown[];
    inlineRan?: boolean;
    genbeyaKitHost?: { post(message: string): void };
    genbeyaKit?: { receive(message: string): void };
  }
}

const PAGE = [
  "# Kit",
  "",
  "See [[KIT-1]] and [[Nowhere]].",
  "",
  "- [ ] Tick me",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
  "```plantuml",
  "Alice -> Bob: Hello",
  "```",
  "",
].join("\n");

const CONTEXT: ToKit = {
  type: "context",
  parts: {
    wiki: { version: "1", value: [{ title: "Kit", path: "docs/Kit.md", folder: null, children: [] }] },
    tasks: { version: "1", value: [{ id: "KIT-1", path: "tasks/KIT-1.md", title: "Try the kit", status: "todo" }] },
    plan: { version: "1", value: [] },
    files: { version: "1", value: ["src/app.ts"] },
    people: { version: "1", value: [] },
    settings: { version: "1", value: { wikiRoot: "docs", statuses: ["todo", "done"] } },
    author: { version: "1", value: "Sam" },
  },
};

const test = base.extend<{ kit: Page }>({
  kit: async ({ page }, use) => {
    // Nothing may come from another origin: the kit makes no requests but to its own files.
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const foreign: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) foreign.push(request.url());
    });
    await page.addInitScript(() => {
      window.hostInbox = [];
      window.genbeyaKitHost = { post: (message: string) => void window.hostInbox.push(JSON.parse(message)) };
    });
    await page.goto("kit.html");
    await expect.poll(() => sent(page, "ready")).toHaveLength(1);
    await use(page);
    for (const message of await page.evaluate(() => window.hostInbox)) checkFromKit(message);
    expect(foreign).toEqual([]);
  },
});

const send = (page: Page, message: ToKit | Record<string, unknown>) =>
  page.evaluate((json) => window.genbeyaKit!.receive(json), JSON.stringify(message));

async function sent<T extends FromKit["type"]>(page: Page, type: T): Promise<Extract<FromKit, { type: T }>[]> {
  const inbox = (await page.evaluate(() => window.hostInbox)) as FromKit[];
  return inbox.filter((message): message is Extract<FromKit, { type: T }> => message.type === type);
}

test("says it is ready, with the protocol it speaks", async ({ kit }) => {
  const [ready] = await sent(kit, "ready");
  expect(ready).toMatchObject({ protocol: KIT_PROTOCOL });
  expect(ready!.genbeya).toMatch(/^\d+\.\d+\.\d+$/);
});

test("renders a page with references, math and both kinds of diagram", async ({ kit }) => {
  await send(kit, CONTEXT);
  await send(kit, { type: "preview", document: { kind: "page", path: "docs/Kit.md", title: "Kit", source: PAGE, hash: "h1" } });
  await expect(kit.getByRole("heading", { name: "Kit" })).toBeVisible();
  await expect(kit.locator("a", { hasText: "Try the kit" })).toBeVisible();
  await expect(kit.locator("math")).toHaveCount(1);
  await expect(kit.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  await expect(kit.getByRole("img", { name: "PlantUML diagram" })).toBeVisible();
  await expect.poll(async () => (await sent(kit, "height")).at(-1)?.height ?? 0).toBeGreaterThan(200);
});

test("reports a ticked checkbox with the version shown, and followed links", async ({ kit }) => {
  await send(kit, CONTEXT);
  await send(kit, { type: "preview", document: { kind: "page", path: "docs/Kit.md", title: "Kit", source: PAGE, hash: "h1" } });
  await kit.locator(".md-check.is-interactive").click();
  await expect
    .poll(() => sent(kit, "toggle"))
    .toEqual([{ type: "toggle", area: "wiki", path: "docs/Kit.md", hash: "h1", offset: PAGE.indexOf("- [ ]") }]);
  await kit.locator("a", { hasText: "Try the kit" }).click();
  await expect
    .poll(async () => (await sent(kit, "follow")).map((message) => message.link))
    .toEqual([{ kind: "file", path: "tasks/KIT-1.md", anchor: undefined }]);
});

test("shows a task's description and comments, and Markdown of other areas", async ({ kit }) => {
  await send(kit, CONTEXT);
  const task = {
    id: "KIT-1",
    path: "tasks/KIT-1.md",
    title: "Try the kit",
    status: "todo",
    priority: "medium",
    assignee: "",
    labels: [],
    type: "",
    fields: {},
    epic: "",
    body: "Do it.\n\n- [ ] First step\n",
    hash: "t1",
    comments: [{ author: "Alex", date: "2026-11-24T09:30+01:00", body: "Looks **good**." }],
  };
  await send(kit, { type: "preview", document: { kind: "task", task } });
  await expect(kit.getByText("Do it.")).toBeVisible();
  await expect(kit.locator(".kit-comment")).toContainText("Alex");
  await expect(kit.locator(".kit-comment strong", { hasText: "good" })).toBeVisible();
  await kit.locator(".md-check.is-interactive").click();
  await expect
    .poll(() => sent(kit, "toggle"))
    .toEqual([{ type: "toggle", area: "tasks", path: "tasks/KIT-1.md", hash: "t1", offset: task.body.indexOf("- [ ]") }]);
  await send(kit, {
    type: "preview",
    document: { kind: "markdown", area: "pulls", path: "pulls/PR-1.md", source: "## Review\n\nLooks right.", hash: "p1" },
  });
  await expect(kit.getByRole("heading", { name: "Review" })).toBeVisible();
});

test("asks the host for repository images", async ({ kit }) => {
  await send(kit, CONTEXT);
  await send(kit, {
    type: "preview",
    document: { kind: "page", path: "docs/Kit.md", title: "Kit", source: "![Logo](logo.png)", hash: "h1" },
  });
  await expect.poll(() => sent(kit, "image")).toHaveLength(1);
  const [request] = await sent(kit, "image");
  expect(request!.path).toBe("docs/logo.png");
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await send(kit, { type: "reply", id: request!.id, value: pixel });
  await expect(kit.getByRole("img", { name: "Logo" })).toHaveAttribute("src", pixel);
});

test("edits text with completion, toolbar commands and saving", async ({ kit }) => {
  await send(kit, CONTEXT);
  await send(kit, { type: "edit", area: "wiki", path: "docs/Kit.md", text: "", hash: "h1", readOnly: false });
  const editor = kit.locator(".cm-content");
  await expect(editor).toBeFocused();
  await kit.keyboard.type("See [[Try");
  await expect(kit.locator(".cm-tooltip-autocomplete")).toContainText("Try the kit");
  await expect.poll(async () => (await sent(kit, "editorState")).some((state) => state.completing)).toBe(true);
  await kit.locator(".cm-tooltip-autocomplete li", { hasText: "Try the kit" }).click();
  await expect(editor).toContainText("See [[KIT-1]]");
  await editor.press("End");
  await kit.keyboard.press("Shift+Home");
  await send(kit, { type: "editorCommand", command: "bold" });
  await expect(editor).toContainText("**See [[KIT-1]]**");
  await send(kit, { type: "editorCommand", command: "save" });
  await expect.poll(() => sent(kit, "save")).toEqual([{ type: "save", path: "docs/Kit.md", hash: "h1", text: "**See [[KIT-1]]**" }]);
  expect((await sent(kit, "editorState")).at(-1)).toMatchObject({ dirty: false });
});

test("refuses messages that aren't the protocol's, and inline scripts", async ({ kit }) => {
  await send(kit, { type: "launch", missiles: true });
  await send(kit, { type: "theme", mode: "dark", tokens: { "bg-app": "red; } body { display: none" } });
  await expect
    .poll(async () => (await sent(kit, "error")).map((message) => message.message))
    .toEqual(["launch is not a message the kit takes.", "theme.tokens.bg-app is not a token."]);
  const ran = await kit.evaluate(async () => {
    const violation = new Promise<boolean>((resolve) => {
      document.addEventListener("securitypolicyviolation", () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 2000);
    });
    const script = document.createElement("script");
    script.textContent = "window.inlineRan = true";
    document.head.append(script);
    return { refused: await violation, ran: window.inlineRan === true };
  });
  expect(ran).toEqual({ refused: true, ran: false });
});

const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the section, long enough to scroll.`).join("\n\n");
const OUTLINED = `# Release notes\n\n${filler}\n\n### What's new: Ünïcode & more\n\n${filler}\n\n## Fixes\n\n${filler}\n`;

test("posts the outline of each render, and reveals a heading", async ({ kit }) => {
  await send(kit, CONTEXT);
  await send(kit, { type: "preview", document: { kind: "page", path: "docs/Notes.md", title: "Notes", source: OUTLINED, hash: "n1" } });
  await expect.poll(async () => (await sent(kit, "outline")).length).toBe(1);
  const [outline] = await sent(kit, "outline");
  expect(outline!.path).toBe("docs/Notes.md");
  expect(outline!.headings.map(({ level, text }) => [level, text])).toEqual([
    [1, "Release notes"],
    [3, "What's new: Ünïcode & more"],
    [2, "Fixes"],
  ]);
  const ids = outline!.headings.map((heading) => heading.id);
  expect(new Set(ids).size).toBe(3);
  // The ids are the renderer's: each names its heading in the page.
  for (const id of ids) await expect(kit.locator(`[id="${id}"]`)).toHaveCount(1);

  // A new context re-renders the page, and its outline comes again.
  await send(kit, { type: "context", parts: { tasks: { version: "2", value: [] } } });
  await expect.poll(async () => (await sent(kit, "outline")).length).toBe(2);

  await send(kit, { type: "reveal", id: ids[1]! });
  const heading = kit.getByRole("heading", { name: "What's new: Ünïcode & more" });
  await expect.poll(async () => Math.round((await heading.boundingBox())!.y)).toBeLessThan(40);
  const scrolled = await kit.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  await send(kit, { type: "reveal", id: "nowhere" });
  expect(await kit.evaluate(() => window.scrollY)).toBe(scrolled);
  expect(await sent(kit, "error")).toEqual([]);
});

test("ticks the checkboxes of Markdown only when the host lets them", async ({ kit }) => {
  await send(kit, CONTEXT);
  const comment = { kind: "markdown", area: "pulls", path: "pulls/PR-1.md", source: "- [ ] Not here\n", hash: "c1" };
  await send(kit, { type: "preview", document: { ...comment, checkboxes: false } });
  await expect.poll(async () => (await sent(kit, "outline")).length).toBe(1);
  await kit.getByText("Not here").click();
  await kit.locator(".md-check").first().click({ force: true });
  expect(await sent(kit, "toggle")).toEqual([]);
  await send(kit, { type: "preview", document: comment });
  await kit.locator(".md-check.is-interactive").click();
  await expect.poll(() => sent(kit, "toggle")).toEqual([{ type: "toggle", area: "pulls", path: "pulls/PR-1.md", hash: "c1", offset: 0 }]);
});
