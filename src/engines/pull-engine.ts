/**
 * Pull request files: one Markdown file per pull request, `pulls/PR-7.md`,
 * its frontmatter naming the branches, the people and the state, its body
 * holding the description, the review and the discussion (see
 * `utilities/pull-requests.ts`). Updates rewrite the fields in place, so
 * fields other tools added survive, and keep the file's line endings.
 */
import YAML from "yaml";
import { PULL_STATUSES, type PullInput, type PullRequest, type PullStatus } from "../contracts/model";
import { within } from "../utilities/repository-path";
import { applyTextStyle, LF_STYLE, textStyleOf } from "../utilities/text-style";
import { compose, splitFrontmatter, yamlText } from "./task-engine";

const LIMITS = { title: 300, branch: 250, reviewers: 30, reviewer: 120, body: 1024 * 1024 } as const;
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

export class PullEngine {
  /** Markdown files directly in the pull request folder. */
  isPullFile(path: string, pullRoot: string): boolean {
    return within(path, pullRoot) && !path.slice(pullRoot.length + 1).includes("/") && path.toLowerCase().endsWith(".md");
  }

  pathOf(pullRoot: string, id: string): string {
    return `${pullRoot}/${id}.md`;
  }

  parse(path: string, content: string, hash: string): PullRequest {
    const { data, body } = splitFrontmatter(content);
    const text = (key: string) => (data[key] == null ? "" : String(data[key]).trim());
    const status = text("status");
    const merge = text("merge_commit");
    if (!text("id")) throw new Error("A pull request needs an id.");
    return {
      id: text("id"),
      path,
      title: text("title"),
      status: (PULL_STATUSES as readonly string[]).includes(status) ? (status as PullStatus) : "open",
      author: text("author"),
      source: text("source"),
      target: text("target"),
      reviewers: list(data["reviewers"]),
      mergeCommit: COMMIT_ID.test(merge) ? merge : null,
      body: body.replace(/^\r?\n/, ""),
      hash,
    };
  }

  /** Checks and normalises client input. */
  validate(value: unknown): PullInput {
    const input = (value ?? {}) as Partial<Record<keyof PullInput, unknown>>;
    const line = (field: unknown, label: string, max: number, required = true) => {
      const text = typeof field === "string" ? field.replace(/\s+/g, " ").trim() : "";
      if ((required && !text) || text.length > max) throw new Error(`${label} is required (up to ${max} characters).`);
      return text;
    };
    if (!(PULL_STATUSES as readonly unknown[]).includes(input.status)) throw new Error("Invalid pull request state.");
    if (!Array.isArray(input.reviewers) || input.reviewers.length > LIMITS.reviewers) throw new Error("Invalid reviewers.");
    if (typeof input.body !== "string" || input.body.length > LIMITS.body) throw new Error("Invalid description.");
    const branch = (field: unknown, label: string) => {
      const name = line(field, label, LIMITS.branch);
      if (name.startsWith("-") || /\s|\.\.|[~^:?*[\\]/.test(name)) throw new Error(`${label} is not a branch name.`);
      return name;
    };
    const merge = input.mergeCommit;
    if (merge !== undefined && merge !== null && !(typeof merge === "string" && COMMIT_ID.test(merge)))
      throw new Error("Invalid merge commit.");
    return {
      title: line(input.title, "A title", LIMITS.title),
      status: input.status as PullStatus,
      source: branch(input.source, "The source branch"),
      target: branch(input.target, "The target branch"),
      reviewers: [...new Set(input.reviewers.map((reviewer) => line(reviewer, "A reviewer", LIMITS.reviewer)))],
      body: input.body,
      ...(merge !== undefined ? { mergeCommit: merge } : {}),
    };
  }

  /** A new pull request file, by `author`. */
  serializeNew(id: string, input: PullInput, author: string): string {
    const document = new YAML.Document({
      id,
      title: input.title,
      status: input.status,
      author,
      source: input.source,
      target: input.target,
      reviewers: [...input.reviewers],
    });
    return applyTextStyle(compose(yamlText(document), input.body), LF_STYLE);
  }

  /** `original` with the fields and body of `input`; other fields stay as written. */
  serializeUpdate(original: string, input: PullInput): string {
    const { document, data } = splitFrontmatter(original);
    const set = (key: string, value: unknown) => {
      if (JSON.stringify(data[key]) !== JSON.stringify(value)) document.set(key, value);
    };
    set("title", input.title);
    set("status", input.status);
    set("source", input.source);
    set("target", input.target);
    set("reviewers", [...input.reviewers]);
    if (input.mergeCommit === null) document.delete("merge_commit");
    else if (input.mergeCommit !== undefined) set("merge_commit", input.mergeCommit);
    return applyTextStyle(compose(yamlText(document), input.body), textStyleOf(original));
  }

  /** The next free ID, after the highest of `ids` with the prefix. */
  nextId(prefix: string, ids: Iterable<string>, taken: (id: string) => boolean = () => false): string {
    const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
    let highest = 0;
    for (const id of ids) highest = Math.max(highest, Number(pattern.exec(id)?.[1] ?? 0));
    let id: string;
    do id = `${prefix}-${++highest}`;
    while (taken(id));
    return id;
  }
}
