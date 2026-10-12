/** Real git repositories for integration tests, removed after each test. */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { onTestFinished } from "vitest";
import { temporaryFolder } from "./temp";

const exec = promisify(execFile);

export interface TestRepository {
  readonly root: string;
  git(...args: string[]): Promise<string>;
  write(relative: string, content: string | Uint8Array): Promise<void>;
  read(relative: string): Promise<string>;
  exists(relative: string): Promise<boolean>;
}

export const DEFAULT_FILES: Readonly<Record<string, string>> = {
  ".genbeya.yml": "name: Test Project\ntaskPrefix: TP\n",
  "docs/Home.md": "# Home\n",
  "docs/Architecture.md": "# Architecture\n",
  "docs/Architecture/Backend.md": "# Backend\n",
  "docs/Architecture/Backend/Auth.md": "# Auth\n",
  "src/code.ts": "export const value = 1;\n",
};

async function open(root: string): Promise<TestRepository> {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root })).stdout;
  return {
    root,
    git,
    async write(relative, content) {
      await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await fs.writeFile(path.join(root, relative), content);
    },
    read: (relative) => fs.readFile(path.join(root, relative), "utf8"),
    exists: (relative) =>
      fs.access(path.join(root, relative)).then(
        () => true,
        () => false,
      ),
  };
}

/** A repository with `files` (DEFAULT_FILES unless given), committed unless `commit` is false. */
export async function createRepository(files: Readonly<Record<string, string>> = DEFAULT_FILES, commit = true): Promise<TestRepository> {
  const repository = await open(await temporaryFolder("repo-"));
  await repository.git("init", "-q", "-b", "main");
  await repository.git("config", "user.name", "Test");
  await repository.git("config", "user.email", "test@example.com");
  await repository.git("config", "core.autocrlf", "false");
  for (const [relative, content] of Object.entries(files)) await repository.write(relative, content);
  if (commit && Object.keys(files).length) {
    await repository.git("add", ".");
    await repository.git("commit", "-q", "-m", "Initial commit");
  }
  return repository;
}

/** A bare repository to push to. */
export async function createRemote(): Promise<string> {
  const root = await temporaryFolder("remote-");
  await exec("git", ["init", "-q", "--bare", "-b", "main", root]);
  return root;
}

/** A clone of `remote`, configured to commit. */
export async function cloneRepository(remote: string): Promise<TestRepository> {
  const root = path.join(await temporaryFolder("clone-"), "clone");
  await exec("git", ["clone", "-q", remote, root]);
  const repository = await open(root);
  await repository.git("config", "user.name", "Other");
  await repository.git("config", "user.email", "other@example.com");
  await repository.git("config", "core.autocrlf", "false");
  return repository;
}

export { onTestFinished };
