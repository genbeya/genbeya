import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory-repository";
import { loadRepository, saveRepository } from "./repository-state";

const options = { identity: { name: "Ada", email: "ada@example.com" }, now: () => new Date("2026-11-09T10:00:00Z") };

/** Everything the app reads from a repository, to compare a copy with its original. */
const observe = (repository: MemoryRepository) => ({
  head: repository.headState(),
  status: repository.status(),
  log: repository.log(0, 50),
  branches: [...repository.branches],
  tags: [...repository.tags],
  tracking: [...repository.tracking],
  upstreams: [...repository.upstreams],
  remotes: repository.sync.list(),
  stashes: repository.stashes.list(),
  operation: repository.operations.current(),
  conflicts: [...repository.conflicts],
  worktree: [...repository.worktree],
});

/** A repository with something of everything, stopped in a conflicted merge. */
function busyRepository() {
  const repository = new MemoryRepository(options);
  repository.write("README.md", "one\n");
  repository.write("logo.png", "\0binary\0\x89PNG");
  repository.add(["README.md", "logo.png"]);
  repository.commit("First", false);
  repository.createTag("v1", repository.headCommit()!, "The first");
  repository.sync.set("origin", "https://github.com/acme/rockets.git");
  repository.sync.push({ branch: "main", remote: "origin", remoteBranch: "main", setUpstream: true });
  repository.createBranch("feature", repository.headCommit()!);
  repository.switchTo({ branch: "feature" });
  repository.write("README.md", "feature\n");
  repository.add(["README.md"]);
  repository.commit("Feature", false);
  repository.switchTo({ branch: "main" });
  repository.write("README.md", "main\n");
  repository.add(["README.md"]);
  repository.commit("Main", false);
  repository.write("notes.txt", "stash me\n");
  repository.add(["notes.txt"]);
  repository.stashes.push("Notes", { includeUntracked: false, keepIndex: false });
  repository.write("draft.md", "untracked\n");
  repository.operations.merge("feature", repository.resolve("feature"), { noFastForward: false, message: "Merge branch 'feature'" });
  return repository;
}

describe("keeping an in-memory repository", () => {
  it("restores everything the app shows, a merge in progress included", () => {
    const repository = busyRepository();
    expect(repository.conflicts.size).toBe(1);
    const copy = loadRepository(JSON.parse(JSON.stringify(saveRepository(repository))), options);
    expect(observe(copy)).toEqual(observe(repository));

    // The copy goes on as the original would.
    copy.write("README.md", "both\n");
    copy.add(["README.md"]);
    copy.operations.continue();
    expect(copy.operations.current()).toBeNull();
    expect(copy.log(0, 1)[0]!.parents).toHaveLength(2);
  });

  it("keeps each content once, however many commits hold it", () => {
    const repository = new MemoryRepository(options);
    repository.write("big.txt", "x".repeat(10_000));
    repository.add(["big.txt"]);
    repository.commit("One", false);
    for (const n of [2, 3, 4]) {
      repository.write(`small-${n}.txt`, String(n));
      repository.add([`small-${n}.txt`]);
      repository.commit(`Commit ${n}`, false);
    }
    // Four commits, the index and the working tree all hold big.txt: kept four times or more, it would take 60 000 characters.
    expect(JSON.stringify(saveRepository(repository)).length).toBeLessThan(20_000);
  });

  it("refuses state it can't read", () => {
    const state = saveRepository(busyRepository());
    expect(() => loadRepository({ ...state, version: 2 } as never, options)).toThrow("saved by another version of Genbeya");
    expect(() => loadRepository({ ...state, blobs: {} }, options)).toThrow("damaged");
  });
});
