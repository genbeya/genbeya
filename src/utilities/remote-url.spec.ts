import { describe, expect, it } from "vitest";
import { namesRemoteHelper, parseRemote, sameRepository, webUrl, withoutCredentials } from "./remote-url";

describe("parseRemote", () => {
  it.each([
    ["https://github.com/acme/demo.git", "github.com", "acme/demo"],
    ["https://github.com/acme/demo", "github.com", "acme/demo"],
    ["https://github.com/acme/demo/", "github.com", "acme/demo"],
    ["https://github.com/acme/demo.git/", "github.com", "acme/demo"],
    ["HTTPS://GitHub.COM/Acme/Demo.git", "github.com", "Acme/Demo"],
    ["https://user@github.com/acme/demo.git", "github.com", "acme/demo"],
    ["https://user:token@github.com:443/acme/demo.git", "github.com", "acme/demo"],
    ["  https://github.com/acme/demo.git\n", "github.com", "acme/demo"],
    ["git@github.com:acme/demo.git", "github.com", "acme/demo"],
    ["github.com:acme/demo", "github.com", "acme/demo"],
    ["ssh://git@github.com/acme/demo.git", "github.com", "acme/demo"],
    ["ssh://git@gitlab.example.com:2222/group/sub/repo.git", "gitlab.example.com", "group/sub/repo"],
    ["git+ssh://git@github.com/acme/demo.git", "github.com", "acme/demo"],
    ["git://example.org/projects/tool.git", "example.org", "projects/tool"],
    ["git@server:/srv/git/repo.git", "server", "srv/git/repo"],
    ["https://dev.azure.com/org/project/_git/repo", "dev.azure.com", "org/project/_git/repo"],
    ["https://org@dev.azure.com/org/project/_git/repo", "dev.azure.com", "org/project/_git/repo"],
    ["https://dev.azure.com/org/My%20Project/_git/My%20Repo", "dev.azure.com", "org/My Project/_git/My Repo"],
    ["git@ssh.dev.azure.com:v3/org/project/repo", "dev.azure.com", "org/project/_git/repo"],
    ["ssh://git@ssh.dev.azure.com/v3/org/project/repo", "dev.azure.com", "org/project/_git/repo"],
    ["https://org.visualstudio.com/project/_git/repo", "dev.azure.com", "org/project/_git/repo"],
    ["https://org.visualstudio.com/DefaultCollection/project/_git/repo", "dev.azure.com", "org/project/_git/repo"],
    ["org@vs-ssh.visualstudio.com:v3/org/project/repo", "dev.azure.com", "org/project/_git/repo"],
  ])("reads %s", (url, host, path) => {
    expect(parseRemote(url)).toMatchObject({ host, path });
  });

  it.each([
    "",
    "   ",
    "/srv/git/repo.git",
    "../origin.git",
    "C:\\repos\\demo",
    "C:/repos/demo",
    "file:///srv/git/repo.git",
    "ftp://example.org/repo.git",
    "https://github.com",
    "https://github.com/",
    "https://",
    "git@github.com:",
    "-uhttps://evil/x",
    "https://github.com/acme/de mo",
    "https://github.com/acme/demo\nx",
    `https://github.com/${"a".repeat(2100)}`,
    // Git runs a remote helper for <transport>::<address>; ext:: runs any command.
    "ext::calc.exe",
    "EXT::sh",
    "fd::3",
    "foo::https://github.com/acme/demo.git",
    "git@-oProxyCommand=calc:acme/demo",
    "ssh://-oProxyCommand=calc/acme/demo",
  ])("refuses %j, which is not a repository on another machine", (url) => {
    expect(parseRemote(url)).toBeNull();
  });

  it("keeps http for servers without TLS and uses https otherwise", () => {
    expect(parseRemote("http://gitlab.local/group/repo.git")?.scheme).toBe("http");
    expect(parseRemote("git@gitlab.local:group/repo.git")?.scheme).toBe("https");
  });
});

describe("withoutCredentials", () => {
  it.each([
    ["https://me:secret@github.com/acme/demo.git", "https://github.com/acme/demo.git"],
    ["http://token@gitlab.local/group/repo.git", "http://gitlab.local/group/repo.git"],
    ["https://github.com/acme/demo.git", "https://github.com/acme/demo.git"],
    ["https://user:p@ss@github.com/acme/demo.git", "https://github.com/acme/demo.git"],
    ["https://github.com/acme/demo.git?private_token=abc#readme", "https://github.com/acme/demo.git"],
    ["ssh://git:secret@gitlab.example.com:2222/group/repo.git", "ssh://gitlab.example.com:2222/group/repo.git"],
    ["ssh://git@github.com/acme/demo.git", "ssh://github.com/acme/demo.git"],
    ["git@github.com:acme/demo.git", "git@github.com:acme/demo.git"],
    ["me:secret@server.example:repo.git", "server.example:repo.git"],
    ["/srv/git/repo.git", "/srv/git/repo.git"],
    ["C:\\repos\\me@home", "C:\\repos\\me@home"],
  ])("turns %s into %s", (url, shared) => {
    expect(withoutCredentials(url)).toBe(shared);
  });
});

describe("namesRemoteHelper", () => {
  it.each(["ext::calc.exe", "fd::3", "Foo-1.x+y::anything", "  ext::sh"])("finds the remote helper in %j", (url) => {
    expect(namesRemoteHelper(url)).toBe(true);
  });

  it.each(["https://github.com/acme/demo.git", "git@github.com:acme/demo.git", "C:\\repos\\demo", "/srv/a::b", "1x::y"])(
    "finds none in %j",
    (url) => {
      expect(namesRemoteHelper(url)).toBe(false);
    },
  );
});

describe("sameRepository", () => {
  it.each([
    ["https://github.com/acme/demo.git", "git@github.com:acme/demo.git"],
    ["https://github.com/acme/demo", "ssh://git@github.com/acme/demo.git/"],
    ["https://user@GitHub.com/Acme/Demo.git", "https://github.com/acme/demo"],
    ["git@ssh.dev.azure.com:v3/org/project/repo", "https://org@dev.azure.com/org/project/_git/repo"],
    ["ssh://git@gitlab.example.com:2222/group/repo.git", "https://gitlab.example.com/group/repo"],
  ])("matches %s and %s", (a, b) => {
    expect(sameRepository(a, b)).toBe(true);
    expect(sameRepository(b, a)).toBe(true);
  });

  it.each([
    ["https://github.com/acme/demo.git", "https://github.com/acme/demo-two.git"],
    ["https://github.com/acme/demo.git", "https://gitlab.com/acme/demo.git"],
    ["https://github.com/acme/demo.git", "https://github.com/other/demo.git"],
    ["/srv/repo.git", "/srv/repo.git"],
  ])("tells %s and %s apart", (a, b) => {
    expect(sameRepository(a, b)).toBe(false);
  });
});

describe("webUrl", () => {
  const file = (path: string, branch = "main") => ({ kind: "file", path, branch }) as const;
  const commit = { kind: "commit", hash: "0123456789abcdef0123456789abcdef01234567" } as const;

  it.each([
    ["https://github.com/acme/demo.git", file("tasks/DP-1.md"), "https://github.com/acme/demo/blob/main/tasks/DP-1.md"],
    ["git@github.com:acme/demo.git", file("docs/Home.md", "feature/login"), "https://github.com/acme/demo/blob/feature/login/docs/Home.md"],
    ["https://github.com/acme/demo", commit, `https://github.com/acme/demo/commit/${commit.hash}`],
    ["git@gitlab.com:group/sub/repo.git", file("src/a b.ts"), "https://gitlab.com/group/sub/repo/-/blob/main/src/a%20b.ts"],
    ["https://gitlab.com/group/repo.git", commit, `https://gitlab.com/group/repo/-/commit/${commit.hash}`],
    ["ssh://git@gitlab.example.com:2222/group/repo.git", file("README.md"), "https://gitlab.example.com/group/repo/-/blob/main/README.md"],
    ["http://gitlab.local/group/repo.git", commit, `http://gitlab.local/group/repo/-/commit/${commit.hash}`],
    ["git@bitbucket.org:team/repo.git", file("docs/Home.md", "develop"), "https://bitbucket.org/team/repo/src/develop/docs/Home.md"],
    ["https://user@bitbucket.org/team/repo.git", commit, `https://bitbucket.org/team/repo/commits/${commit.hash}`],
    [
      "git@ssh.dev.azure.com:v3/org/project/repo",
      file("docs/Home.md", "feature/x"),
      "https://dev.azure.com/org/project/_git/repo?path=/docs/Home.md&version=GBfeature/x",
    ],
    [
      "https://org@dev.azure.com/org/My%20Project/_git/repo",
      commit,
      `https://dev.azure.com/org/My%20Project/_git/repo/commit/${commit.hash}`,
    ],
    [
      "https://github.com/acme/demo.git",
      file("docs/50% & more#1.md"),
      "https://github.com/acme/demo/blob/main/docs/50%25%20%26%20more%231.md",
    ],
  ])("maps %s %j to %s", (remote, target, url) => {
    expect(webUrl(remote, target)).toBe(url);
  });

  it.each(["https://git.example.org/acme/demo.git", "git@bitbucket.example.com:team/repo.git", "/srv/repo.git"])(
    "has no web page for %s, which is no known host",
    (remote) => {
      expect(webUrl(remote, commit)).toBeNull();
    },
  );
});
