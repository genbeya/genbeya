import { TestBed } from "@angular/core/testing";
import type { CommitDetail, Snapshot } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { snapshot } from "../../testing/fake-platform";
import { CommitPane } from "./commit-pane";

const HASH = "f".repeat(40);
const DETAIL: CommitDetail = {
  commit: { hash: HASH, parents: [], author: "Ann", email: "ann@example.com", date: "2026-10-10T12:00:00Z", subject: "Fix", refs: [] },
  body: "",
  files: [{ path: "a.ts", status: "M" }],
};

describe("CommitPane", () => {
  it("loads the commit again only when its branches or tags may have changed", async () => {
    const { managers, session } = await openRepository();
    managers.versionControl.commitDetail.mockResolvedValue(DETAIL);
    const fixture = TestBed.createComponent(CommitPane);
    fixture.componentRef.setInput("hash", HASH);
    fixture.componentRef.setInput("file", "a.ts");
    await settle(fixture);
    const loads = () => managers.versionControl.commitDetail.mock.calls.length;
    expect(loads()).toBe(1);
    const refresh = async (change: Partial<Snapshot>) => {
      managers.workspace.snapshot.mockResolvedValue(snapshot(change));
      await session.refresh();
      await settle(fixture);
    };
    const head = snapshot().head;
    // A commit elsewhere moves HEAD, but not onto or off this commit.
    await refresh({ head: { ...head, commit: "1234567" } });
    expect(loads()).toBe(1);
    await refresh({ head: { ...head, commit: HASH.slice(0, 7) } });
    expect(loads()).toBe(2);
    await refresh({ head: { ...head, commit: HASH.slice(0, 7) }, tags: ["v1"] });
    expect(loads()).toBe(3);
  });
});
