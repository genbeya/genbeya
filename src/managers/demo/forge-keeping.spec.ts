import { describe, expect, it } from "vitest";
import { memoryFiles } from "../../access/browser/kept-files";
import { fakeForges, fakeGitHub } from "../../testing/fake-forges";
import { openForgeBackend } from "./forge-backend";
import { ForgeKeeper, keptName } from "./forge-keeping";

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
    const keeper = new ForgeKeeper(files, clock());
    const fetch = github();
    const backend = await openForgeBackend({ forge: "github", host: "github.com", owner: "acme", name: "rockets" }, { fetch });
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
    const kept = await keeper.find({ forge: "github", host: "github.com", owner: "ACME", name: "rockets" });
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
    const keeper = new ForgeKeeper(memoryFiles(), clock());
    await keeper.save(await openForgeBackend({ forge: "github", host: "github.com", owner: "acme", name: "rockets" }, { fetch: github() }));
    expect(await keeper.find({ forge: "github", host: "github.com", owner: "acme", name: "rockets", branch: "main" })).not.toBeNull();
    expect(await keeper.find({ forge: "github", host: "github.com", owner: "acme", name: "rockets", branch: "other" })).toBeNull();
    expect(await keeper.find({ forge: "github", host: "github.com", owner: "acme", name: "boosters" })).toBeNull();
  });

  it("deletes a kept repository, or everything kept, damaged files included", async () => {
    const files = memoryFiles();
    const keeper = new ForgeKeeper(files, clock());
    const backend = await openForgeBackend({ forge: "github", host: "github.com", owner: "acme", name: "rockets" }, { fetch: github() });
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
    const keeper = new ForgeKeeper(files, clock());
    const backend = await openForgeBackend({ forge: "github", host: "github.com", owner: "acme", name: "rockets" }, { fetch: github() });
    await keeper.save(backend);
    const [kept] = await keeper.list();
    await files.remove(`${keptName(backend.summary)}.state.json`);
    await expect(keeper.open(kept!)).rejects.toThrow("This kept repository is gone");
  });

  it("names kept files with nothing a folder could misread", () => {
    expect(keptName({ forge: "github", host: "github.com", owner: "Acme", name: "my.repo", branch: "feature/x(1)~" })).toBe(
      "github_github.com_acme_my.repo_feature%2Fx%281%29%7E",
    );
    const long = keptName({ forge: "gitlab", host: "gitlab.example.com", owner: "a/".repeat(100) + "b", name: "c", branch: "main" });
    expect(long).toMatch(/^[\w.%-]{1,240}$/);
    expect(long).not.toBe(
      keptName({ forge: "gitlab", host: "gitlab.example.com", owner: "a/".repeat(100) + "c", name: "c", branch: "main" }),
    );
  });

  it("keeps the same repository from different forges and servers apart", async () => {
    const files = { "docs/Home.md": "# Rockets\n" };
    const fetch = fakeForges([
      { forge: "gitlab", owner: "acme/space", name: "rockets", branches: { main: { files } } },
      { forge: "gitlab", host: "gitlab.example.com", owner: "acme/space", name: "rockets", branches: { main: { files } } },
      { forge: "gitea", host: "git.example.com", owner: "acme", name: "rockets", branches: { main: { files } } },
    ]);
    const keeper = new ForgeKeeper(memoryFiles(), clock());
    const addresses = [
      { forge: "gitlab", host: "gitlab.com", owner: "acme/space", name: "rockets" },
      { forge: "gitlab", host: "gitlab.example.com", owner: "acme/space", name: "rockets" },
      { forge: "gitea", host: "git.example.com", owner: "acme", name: "rockets" },
    ] as const;
    for (const address of addresses) await keeper.save(await openForgeBackend(address, { fetch }));
    expect((await keeper.list()).map((kept) => `${kept.forge} ${kept.host} ${kept.owner}`).sort()).toEqual([
      "gitea git.example.com acme",
      "gitlab gitlab.com acme/space",
      "gitlab gitlab.example.com acme/space",
    ]);
    for (const address of addresses) expect(await keeper.find(address)).toMatchObject({ forge: address.forge, host: address.host });
    expect(await keeper.find({ forge: "forgejo", host: "git.example.com", owner: "acme", name: "rockets" })).toBeNull();
  });
});
