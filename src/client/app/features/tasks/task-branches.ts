/**
 * Branches named after tasks, as in Jira and Bitbucket: a branch whose name
 * contains a task's ID (`GENBEYA-32-branch-links`, `feature/genbeya-32`)
 * belongs to that task. The ID matches regardless of case, but not inside a
 * longer ID (`GENBEYA-320`) or word.
 */

/** A branch of a task: local, or only on a remote (such as `origin/GENBEYA-32`). */
export interface TaskBranch {
  readonly name: string;
  readonly remote: boolean;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches `id` as a whole inside a branch name. */
const idPattern = (id: string) => new RegExp(`(?<![A-Za-z0-9])${escape(id)}(?![0-9])`, "i");

/** The branches named after the task, local ones first; remote branches with a local counterpart are left out. */
export function branchesOfTask(id: string, local: readonly string[], remote: readonly string[]): TaskBranch[] {
  const pattern = idPattern(id);
  return [
    ...local.filter((name) => pattern.test(name)).map((name) => ({ name, remote: false })),
    ...remote.filter((name) => pattern.test(name.slice(name.indexOf("/") + 1))).map((name) => ({ name, remote: true })),
  ];
}

/** The task a branch is named after: the first ID with the task prefix that names a task, else null. */
export function taskOfBranch(branch: string, prefix: string, ids: ReadonlySet<string>): string | null {
  for (const match of branch.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(prefix)}-\\d+(?![0-9])`, "gi"))) {
    const id = match[0].toUpperCase();
    const known = [...ids].find((candidate) => candidate.toUpperCase() === id);
    if (known) return known;
  }
  return null;
}

/** A name for a new branch of the task: its ID and a short form of its title, `GENBEYA-32-link-branches-to-tasks`. */
export function branchNameFor(id: string, title: string): string {
  const slug = title
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    // Accents become separate marks, which go; ä is a, é is e.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug ? `${id}-${slug}` : id;
}
