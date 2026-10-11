import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository, type TestRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { fileHistory } from "./file-history";
import { Git } from "./git";

const host = new LocalHost(nodeMachine());
const gitOf = (repository: TestRepository) => new Git(host, host.paths.normalize(repository.root));

async function commit(repository: TestRepository, path: string, content: string | null, message: string) {
  if (content === null) await repository.git("rm", "-q", path);
  else {
    await repository.write(path, content);
    await repository.git("add", path);
  }
  await repository.git("commit", "-q", "-m", message);
}

describe("fileHistory", () => {
  it("ends where the file was added, leaving out an earlier file at the same path", async () => {
    // Task IDs are reused once the task with the highest ID is deleted.
    const repository = await createRepository({ "tasks/TP-1.md": "old task\n" });
    await commit(repository, "tasks/TP-1.md", "old task, edited\n", "Edit the old task");
    await commit(repository, "tasks/TP-1.md", null, "Delete the old task");
    await commit(repository, "tasks/TP-1.md", "new task\n", "Create the new task");
    await commit(repository, "tasks/TP-1.md", "new task, edited\n", "Edit the new task");
    for (const contents of [true, false]) {
      const revisions = await fileHistory(gitOf(repository), "tasks/TP-1.md", 100, contents);
      expect(revisions.map((revision) => [revision.subject, revision.oldPath])).toEqual([
        ["Edit the new task", "tasks/TP-1.md"],
        ["Create the new task", null],
      ]);
    }
  });

  it("lists versions too large to show without their contents", async () => {
    const repository = await createRepository({ "tasks/TP-1.md": "small\n" });
    // Two patches holding this whole are more than a local git's output may be.
    await commit(repository, "tasks/TP-1.md", "large line\n".repeat(4 * 1024 * 1024), "Grow");
    await commit(repository, "tasks/TP-1.md", "small again\n", "Shrink");
    const revisions = await fileHistory(gitOf(repository), "tasks/TP-1.md", 100, true);
    expect(revisions.map(({ subject, before, after }) => [subject, before, after])).toEqual([
      ["Shrink", null, null],
      ["Grow", null, null],
      ["Initial commit", null, "small\n"],
    ]);
  });
});
