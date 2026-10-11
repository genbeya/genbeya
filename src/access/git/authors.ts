/** Who writes the commits of a repository, and who Git signs new ones as. */
import type { Git } from "./git";

export interface AuthorCount {
  readonly name: string;
  readonly email: string;
  readonly commits: number;
}

/**
 * The authors of the newest `limit` commits of HEAD, with their number of
 * commits, as .mailmap names them (`%aN`, `%aE`); empty on an unborn branch.
 */
export async function commitAuthors(git: Git, limit: number): Promise<AuthorCount[]> {
  const output = await git.attempt(["log", "--no-show-signature", `--max-count=${limit}`, "--format=%aN%x00%aE", "HEAD", "--"]);
  const counts = new Map<string, AuthorCount>();
  for (const line of (output ?? "").split("\n")) {
    const [name = "", email = ""] = line.split("\0");
    if (!name.trim() && !email.trim()) continue;
    const id = `${name}\0${email}`;
    counts.set(id, { name, email, commits: (counts.get(id)?.commits ?? 0) + 1 });
  }
  return [...counts.values()];
}

/** The name and email Git signs commits with (`user.name`, or what Git derives from the system account); null if Git has none. */
export async function commitIdentity(git: Git): Promise<{ name: string; email: string } | null> {
  // "Ada Lovelace <ada@example.com> 1791669471 +0200"
  const ident = (await git.attempt(["var", "GIT_AUTHOR_IDENT"]))?.trim();
  const match = ident ? /^(.*?) <([^>]*)>/.exec(ident) : null;
  return match ? { name: match[1]!.trim(), email: match[2]!.trim() } : null;
}
