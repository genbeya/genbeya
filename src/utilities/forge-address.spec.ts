import { describe, expect, it } from "vitest";
import { forgeAddressPath, forgeWebUrl, isBranchName, isHostName, isSelfHosted, parseForgeAddress } from "./forge-address";

describe("forge addresses on genbeya.fyi", () => {
  it("reads repositories and branches as each forge spells them", () => {
    expect(parseForgeAddress("/github/genbeya/genbeya")).toEqual({
      forge: "github",
      host: "github.com",
      owner: "genbeya",
      name: "genbeya",
    });
    expect(parseForgeAddress("/github/genbeya/genbeya.git/")).toEqual({
      forge: "github",
      host: "github.com",
      owner: "genbeya",
      name: "genbeya",
    });
    expect(parseForgeAddress("/github/acme/rockets/tree/feature/x")).toMatchObject({ branch: "feature/x" });
    expect(parseForgeAddress("/gitlab/gitlab-org/project-templates/express")).toEqual({
      forge: "gitlab",
      host: "gitlab.com",
      owner: "gitlab-org/project-templates",
      name: "express",
    });
    expect(parseForgeAddress("/gitlab/acme/rockets/-/tree/feature/x")).toMatchObject({
      owner: "acme",
      name: "rockets",
      branch: "feature/x",
    });
    expect(parseForgeAddress("/bitbucket/atlassian/atlassian-connect-express/src/master")).toEqual({
      forge: "bitbucket",
      host: "bitbucket.org",
      owner: "atlassian",
      name: "atlassian-connect-express",
      branch: "master",
    });
    expect(parseForgeAddress("/codeberg/Codeberg/Documentation/src/branch/main")).toEqual({
      forge: "codeberg",
      host: "codeberg.org",
      owner: "Codeberg",
      name: "Documentation",
      branch: "main",
    });
    expect(parseForgeAddress("/codeberg/acme/rockets/tree/caf%C3%A9")).toMatchObject({ branch: "café" });
  });

  it("names servers of their own with ?host=, for the forges that run on them", () => {
    expect(parseForgeAddress("/gitea/acme/rockets", "?host=git.example.com")).toEqual({
      forge: "gitea",
      host: "git.example.com",
      owner: "acme",
      name: "rockets",
    });
    expect(parseForgeAddress("/forgejo/acme/rockets", "?host=Code.Example.org:3000")).toMatchObject({
      forge: "forgejo",
      host: "code.example.org:3000",
    });
    expect(parseForgeAddress("/gitlab/acme/rockets", "?host=gitlab.example.com")).toMatchObject({ host: "gitlab.example.com" });
    // Gitea and Forgejo have no website of their own to default to; GitHub, Bitbucket and Codeberg run nowhere else.
    expect(parseForgeAddress("/gitea/acme/rockets")).toBeNull();
    expect(parseForgeAddress("/github/acme/rockets", "?host=evil.example.com")).toBeNull();
    expect(parseForgeAddress("/codeberg/acme/rockets", "?host=evil.example.com")).toBeNull();
  });

  it("refuses hosts that aren't plain host names", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "user@git.example.com",
      "git.example.com/path",
      "git.example.com:99999",
      "-git.example.com",
      "git..example.com",
      "",
    ])
      expect(isHostName(host), host).toBe(false);
    for (const host of ["git.example.com", "gitlab.example.co.uk:8443", "xn--bcher-kva.example"]) expect(isHostName(host), host).toBe(true);
  });

  it("reads them from the query wherever the page is served", () => {
    expect(parseForgeAddress("/", "?repo=acme/rockets")).toEqual({ forge: "github", host: "github.com", owner: "acme", name: "rockets" });
    expect(parseForgeAddress("/index.html", "?forge=gitlab&repo=a/b/c&branch=dev")).toEqual({
      forge: "gitlab",
      host: "gitlab.com",
      owner: "a/b",
      name: "c",
      branch: "dev",
    });
    expect(parseForgeAddress("/", "?forge=gitea&repo=a/b&host=git.example.com")).toMatchObject({ forge: "gitea", host: "git.example.com" });
  });

  it("names nothing for other addresses and names a forge doesn't allow", () => {
    for (const [path, search] of [
      ["/", ""],
      ["/github/acme", ""],
      ["/github/-acme/rockets", ""],
      ["/github/acme/../tree/x", ""],
      ["/github/acme/rockets/tree/a..b", ""],
      ["/github/acme/rockets/pulls", ""],
      ["/github/a/b/c", ""],
      ["/github/ac%ZZme/rockets", ""],
      ["/bitbucket/acme/rockets/src/", ""],
      ["/gitlab/acme/rockets.git/sub", ""],
      ["/gitlab/acme", ""],
      ["/", "?repo=acme"],
      ["/", "?forge=svn&repo=acme/rockets"],
      ["/", "?repo=acme/rockets&branch=-x"],
    ] as const)
      expect(parseForgeAddress(path, search), `${path}${search}`).toBeNull();
  });

  it("writes the path that opens a repository, and its page on the forge", () => {
    const addresses = [
      { forge: "github", host: "github.com", owner: "acme", name: "rockets", branch: "feature/café" },
      { forge: "gitlab", host: "gitlab.com", owner: "acme/space", name: "rockets", branch: "main" },
      { forge: "gitea", host: "git.example.com", owner: "acme", name: "rockets" },
      { forge: "bitbucket", host: "bitbucket.org", owner: "acme", name: "rockets", branch: "dev" },
    ] as const;
    expect(addresses.map(forgeAddressPath)).toEqual([
      "/github/acme/rockets/tree/feature/caf%C3%A9",
      "/gitlab/acme/space/rockets/-/tree/main",
      "/gitea/acme/rockets?host=git.example.com",
      "/bitbucket/acme/rockets/tree/dev",
    ]);
    for (const address of addresses) {
      const [path, search = ""] = forgeAddressPath(address).split("?");
      expect(parseForgeAddress(path!, search && `?${search}`)).toEqual(address);
    }
    expect(addresses.map(forgeWebUrl)).toEqual([
      "https://github.com/acme/rockets/tree/feature/caf%C3%A9",
      "https://gitlab.com/acme/space/rockets/-/tree/main",
      "https://git.example.com/acme/rockets",
      "https://bitbucket.org/acme/rockets/src/dev",
    ]);
    expect(isSelfHosted(addresses[2])).toBe(true);
    expect(isSelfHosted(addresses[1])).toBe(false);
  });

  it("knows Git's rules for branch names", () => {
    for (const name of ["main", "feature/x", "GENBEYA-39", "v1.2"]) expect(isBranchName(name), name).toBe(true);
    for (const name of ["", "a b", "a..b", "/a", "a/", "a.lock", "a//b", "-a", "a/.b", "@", "a@{1}", "a~1", "a^", "a:b"])
      expect(isBranchName(name), name).toBe(false);
  });
});
