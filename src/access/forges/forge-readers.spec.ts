import { describe, expect, it } from "vitest";
import { fakeForges, fakeGitHub, type FakeRepository } from "../../testing/fake-forges";
import type { Forge, ForgeAddress } from "../../utilities/forge-address";
import { MAX_FILE_BYTES, type ForgeAccess, type ForgeTree, type TreeFile } from "./forge";
import { github } from "./github";
import { FORGE_READERS } from "./readers";

type Target = Pick<ForgeAddress, "owner" | "name" | "branch">;

const readGitHubTree = (target: Target, access: ForgeAccess) => github.readTree({ forge: "github", host: "github.com", ...target }, access);
const readGitHubFiles = (tree: ForgeTree, files: readonly TreeFile[], access: ForgeAccess) => github.readFiles(tree, files, access);

/** The whole branch: its tree, and every file of it. */
async function readGitHubRepository(target: Target, access: ForgeAccess) {
  const tree = await readGitHubTree(target, access);
  return { ...tree, files: await readGitHubFiles(tree, tree.files, access) };
}

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

const project: FakeRepository = {
  owner: "Acme",
  name: "Rockets",
  defaultBranch: "main",
  branches: {
    main: {
      message: "Plan the launch",
      files: {
        ".genbeya.yml": "name: Rockets\ntaskPrefix: RKT\n",
        "docs/Home.md": "# Rockets\n\nSee [[RKT-1]].\n",
        "tasks/RKT-1.md": "---\nid: RKT-1\ntitle: Launch\nstatus: todo\n---\n",
        "src/main.ts": "export const ready = true;\n",
        "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]),
        latest: "docs/Home.md",
      },
    },
    "feature/fins": { files: { "docs/Home.md": "# Fins\n" } },
  },
  submodules: ["vendor/engine"],
  links: ["latest"],
};

describe("reading a repository from GitHub", () => {
  it("reads a public repository with three API requests, and its files from raw.githubusercontent.com", async () => {
    const github = fakeGitHub([project]);
    const snapshot = await readGitHubRepository({ owner: "acme", name: "rockets" }, { fetch: github });

    expect(snapshot).toMatchObject({ owner: "Acme", name: "Rockets", branch: "main", defaultBranch: "main", private: false });
    expect(snapshot.cloneUrl).toBe("https://github.com/Acme/Rockets.git");
    expect(snapshot.commit).toMatchObject({ message: "Plan the launch", author: { name: "Ada Lovelace" } });
    expect(snapshot.commit.sha).toMatch(/^[\da-f]{40}$/);
    expect(decode(snapshot.files.get("tasks/RKT-1.md"))).toContain("title: Launch");
    expect([...snapshot.files.get("logo.png")!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    expect(snapshot.skipped).toEqual([
      { path: "latest", reason: "link" },
      { path: "vendor/engine", reason: "submodule" },
    ]);

    const api = github.requests.filter((request) => request.url.startsWith("https://api.github.com/"));
    expect(api).toHaveLength(3);
    // No headers of its own, so a browser sends every request without a preflight.
    expect(github.requests.every((request) => Object.keys(request.headers).length === 0)).toBe(true);
    expect(github.requests.filter((request) => request.url.startsWith("https://raw.githubusercontent.com/"))).toHaveLength(5);
  });

  it("reads the branch it is asked for", async () => {
    const snapshot = await readGitHubRepository(
      { owner: "Acme", name: "Rockets", branch: "feature/fins" },
      { fetch: fakeGitHub([project]) },
    );
    expect(snapshot.branch).toBe("feature/fins");
    expect([...snapshot.files.keys()]).toEqual(["docs/Home.md"]);
  });

  it("lists the tree with three requests, and reads only the files asked for", async () => {
    const github = fakeGitHub([project]);
    const tree = await readGitHubTree({ owner: "Acme", name: "Rockets" }, { fetch: github });
    expect(tree.files.map((file) => file.path)).toEqual([".genbeya.yml", "docs/Home.md", "logo.png", "src/main.ts", "tasks/RKT-1.md"]);
    expect(github.requests).toHaveLength(3);
    const files = await readGitHubFiles(tree, [tree.files[1]!], { fetch: github });
    expect([...files.keys()]).toEqual(["docs/Home.md"]);
    expect(github.requests).toHaveLength(4);
  });

  it("reports progress as files arrive", async () => {
    const seen: string[] = [];
    await readGitHubRepository(
      { owner: "Acme", name: "Rockets" },
      { fetch: fakeGitHub([project]), progress: (read, total) => seen.push(`${read}/${total}`) },
    );
    expect(seen).toEqual(["0/5", "1/5", "2/5", "3/5", "4/5", "5/5"]);
  });

  it("reads a private repository with a token, which goes only to the API", async () => {
    const github = fakeGitHub([{ ...project, private: true }], { token: "secret" });
    const snapshot = await readGitHubRepository({ owner: "Acme", name: "Rockets" }, { fetch: github, token: "secret" });
    expect(snapshot.private).toBe(true);
    expect(decode(snapshot.files.get("docs/Home.md"))).toContain("[[RKT-1]]");
    expect(github.requests.every((request) => request.url.startsWith("https://api.github.com/"))).toBe(true);
    expect(github.requests.every((request) => request.headers["authorization"] === "Bearer secret")).toBe(true);
  });

  it("explains a missing or private repository, a missing branch, a bad token and a used-up limit", async () => {
    const read = (options: Parameters<typeof fakeGitHub>[1], token?: string, branch?: string) =>
      readGitHubRepository(
        { owner: "Acme", name: "Rockets", ...(branch ? { branch } : {}) },
        { fetch: fakeGitHub([{ ...project, private: true }], options), token },
      );
    await expect(read({})).rejects.toThrow(
      "GitHub has no public repository Acme/Rockets. A private one opens with a token that can read it.",
    );
    await expect(read({ token: "secret" }, "wrong")).rejects.toThrow("GitHub didn't accept the token.");
    await expect(read({ token: "secret", otherTokens: ["other"] }, "other")).rejects.toThrow(
      "GitHub has no repository Acme/Rockets that your token can read.",
    );
    await expect(read({ token: "secret" }, "secret", "nope")).rejects.toThrow("Acme/Rockets has no branch nope.");
    await expect(read({ anonymousLimit: 0 })).rejects.toThrow(
      /^GitHub's limit of requests without signing in is used up until .+\. A token raises it\.$/,
    );
  });

  it("explains that GitHub is out of reach", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(readGitHubRepository({ owner: "Acme", name: "Rockets" }, { fetch: offline })).rejects.toThrow("Can't reach GitHub.");
  });

  it("refuses names GitHub doesn't allow before asking it", async () => {
    const github = fakeGitHub([project]);
    await expect(readGitHubRepository({ owner: "../etc", name: "Rockets" }, { fetch: github })).rejects.toThrow(
      "isn't a GitHub repository name",
    );
    await expect(readGitHubRepository({ owner: "Acme", name: "Rockets", branch: "a..b" }, { fetch: github })).rejects.toThrow(
      "isn't a branch name",
    );
    expect(github.requests).toHaveLength(0);
  });

  it("leaves out large files and paths Genbeya can't hold", async () => {
    const github = fakeGitHub([
      {
        ...project,
        branches: { main: { files: { "big.bin": "x", "docs/Home.md": "# Home\n", ".git/config": "x", "a/GIT~1/b": "x" } } },
        sizes: { "big.bin": MAX_FILE_BYTES + 1 },
        submodules: [],
        links: [],
      },
    ]);
    const snapshot = await readGitHubRepository({ owner: "Acme", name: "Rockets" }, { fetch: github });
    expect([...snapshot.files.keys()]).toEqual(["a/GIT~1/b", "docs/Home.md"]);
    expect(snapshot.skipped).toEqual([
      { path: ".git/config", reason: "path" },
      { path: "big.bin", reason: "large" },
    ]);
  });

  it("explains that raw.githubusercontent.com is limiting how fast files are read", async () => {
    const limited = async (url: string) =>
      url.startsWith("https://raw.") ? new Response("", { status: 429 }) : fakeGitHub([project])(url);
    await expect(readGitHubRepository({ owner: "Acme", name: "Rockets" }, { fetch: limited })).rejects.toThrow(
      "GitHub is limiting how fast this page reads files. Try again in a few minutes.",
    );
  });
});

/** The same repository on every forge the readers know, on its website or a server of its own. */
const FORGES: readonly { forge: Forge; host: string; owner: string; api: string }[] = [
  { forge: "github", host: "github.com", owner: "Acme", api: "https://api.github.com/" },
  { forge: "gitlab", host: "gitlab.com", owner: "acme/space", api: "https://gitlab.com/api/v4/" },
  { forge: "gitlab", host: "gitlab.example.com", owner: "acme", api: "https://gitlab.example.com/api/v4/" },
  { forge: "codeberg", host: "codeberg.org", owner: "Acme", api: "https://codeberg.org/api/v1/" },
  { forge: "gitea", host: "git.example.com", owner: "Acme", api: "https://git.example.com/api/v1/" },
  { forge: "forgejo", host: "code.example.org:3000", owner: "Acme", api: "https://code.example.org:3000/api/v1/" },
  { forge: "bitbucket", host: "bitbucket.org", owner: "acme", api: "https://api.bitbucket.org/2.0/" },
];

describe.each(FORGES)("reading a repository from $forge on $host", ({ forge, host, owner, api }) => {
  const repository = (overrides: Partial<FakeRepository> = {}): FakeRepository => ({ ...project, forge, host, owner, ...overrides });
  const address = (branch?: string): ForgeAddress => ({ forge, host, owner, name: "Rockets", ...(branch ? { branch } : {}) });
  const reader = FORGE_READERS[forge];
  const readAll = async (target: ForgeAddress, access: ForgeAccess) => {
    const tree = await reader.readTree(target, access);
    return { tree, files: await reader.readFiles(tree, tree.files, access) };
  };

  it("lists the branch through every page, and reads its files", async () => {
    const fetch = fakeForges([repository()], { pageSize: 2 });
    const { tree, files } = await readAll(address(), { fetch });
    expect(tree).toMatchObject({ owner, name: "Rockets", branch: "main", defaultBranch: "main", private: false });
    expect(tree.commit).toMatchObject({ message: "Plan the launch", author: { name: "Ada Lovelace", email: "ada@example.com" } });
    expect(tree.commit.sha).toMatch(/^[\da-f]{40}$/);
    expect(tree.cloneUrl).toMatch(/^https:\/\/[^@]+\.git$/);
    expect(tree.files.map((file) => file.path)).toEqual([".genbeya.yml", "docs/Home.md", "logo.png", "src/main.ts", "tasks/RKT-1.md"]);
    expect(tree.skipped).toEqual([
      { path: "latest", reason: "link" },
      { path: "vendor/engine", reason: "submodule" },
    ]);
    expect(tree.truncated).toBe(false);
    expect(decode(files.get("tasks/RKT-1.md"))).toContain("title: Launch");
    expect([...files.get("logo.png")!]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    // Nothing but the forge's own hosts, and no headers of its own without a token.
    expect(
      fetch.requests.every((request) => request.url.startsWith(api) || request.url.startsWith("https://raw.githubusercontent.com/")),
    ).toBe(true);
    expect(fetch.requests.every((request) => Object.keys(request.headers).length === 0)).toBe(true);
  });

  it("reads the branch it is asked for", async () => {
    const tree = await reader.readTree(address("feature/fins"), { fetch: fakeForges([repository()]) });
    expect(tree.branch).toBe("feature/fins");
    expect(tree.files.map((file) => file.path)).toEqual(["docs/Home.md"]);
  });

  it("reads a private repository with a token, which goes only to the forge's API", async () => {
    const fetch = fakeForges([repository({ private: true })], { token: "secret" });
    const { tree, files } = await readAll(address(), { fetch, token: "secret" });
    expect(tree.private).toBe(true);
    expect(decode(files.get("docs/Home.md"))).toContain("[[RKT-1]]");
    expect(fetch.requests.every((request) => request.url.startsWith(api) && request.headers["authorization"]?.endsWith(" secret"))).toBe(
      true,
    );
  });

  it("explains a missing or private repository, a missing branch and a bad token", async () => {
    const label = { github: "GitHub", gitlab: "GitLab", codeberg: "Codeberg", gitea: "Gitea", forgejo: "Forgejo", bitbucket: "Bitbucket" }[
      forge
    ];
    const fetch = fakeForges([repository({ private: true })], { token: "secret", otherTokens: ["other"] });
    await expect(reader.readTree(address(), { fetch })).rejects.toThrow(
      `${label} has no public repository ${owner}/Rockets. A private one opens with a token that can read it.`,
    );
    await expect(reader.readTree(address(), { fetch, token: "other" })).rejects.toThrow(
      `${label} has no repository ${owner}/Rockets that your token can read.`,
    );
    await expect(reader.readTree(address(), { fetch, token: "wrong" })).rejects.toThrow(`${label} didn't accept the token.`);
    await expect(reader.readTree(address("nope"), { fetch, token: "secret" })).rejects.toThrow(`${owner}/Rockets has no branch nope.`);
  });

  it("leaves out files over a megabyte", async () => {
    const fetch = fakeForges([
      repository({
        branches: { main: { files: { "big.md": "x".repeat(MAX_FILE_BYTES + 1), "docs/Home.md": "# Home\n" } } },
        links: [],
        submodules: [],
      }),
    ]);
    const { tree, files } = await readAll(address(), { fetch });
    // GitLab lists no sizes: the file is read, then left out.
    expect([...files.keys()]).toEqual(["docs/Home.md"]);
    expect(tree.skipped).toEqual(forge === "gitlab" ? [] : [{ path: "big.md", reason: "large" }]);
  });
});

describe("forges' listings", () => {
  it("stops following pages at the limit and says the tree is cut short", async () => {
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, n) => [`docs/page-${String(n).padStart(3, "0")}.md`, "# Page\n"]));
    const fetch = fakeForges([{ forge: "gitlab", owner: "acme", name: "big", branches: { main: { files } } }], { pageSize: 1 });
    const tree = await FORGE_READERS.gitlab.readTree({ forge: "gitlab", host: "gitlab.com", owner: "acme", name: "big" }, { fetch });
    expect(tree.truncated).toBe(true);
    expect(tree.files.length).toBeLessThan(120);
  });

  it("never follows a next page off the forge's API", async () => {
    const real = fakeForges([{ ...project, forge: "bitbucket", owner: "acme" }], { pageSize: 2 });
    const hijacked = async (url: string, init?: Parameters<typeof real>[1]) => {
      const response = await real(url, init);
      if (!url.includes("/src/")) return response;
      const body = (await response.json()) as { next?: string };
      return new Response(JSON.stringify({ ...body, next: "https://evil.example.com/steal" }), { status: 200 });
    };
    await expect(
      FORGE_READERS.bitbucket.readTree({ forge: "bitbucket", host: "bitbucket.org", owner: "acme", name: "Rockets" }, { fetch: hijacked }),
    ).rejects.toThrow("Bitbucket linked to a next page outside its API, which Genbeya doesn't follow: https://evil.example.com/steal");
  });

  it("follows a server's http links to its own API over https, as GitLab behind a proxy that ends TLS sends them", async () => {
    const files = Object.fromEntries(Array.from({ length: 7 }, (_, n) => [`docs/page-${n}.md`, "# Page\n"]));
    for (const forge of ["gitlab", "gitea"] as const) {
      const fetch = fakeForges([{ forge, host: "git.example.com", owner: "acme", name: "deck", branches: { main: { files } } }], {
        pageSize: 2,
        httpSelfLinks: true,
      });
      const tree = await FORGE_READERS[forge].readTree({ forge, host: "git.example.com", owner: "acme", name: "deck" }, { fetch });
      expect(tree.files).toHaveLength(7);
      expect(tree.webUrl).toBe("https://git.example.com/acme/deck");
      expect(tree.cloneUrl).toBe("https://git.example.com/acme/deck.git");
      expect(fetch.requests.every((request) => request.url.startsWith("https://git.example.com/api/"))).toBe(true);
    }
  });

  it("never follows an http link to another host", async () => {
    const real = fakeForges(
      [
        {
          forge: "gitlab",
          host: "git.example.com",
          owner: "acme",
          name: "deck",
          branches: { main: { files: project.branches.main!.files } },
        },
      ],
      {
        pageSize: 2,
      },
    );
    const elsewhere = async (url: string, init?: Parameters<typeof real>[1]) => {
      const response = await real(url, init);
      const link = response.headers.get("link");
      if (!link) return response;
      return new Response(response.body, {
        status: 200,
        headers: { link: link.replace("https://git.example.com", "http://evil.example.com") },
      });
    };
    await expect(
      FORGE_READERS.gitlab.readTree({ forge: "gitlab", host: "git.example.com", owner: "acme", name: "deck" }, { fetch: elsewhere }),
    ).rejects.toThrow("GitLab linked to a next page outside its API, which Genbeya doesn't follow: http://evil.example.com/api/v4/");
  });
});
