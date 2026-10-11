import { TestBed } from "@angular/core/testing";
import type { Commit, RebaseCommit, RebaseStep } from "../../../../contracts/model";
import { openRepository } from "../../testing/component-harness";
import { OperationActions } from "./operation-actions";

const commit = (hash: string): RebaseCommit => ({
  hash,
  subject: hash,
  message: hash,
  author: "Ann",
  date: "2026-01-01T00:00:00Z",
  merge: false,
});
const BASE = { hash: "f".repeat(40) } as Commit;

describe("OperationActions", () => {
  it("asks before an interactive rebase that drops every commit", async () => {
    const { managers, dialogs } = await openRepository();
    managers.versionControl.rebasePlan.mockResolvedValue({ base: BASE.hash, commits: [commit("a"), commit("b")], pushed: [] });
    const drops: RebaseStep[] = [
      { hash: "a", action: "drop" },
      { hash: "b", action: "drop" },
    ];
    dialogs.open.mockResolvedValue(drops);
    dialogs.confirm.mockResolvedValueOnce(false);
    const actions = TestBed.inject(OperationActions);
    await actions.rebaseInteractive(BASE);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Drop every commit", danger: true }));
    expect(managers.versionControl.rebaseInteractive).not.toHaveBeenCalled();

    dialogs.open.mockResolvedValue([{ hash: "a", action: "pick" }, drops[1]]);
    await actions.rebaseInteractive(BASE);
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(managers.versionControl.rebaseInteractive).toHaveBeenCalled();
  });
});
