import { TestBed } from "@angular/core/testing";
import type { Person } from "../../../contracts/model";
import { openRepository, settle } from "../testing/component-harness";
import { snapshot, task } from "../testing/fake-platform";
import { People } from "./people";

const ada: Person = { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: [], commits: 1 };
const bob: Person = { handle: "bob", name: "Bob", email: null, aliases: [], commits: 0 };

async function setup() {
  const harness = await openRepository();
  harness.managers.content.people.mockResolvedValue({ people: [ada], me: "ada" });
  const people = TestBed.inject(People);
  TestBed.tick();
  await settle();
  return { ...harness, people };
}

describe("People", () => {
  it("loads the repository's people and finds them by handle, name or email", async () => {
    const { people } = await setup();
    expect(people.list()).toEqual([ada]);
    expect(people.me()).toBe(ada);
    expect(people.find("@ada")).toBe(ada);
    expect(people.find("ada lovelace")).toBe(ada);
    expect(people.find("nobody")).toBeUndefined();
  });

  it("loads them again when commits, settings, assignees or comment authors change, not for other changes", async () => {
    const { people, managers, session } = await setup();
    expect(managers.content.people).toHaveBeenCalledTimes(1);
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2", changes: [{ path: "a", index: "?", worktree: "?" }] }));
    await session.refresh();
    TestBed.tick();
    await settle();
    expect(managers.content.people).toHaveBeenCalledTimes(1);
    managers.content.people.mockResolvedValue({ people: [ada, bob], me: "ada" });
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v3", tasks: [task("TP-1", { assignee: "bob" })] }));
    await session.refresh();
    TestBed.tick();
    await settle();
    expect(managers.content.people).toHaveBeenCalledTimes(2);
    expect(people.list()).toEqual([ada, bob]);
  });
});
