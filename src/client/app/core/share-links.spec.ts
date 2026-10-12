import { TestBed } from "@angular/core/testing";
import type { Head, Remote, Snapshot } from "../../../contracts/model";
import { openRepository } from "../testing/component-harness";
import { contentBranch, task } from "../testing/fake-platform";
import { Notifications } from "./notifications";
import { ShareLinks } from "./share-links";

const origin: Remote = { name: "origin", url: "https://github.com/acme/demo.git" };
const head = (change: Partial<Head>): Head => ({ branch: "main", commit: "abc1234", upstream: null, ahead: 0, behind: 0, ...change });
const hash = "0123456789abcdef0123456789abcdef01234567";

async function share(change: Partial<Snapshot>) {
  await openRepository({ tasks: [task("TP-1", { path: "tasks/Auth/TP-1.md" })], ...change });
  return TestBed.inject(ShareLinks);
}

describe("ShareLinks", () => {
  it("names the repository by origin, else by the first remote", async () => {
    const upstream = { name: "upstream", url: "git@github.com:other/demo.git" };
    expect((await share({ remotes: [upstream, origin] })).genbeyaLink({ kind: "task", id: "TP-1" })).toBe(
      "genbeya://open?remote=https://github.com/acme/demo.git&task=TP-1",
    );
    TestBed.resetTestingModule();
    expect((await share({ remotes: [upstream] })).genbeyaLink({ kind: "page", path: "docs/Home.md" })).toBe(
      "genbeya://open?remote=git@github.com:other/demo.git&page=docs/Home.md",
    );
  });

  it("explains why a repository without a reachable remote can't be shared", async () => {
    const local = await share({ remotes: [] });
    expect(local.unavailable()).toMatch(/no remote/);
    expect(local.genbeyaLink({ kind: "task", id: "TP-1" })).toBeNull();
    expect(local.webLink({ kind: "task", id: "TP-1" })).toBeNull();
    TestBed.resetTestingModule();
    const bare = await share({ remotes: [{ name: "origin", url: "/srv/git/demo.git" }] });
    expect(bare.unavailable()).toMatch(/local path/);
  });

  it.each<[string, Partial<Snapshot>, string | null]>([
    ["the current branch", {}, "https://github.com/acme/demo/blob/main/tasks/Auth/TP-1.md"],
    [
      "the upstream's name",
      { head: head({ branch: "work", upstream: "origin/feature/login" }) },
      "https://github.com/acme/demo/blob/feature/login/tasks/Auth/TP-1.md",
    ],
    ["the commit when detached", { head: head({ branch: null }) }, "https://github.com/acme/demo/blob/abc1234/tasks/Auth/TP-1.md"],
    [
      "the content branch",
      { storage: contentBranch(["tasks"]), head: head({ upstream: "origin/main" }) },
      "https://github.com/acme/demo/blob/genbeya/tasks/Auth/TP-1.md",
    ],
    [
      "the code branch while only the wiki is on the content branch",
      { storage: contentBranch(["wiki"]) },
      "https://github.com/acme/demo/blob/main/tasks/Auth/TP-1.md",
    ],
  ])("links a task's file on %s", async (_, change, url) => {
    expect((await share({ remotes: [origin], ...change })).webLink({ kind: "task", id: "TP-1" })).toBe(url);
  });

  it("links files on the code branch even when wiki and tasks live elsewhere, and commits by hash", async () => {
    const links = await share({ remotes: [origin], storage: contentBranch(["wiki", "tasks", "settings"]) });
    expect(links.webLink({ kind: "file", path: "docs/Home.md" })).toBe("https://github.com/acme/demo/blob/main/docs/Home.md");
    expect(links.webLink({ kind: "page", path: "docs/Home.md" })).toBe("https://github.com/acme/demo/blob/genbeya/docs/Home.md");
    expect(links.webLink({ kind: "commit", hash })).toBe(`https://github.com/acme/demo/commit/${hash}`);
    expect(links.webLink({ kind: "task", id: "TP-404" })).toBeNull();
  });

  it("has no web link for hosts it does not know", async () => {
    const links = await share({ remotes: [{ name: "origin", url: "git@git.example.org:acme/demo.git" }] });
    expect(links.webLink({ kind: "commit", hash })).toBeNull();
    expect(links.genbeyaLink({ kind: "commit", hash })).not.toBeNull();
  });

  it("copies links and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const links = await share({ remotes: [origin] });
    await links.copyGenbeyaLink({ kind: "task", id: "TP-1" });
    await links.copyWebLink({ kind: "task", id: "TP-1" });
    expect(writeText.mock.calls).toEqual([
      ["genbeya://open?remote=https://github.com/acme/demo.git&task=TP-1"],
      ["https://github.com/acme/demo/blob/main/tasks/Auth/TP-1.md"],
    ]);
    expect(
      TestBed.inject(Notifications)
        .visible()
        .map((n) => n.message),
    ).toEqual(["Genbeya link copied", "Web link copied"]);
  });
});
