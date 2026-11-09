import { describe, expect, it } from "vitest";
import { fakeGitHub, type FakeRepository } from "../../testing/fake-github";
import { MAX_FILE_BYTES, readGitHubFiles, readGitHubTree, type GitHubAccess, type GitHubTarget } from "./github-reader";

/** The whole branch: its tree, and every file of it. */
async function readGitHubRepository(target: GitHubTarget, access: GitHubAccess) {
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
