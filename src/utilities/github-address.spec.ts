import { describe, expect, it } from "vitest";
import { gitHubAddressPath, isBranchName, parseGitHubAddress } from "./github-address";

describe("GitHub addresses on genbeya.fyi", () => {
  it("reads the repository and branch from the path, as GitHub spells them", () => {
    expect(parseGitHubAddress("/github/genbeya/genbeya")).toEqual({ owner: "genbeya", name: "genbeya" });
    expect(parseGitHubAddress("/github/genbeya/genbeya/")).toEqual({ owner: "genbeya", name: "genbeya" });
    expect(parseGitHubAddress("/github/genbeya/genbeya.git")).toEqual({ owner: "genbeya", name: "genbeya" });
    expect(parseGitHubAddress("/github/acme/my.repo/tree/feature/GENBEYA-39-x")).toEqual({
      owner: "acme",
      name: "my.repo",
      branch: "feature/GENBEYA-39-x",
    });
    expect(parseGitHubAddress("/github/acme/rockets/tree/caf%C3%A9")).toEqual({ owner: "acme", name: "rockets", branch: "café" });
  });

  it("reads them from the query wherever the page is served", () => {
    expect(parseGitHubAddress("/", "?repo=acme/rockets")).toEqual({ owner: "acme", name: "rockets" });
    expect(parseGitHubAddress("/index.html", "?repo=acme%2Frockets&branch=dev")).toEqual({ owner: "acme", name: "rockets", branch: "dev" });
  });

  it("names nothing for other addresses and names GitHub doesn't allow", () => {
    for (const [path, search] of [
      ["/", ""],
      ["/github/acme", ""],
      ["/github/-acme/rockets", ""],
      ["/github/acme/../tree/x", ""],
      ["/github/acme/rockets/tree/a..b", ""],
      ["/github/ac%ZZme/rockets", ""],
      ["/", "?repo=acme"],
      ["/", "?repo=acme/rockets/extra"],
      ["/", "?repo=acme/rockets&branch=-x"],
    ] as const)
      expect(parseGitHubAddress(path, search), `${path}${search}`).toBeNull();
  });

  it("writes the path that opens a repository", () => {
    expect(gitHubAddressPath({ owner: "acme", name: "rockets" })).toBe("/github/acme/rockets");
    expect(gitHubAddressPath({ owner: "acme", name: "rockets", branch: "feature/café" })).toBe(
      "/github/acme/rockets/tree/feature/caf%C3%A9",
    );
    expect(parseGitHubAddress(gitHubAddressPath({ owner: "acme", name: "rockets", branch: "feature/café" }))).toEqual({
      owner: "acme",
      name: "rockets",
      branch: "feature/café",
    });
  });

  it("knows Git's rules for branch names", () => {
    for (const name of ["main", "feature/x", "GENBEYA-39", "v1.2"]) expect(isBranchName(name), name).toBe(true);
    for (const name of ["", "a b", "a..b", "/a", "a/", "a.lock", "a//b", "-a", "a/.b", "@", "a@{1}", "a~1", "a^", "a:b"])
      expect(isBranchName(name), name).toBe(false);
  });
});
