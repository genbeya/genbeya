import { TestBed } from "@angular/core/testing";
import { fakeManagers, fakeShell, providePlatform } from "../testing/fake-platform";
import { Notifications } from "./notifications";
import { Repositories } from "./repositories";

const entry = (name: string) => ({ name, location: { kind: "local" as const, path: `/${name}` }, openedAt: 1 });

function setup() {
  const managers = fakeManagers();
  managers.workspace.recent.mockResolvedValue([entry("a"), entry("b")]);
  TestBed.configureTestingModule({ providers: providePlatform(managers, fakeShell()) });
  return { managers, repositories: TestBed.inject(Repositories) };
}

describe("Repositories", () => {
  it("lists recent repositories and forgets one", async () => {
    const { managers, repositories } = setup();
    TestBed.tick();
    await vi.waitFor(() => expect(repositories.recent().map((e) => e.name)).toEqual(["a", "b"]));
    managers.workspace.recent.mockResolvedValue([entry("b")]);
    await repositories.forget(entry("a").location);
    expect(managers.workspace.forget).toHaveBeenCalledWith({ kind: "local", path: "/a" });
    expect(repositories.recent().map((e) => e.name)).toEqual(["b"]);
  });

  it("reports failures instead of leaving them unhandled", async () => {
    const { managers, repositories } = setup();
    managers.workspace.forget.mockRejectedValue(new Error("Disk full."));
    managers.workspace.distributions.mockRejectedValue(new Error("No WSL."));
    await repositories.forget(entry("a").location);
    expect(TestBed.inject(Notifications).visible()[0]?.message).toBe("Disk full.");
    expect(await repositories.distributions()).toEqual([]);
  });
});
