import { describe, expect, it } from "vitest";
import { memoryFiles } from "../../access/browser/kept-files";
import { fakeGitHub } from "../../testing/fake-github";
import { openGitHubBackend } from "./github-backend";
import { GitHubKeeper, keptName } from "./github-keeping";

const github = () =>
  fakeGitHub([
    {
      owner: "Acme",
      name: "Rockets",
      defaultBranch: "main",
      branches: {
        main: {
          files: {
            ".genbeya.yml": "name: Rockets\ntaskPrefix: RKT\n",
            "docs/Home.md": "# Rockets\n",
            "tasks/RKT-1.md": "---\nid: RKT-1\ntitle: Launch\nstatus: todo\n---\n",
          },
        },
      },
    },
  ]);

const clock = () => {
  let minutes = 0;
  return () => new Date(Date.UTC(2026, 10, 9, 10, minutes++));
};

describe("keeping repositories from GitHub in the browser", () => {
  it("keeps a repository with its changes, and opens it again without asking GitHub", async () => {
    const files = memoryFiles();
    const keeper = new GitHubKeeper(files, clock());
    const fetch = github();
    const backend = await openGitHubBackend({ owner: "acme", name: "rockets" }, { fetch });
    const { id } = (await backend.managers.workspace.restore([]))!;
    expect(await keeper.save(backend)).toBe(true);
    expect(await keeper.save(backend)).toBe(false);

    const page = await backend.managers.content.read(id, "content", "docs/Home.md");
    await backend.managers.content.write(id, "content", "docs/Home.md", "# Rockets\n\nKept.\n", page.hash);
    await backend.managers.versionControl.stage(id, ["docs/Home.md"]);
    await backend.managers.versionControl.commit(id, "Keep it", false);
    expect(await keeper.save(backend)).toBe(true);
    expect(await files.list()).toEqual([`${keptName(backend.summary)}.state.json`, `${keptName(backend.summary)}.summary.json`]);

    const requests = fetch.requests.length;
    const kept = await keeper.find({ owner: "ACME", name: "rockets" });
    expect(kept).toMatchObject({ owner: "Acme", name: "Rockets", branch: "main", savedAt: "2026-11-09T10:01:00.000Z" });
    const reopened = await keeper.open(kept!);
    const opened = (await reopened.managers.workspace.restore([]))!;
    expect((await reopened.managers.content.read(opened.id, "content", "docs/Home.md")).content).toBe("# Rockets\n\nKept.\n");
    expect((await reopened.managers.versionControl.log(opened.id, 0, 5)).map((commit) => commit.subject)).toEqual(["Keep it", "Latest"]);
    expect(opened.snapshot.head).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1 });
    expect(fetch.requests.length).toBe(requests);
    // Opening saved nothing new.
    expect(await keeper.save(reopened)).toBe(false);
  });

  it("finds a branch's copy, and the default branch's for an address without one", async () => {
    const keeper = new GitHubKeeper(memoryFiles(), clock());
    await keeper.save(await openGitHubBackend({ owner: "acme", name: "rockets" }, { fetch: github() }));
    expect(await keeper.find({ owner: "acme", name: "rockets", branch: "main" })).not.toBeNull();
    expect(await keeper.find({ owner: "acme", name: "rockets", branch: "other" })).toBeNull();
    expect(await keeper.find({ owner: "acme", name: "boosters" })).toBeNull();
  });

  it("deletes a kept repository, or everything kept, damaged files included", async () => {
    const files = memoryFiles();
    const keeper = new GitHubKeeper(files, clock());
    const backend = await openGitHubBackend({ owner: "acme", name: "rockets" }, { fetch: github() });
    await keeper.save(backend);
    await keeper.remove(backend.summary);
    expect(await files.list()).toEqual([]);
    expect(await keeper.save(backend)).toBe(true);

    await files.write("broken.summary.json", "{");
    expect((await keeper.list()).map((kept) => kept.name)).toEqual(["Rockets"]);
    await keeper.removeAll();
    expect(await files.list()).toEqual([]);
  });

  it("says when a kept repository is gone", async () => {
    const files = memoryFiles();
    const keeper = new GitHubKeeper(files, clock());
    const backend = await openGitHubBackend({ owner: "acme", name: "rockets" }, { fetch: github() });
    await keeper.save(backend);
    const [kept] = await keeper.list();
    await files.remove(`${keptName(backend.summary)}.state.json`);
    await expect(keeper.open(kept!)).rejects.toThrow("This kept repository is gone");
  });

  it("names kept files with nothing a folder could misread", () => {
    expect(keptName({ owner: "Acme", name: "my.repo", branch: "feature/x(1)~" })).toBe("github.com_acme_my.repo_feature%2Fx%281%29%7E");
  });
});
