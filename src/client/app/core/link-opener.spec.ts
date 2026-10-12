import { TestBed } from "@angular/core/testing";
import type { GenbeyaLink } from "../../../contracts/genbeya-link";
import type { Location, RecentEntry, Snapshot } from "../../../contracts/model";
import { openRepository } from "../testing/component-harness";
import { snapshot } from "../testing/fake-platform";
import { LinkOpener } from "./link-opener";
import { UnsavedChanges } from "./unsaved-changes";

const demo = "https://github.com/acme/demo.git";
const other: Location = { kind: "local", path: "/other" };
const recent = (location: Location, remotes: string[]): RecentEntry => ({ location, name: "Other", openedAt: 1, remotes });

async function setup(change: Partial<Snapshot>, entries: RecentEntry[] = []) {
  const harness = await openRepository(change);
  harness.managers.workspace.recent.mockResolvedValue(entries);
  harness.managers.workspace.open.mockResolvedValue({
    id: "w2",
    snapshot: snapshot({ location: other, remotes: [{ name: "origin", url: demo }] }),
  });
  const navigate = vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  return { ...harness, navigate, opener: TestBed.inject(LinkOpener) };
}

describe("LinkOpener", () => {
  it.each<[GenbeyaLink["item"], string, Record<string, string>]>([
    [{ kind: "page", path: "docs/Guide.md" }, "/wiki", { page: "docs/Guide.md" }],
    [{ kind: "task", id: "TP-1" }, "/tasks", { task: "TP-1" }],
    [{ kind: "file", path: "src/index.ts" }, "/code", { file: "src/index.ts" }],
    [
      { kind: "commit", hash: "0123456789abcdef0123456789abcdef01234567" },
      "/history",
      { commit: "0123456789abcdef0123456789abcdef01234567" },
    ],
  ])("shows %j in the open repository when it has the link's remote in any form", async (item, view, queryParams) => {
    const { opener, navigate, managers } = await setup({ remotes: [{ name: "origin", url: "git@github.com:acme/demo.git" }] });
    expect(await opener.open({ remote: demo, item })).toBe(true);
    expect(navigate).toHaveBeenCalledWith([view], { queryParams });
    expect(managers.workspace.open).toHaveBeenCalledTimes(1);
  });

  it("opens a recent repository that had the remote, then shows the item", async () => {
    const { opener, navigate, managers, session } = await setup({ remotes: [] }, [
      recent({ kind: "local", path: "/unrelated" }, ["https://github.com/acme/unrelated.git"]),
      recent(other, ["https://user@github.com/acme/demo"]),
    ]);
    expect(await opener.open({ remote: demo, item: { kind: "task", id: "TP-1" } })).toBe(true);
    expect(managers.workspace.open).toHaveBeenLastCalledWith(other);
    expect(session.snapshot()?.location).toEqual(other);
    expect(navigate).toHaveBeenCalledWith(["/tasks"], { queryParams: { task: "TP-1" } });
  });

  it("stays put when the user keeps unsaved edits", async () => {
    const { opener, navigate, dialogs } = await setup({ remotes: [] }, [recent(other, [demo])]);
    TestBed.inject(UnsavedChanges).mark({}, true);
    dialogs.confirm.mockResolvedValue(false);
    expect(await opener.open({ remote: demo, item: { kind: "task", id: "TP-1" } })).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reports when no repository Genbeya knows has the remote", async () => {
    const { opener, navigate } = await setup({ remotes: [{ name: "origin", url: "https://github.com/acme/else.git" }] }, [
      recent(other, ["https://gitlab.com/acme/demo.git"]),
    ]);
    expect(await opener.open({ remote: demo, item: { kind: "task", id: "TP-1" } })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
