/**
 * Interactive rebases: checks the steps the user chose and turns them into
 * a todo list for `git rebase -i` that never needs an editor. Squashes
 * become fixups, and every commit whose message changes (reworded, or
 * squashed into) is amended with its new message right after it is made.
 */
import type { RebaseCommit, RebaseStep } from "../contracts/model";
import type { RebaseTodo, TodoLine } from "../contracts/rebase-todo";

/** A commit being made from a pick and the commits folded into it. */
interface Group {
  readonly message: string;
  /** Set when the message changes. */
  replaced: string | null;
}

export class RebaseEngine {
  /**
   * The todo for rewriting `commits` (oldest first, the commits after the
   * base) as `steps` say: every commit exactly once, in the new order.
   */
  todo(commits: readonly RebaseCommit[], steps: readonly RebaseStep[]): RebaseTodo {
    const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
    if (commits.some((commit) => commit.merge))
      throw new Error("These commits include a merge, which an interactive rebase in Genbeya can't rewrite. Use the terminal instead.");
    if (
      steps.length !== commits.length ||
      new Set(steps.map((step) => step.hash)).size !== steps.length ||
      steps.some((step) => !byHash.has(step.hash))
    )
      throw new Error("The commits changed meanwhile. Open the rebase again.");
    const lines: TodoLine[] = [];
    const messages: string[] = [];
    let group: Group | null = null;
    const finish = () => {
      if (!group || group.replaced === null || group.replaced === group.message) return;
      messages.push(group.replaced);
      lines.push({ command: "amend", message: messages.length - 1 });
    };
    for (const step of steps) {
      const commit = byHash.get(step.hash)!;
      const message = step.message?.trim();
      if (step.action === "drop") {
        lines.push({ command: "drop", hash: step.hash });
      } else if (step.action === "pick" || step.action === "reword") {
        finish();
        if (step.action === "reword" && !message) throw new Error(`Write a message for ${commit.subject}.`);
        group = { message: commit.message, replaced: step.action === "reword" ? message! : null };
        lines.push({ command: "pick", hash: step.hash });
      } else {
        if (!group) throw new Error(`${commit.subject} has no earlier commit to be squashed into.`);
        // Without a message of its own, a squash joins the messages, as git does.
        if (step.action === "squash") group.replaced = message || `${group.replaced ?? group.message}\n\n${commit.message}`;
        lines.push({ command: "fixup", hash: step.hash });
      }
    }
    finish();
    return { lines, messages };
  }
}
