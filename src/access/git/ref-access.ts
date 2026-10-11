/**
 * Branches and tags beyond switching: renaming, deleting, upstreams, and
 * tags on remotes. Callers validate names, remotes and commits; they
 * still follow `--end-of-options`, so none is ever read as an option.
 */
import { failure, NETWORK_TIMEOUT, type Git } from "./git";

export class RefAccess {
  constructor(private readonly git: Git) {}

  /** Short names of local branches, remote-tracking branches and tags. */
  async names(): Promise<{ branches: string[]; remoteBranches: string[]; tags: string[] }> {
    const refs = await this.git.lines(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"]);
    const below = (prefix: string) => refs.filter((ref) => ref.startsWith(prefix)).map((ref) => ref.slice(prefix.length));
    return {
      branches: below("refs/heads/"),
      remoteBranches: below("refs/remotes/").filter((ref) => !ref.endsWith("/HEAD")),
      tags: below("refs/tags/"),
    };
  }

  async isValidTagName(name: string): Promise<boolean> {
    return (await this.git.attempt(["check-ref-format", `refs/tags/${name}`])) !== null;
  }

  async renameBranch(name: string, newName: string): Promise<void> {
    await this.git.text(["branch", "--move", "--end-of-options", name, newName]);
  }

  /** False when the branch is not fully merged and `force` is false. */
  async deleteBranch(name: string, force: boolean): Promise<boolean> {
    const args = ["branch", force ? "-D" : "-d", "--end-of-options", name];
    const result = await this.git.run(args);
    if (result.code === 0) return true;
    if (!force && /not fully merged/i.test(result.stderr)) return false;
    throw failure(args, result);
  }

  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.git.text(["push", "--delete", "--end-of-options", remote, `refs/heads/${branch}`], NETWORK_TIMEOUT);
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    await this.git.text(["branch", `--set-upstream-to=${upstream}`, "--end-of-options", branch]);
  }

  async createTag(name: string, commit: string, message: string): Promise<void> {
    await this.git.text(["tag", ...(message ? ["--annotate", "--message", message] : []), "--end-of-options", name, commit]);
  }

  async deleteTag(name: string): Promise<void> {
    await this.git.text(["tag", "--delete", "--end-of-options", name]);
  }

  async pushTag(name: string, remote: string): Promise<void> {
    await this.git.text(["push", "--end-of-options", remote, `refs/tags/${name}`], NETWORK_TIMEOUT);
  }

  async deleteRemoteTag(name: string, remote: string): Promise<void> {
    await this.git.text(["push", "--delete", "--end-of-options", remote, `refs/tags/${name}`], NETWORK_TIMEOUT);
  }
}
