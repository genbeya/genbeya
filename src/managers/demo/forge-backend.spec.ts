import { describe, expect, it } from "vitest";
import { fakeGitHub } from "../../testing/fake-forges";
import { NO_SYNC, openForgeBackend, readForgeContent, referencedPaths } from "./forge-backend";

const github = () =>
  fakeGitHub([
    {
      owner: "acme",
      name: "rockets",
      defaultBranch: "main",
      branches: {
        main: {
          message: "Plan the launch\n\nWith details.",
          author: { name: "Ada Lovelace", email: "ada@example.com", date: "2026-11-01T10:00:00Z" },
          files: {
            ".genbeya.yml": "name: Rockets\ntaskPrefix: RKT\nstatuses: [todo, doing, done]\n",
            "docs/Home.md": "# Rockets\n\nSee [[RKT-1]].\n",
            "docs/Guide.md": "# Guide\n",
            "tasks/Launch/RKT-1.md": "---\nid: RKT-1\ntitle: Launch\nstatus: doing\n---\n\n- [ ] Fuel\n",
            "src/main.ts": "export const ready = true;\n",
            "src/other.ts": "export const unused = true;\n",
            "docs/images/plan.png": "png",
            "README.md": "# Rockets\n\n![Plan](docs/images/plan.png)\n\n![[src/main.ts#L1-L1]]\n",
          },
        },
      },
    },
  ]);

describe("Genbeya on a repository read from GitHub", () => {
  it("opens the repository with its settings, wiki and tasks, clean and in step with GitHub", async () => {
    const { managers, summary } = await openForgeBackend(
      { forge: "github", host: "github.com", owner: "acme", name: "rockets" },
      { fetch: github() },
    );
    const opened = await managers.workspace.restore([]);
    const view = opened!.snapshot;
    expect(view.settings.name).toBe("Rockets");
    expect(view.tasks.map((task) => [task.id, task.status, task.epic])).toEqual([["RKT-1", "doing", "Launch"]]);
    expect(view.wiki.map((page) => page.path)).toEqual(expect.arrayContaining(["docs/Home.md", "docs/Guide.md"]));
    expect(view.changes).toEqual([]);
    expect(view.head).toMatchObject({
      branch: "main",
      commit: summary.commit.slice(0, 7),
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
    });
    expect(view.remotes).toEqual([{ name: "origin", url: "https://github.com/acme/rockets.git" }]);

    const [commit] = await managers.versionControl.log(opened!.id, 0, 10);
    expect(commit).toMatchObject({ hash: summary.commit, subject: "Plan the launch", author: "Ada Lovelace" });
  });

  it("keeps edits in the tab and refuses to fetch or push", async () => {
    const { managers } = await openForgeBackend(
      { forge: "github", host: "github.com", owner: "acme", name: "rockets" },
      { fetch: github() },
    );
    const { id } = (await managers.workspace.restore([]))!;
    const page = await managers.content.read(id, "content", "docs/Guide.md");
    await managers.content.write(id, "content", "docs/Guide.md", "# Guide\n\nMore.\n", page.hash);
    expect((await managers.workspace.snapshot(id))!.changes.map((change) => change.path)).toEqual(["docs/Guide.md"]);
    await expect(managers.versionControl.sync(id, "fetch", "origin")).rejects.toThrow(NO_SYNC);
    await expect(managers.versionControl.sync(id, "push", "origin")).rejects.toThrow(NO_SYNC);
  });

  it("reads Genbeya's content and the files it refers to, and leaves other code on GitHub", async () => {
    const fetch = github();
    const snapshot = await readForgeContent({ forge: "github", host: "github.com", owner: "acme", name: "rockets" }, { fetch });
    expect([...snapshot.files.keys()].sort()).toEqual([
      ".genbeya.yml",
      "README.md",
      "docs/Guide.md",
      "docs/Home.md",
      "docs/images/plan.png",
      "src/main.ts",
      "tasks/Launch/RKT-1.md",
    ]);
    expect(snapshot.unread).toBe(1);
    expect(fetch.requests.some((request) => request.url.endsWith("/src/other.ts"))).toBe(false);
  });

  it("finds the paths a Markdown file names", () => {
    const text = [
      "[[src/app.ts#L1-L9]] and ![[/lib/x.ts]] and [[Some page|text]] and [[RKT-1]]",
      '[guide](../Guide/Wiki.md#part) ![img](<images/a b.png> "title") [web](https://example.com) [here](#top) [mail](mailto:a@b.c)',
      "![encoded](images/caf%C3%A9.png?raw=1)",
    ].join("\n");
    expect([...referencedPaths("docs/Architecture/Home.md", text)]).toEqual([
      "src/app.ts",
      "lib/x.ts",
      "Some page",
      "RKT-1",
      "docs/Guide/Wiki.md",
      "docs/Architecture/images/a b.png",
      "docs/Architecture/images/café.png",
    ]);
  });
});
