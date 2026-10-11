import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { createRepository, type TestRepository } from "../../testing/repository";
import { LocalHost } from "../hosts/local-host";
import { commitAuthors, commitIdentity } from "./authors";
import { Git } from "./git";

const host = new LocalHost(nodeMachine());
const gitOf = (repository: TestRepository) => new Git(host, host.paths.normalize(repository.root));

async function commitAs(repository: TestRepository, author: string, file: string) {
  await repository.write(file, file);
  await repository.git("add", file);
  await repository.git("commit", "-q", "-m", `Add ${file}`, `--author=${author}`);
}

describe("commitAuthors", () => {
  it("counts the commits of each author, with .mailmap applied", async () => {
    const repository = await createRepository({ "a.txt": "a" });
    await commitAs(repository, "Ada <ada@old.example>", "b.txt");
    await commitAs(repository, "Ada Lovelace <ada@example.com>", "c.txt");
    await commitAs(repository, "Bob <bob@example.com>", "d.txt");
    await repository.write(".mailmap", "Ada Lovelace <ada@example.com> Ada <ada@old.example>\n");
    const authors = await commitAuthors(gitOf(repository), 100);
    expect(authors).toEqual(
      expect.arrayContaining([
        { name: "Ada Lovelace", email: "ada@example.com", commits: 2 },
        { name: "Bob", email: "bob@example.com", commits: 1 },
        { name: "Test", email: "test@example.com", commits: 1 },
      ]),
    );
    expect(authors).toHaveLength(3);
  });

  it("reads only the newest commits, and nothing on an unborn branch", async () => {
    const repository = await createRepository({ "a.txt": "a" });
    await commitAs(repository, "Bob <bob@example.com>", "b.txt");
    expect(await commitAuthors(gitOf(repository), 1)).toEqual([{ name: "Bob", email: "bob@example.com", commits: 1 }]);
    expect(await commitAuthors(gitOf(await createRepository({}, false)), 10)).toEqual([]);
  });
});

describe("commitIdentity", () => {
  it("is the name and email Git signs commits with", async () => {
    const repository = await createRepository({});
    expect(await commitIdentity(gitOf(repository))).toEqual({ name: "Test", email: "test@example.com" });
  });
});
