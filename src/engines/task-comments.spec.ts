import { describe, expect, it } from "vitest";
import { commentBlock, commentHeading, joinComments, protectHeadings, splitComments, timestampOf } from "./task-comments";

const FILE_BODY = `Description.

## Comments

### Ada Lovelace — 2026-10-10 14:32+02:00

First, with a [[GENBEYA-1]] reference.

- a list

### Jean-Luc Picard - 2026-10-11T09:05Z

Second.
`;

describe("splitComments", () => {
  it("separates the description from the comments below the heading", () => {
    const { description, blocks } = splitComments(FILE_BODY);
    expect(description).toBe("Description.\n");
    expect(blocks.map((block) => block.comment)).toEqual([
      { author: "Ada Lovelace", date: "2026-10-10T14:32+02:00", body: "First, with a [[GENBEYA-1]] reference.\n\n- a list" },
      { author: "Jean-Luc Picard", date: "2026-10-11T09:05Z", body: "Second." },
    ]);
  });

  it("leaves a body without comments alone", () => {
    expect(splitComments("Just text.\n")).toEqual({ description: "Just text.\n", blocks: [] });
    // A "Comments" heading of the description itself is not followed by a comment.
    const own = "Intro\n\n## Comments\n\nWhat reviewers said.\n";
    expect(splitComments(own)).toEqual({ description: own, blocks: [] });
    expect(splitComments("## Comments\n").blocks).toEqual([]);
  });

  it("takes the first heading followed by a comment, so comments may contain the heading", () => {
    const { description, blocks } = splitComments(
      "Notes\n\n## Comments\n\nreal\n\n## Comments\n\n### A — 2026-01-02 03:04\n\nx\n\n## Comments\n\nmore\n",
    );
    expect(description).toBe("Notes\n\n## Comments\n\nreal\n");
    expect(blocks.map((block) => block.comment.body)).toEqual(["x\n\n## Comments\n\nmore"]);
  });

  it("reads CRLF bodies and normalises offsets without a colon", () => {
    const { description, blocks } = splitComments(
      "Text\r\n\r\n## Comments\r\n\r\n### B — 2026-01-02 03:04+0530\r\n\r\nLine one\r\nLine two\r\n",
    );
    expect(description).toBe("Text\r\n");
    expect(blocks[0]!.comment).toEqual({ author: "B", date: "2026-01-02T03:04+05:30", body: "Line one\nLine two" });
  });

  it("keeps empty comments", () => {
    expect(splitComments("## Comments\n\n### A — 2026-01-02 03:04\n").blocks[0]!.comment.body).toBe("");
  });
});

describe("joinComments", () => {
  it("round-trips a body as written", () => {
    const { description, blocks } = splitComments(FILE_BODY);
    const texts = blocks.map((block) => block.text);
    expect(joinComments(description, texts)).toBe(FILE_BODY);
  });

  it("starts the section after the description, or at the top", () => {
    const block = commentBlock(commentHeading("Ada", "2026-10-10 14:32+02:00"), "Hi");
    expect(joinComments("Text\n\n\n", [block])).toBe("Text\n\n## Comments\n\n### Ada — 2026-10-10 14:32+02:00\n\nHi\n");
    expect(joinComments("", [block])).toBe("## Comments\n\n### Ada — 2026-10-10 14:32+02:00\n\nHi\n");
    expect(joinComments("Text\n", [])).toBe("Text\n");
  });
});

describe("protectHeadings", () => {
  it("escapes lines that would read as a comment heading", () => {
    expect(protectHeadings("a\n### Eve — 2026-01-02 03:04\n### Normal heading\n")).toBe(
      "a\n\\### Eve — 2026-01-02 03:04\n### Normal heading\n",
    );
    const text = `Before\n\n## Comments\n\n${protectHeadings("### Eve — 2026-01-02 03:04")}\n`;
    expect(splitComments(text).blocks).toEqual([]);
  });
});

describe("comments and code fences", () => {
  const EXAMPLE = "Intro\n\n```markdown\n## Comments\n\n### Ada — 2026-01-02 03:04\n\nExample comment.\n```\n\nMore description.\n";

  it("never reads a fenced example of the comment format as the comments", () => {
    expect(splitComments(EXAMPLE)).toEqual({ description: EXAMPLE, blocks: [] });
    const { description, blocks } = splitComments(`${EXAMPLE}\n## Comments\n\n### Bob — 2026-01-03 04:05\n\nReal.\n`);
    expect(description).toBe(EXAMPLE);
    expect(blocks.map((block) => block.comment.author)).toEqual(["Bob"]);
  });

  it("keeps fenced comment headings inside a comment", () => {
    const body =
      "## Comments\n\n### Bob — 2026-01-03 04:05\n\n~~~\n### Eve — 2026-01-04 05:06\n~~~\n\n### Ada — 2026-01-05 06:07\n\nNext.\n";
    expect(splitComments(body).blocks.map((block) => block.comment.author)).toEqual(["Bob", "Ada"]);
  });

  it("leaves fenced headings alone when protecting text, and closes a fence left open", () => {
    expect(protectHeadings("```\n### Eve — 2026-01-02 03:04\n```\n### Eve — 2026-01-02 03:04")).toBe(
      "```\n### Eve — 2026-01-02 03:04\n```\n\\### Eve — 2026-01-02 03:04",
    );
    const open = protectHeadings("Code:\n\n````js\nlet a;\n```\n");
    expect(open).toBe("Code:\n\n````js\nlet a;\n```\n````");
    // Comments joined below the description are not swallowed by its fence.
    expect(splitComments(joinComments(open, ["### Bob — 2026-01-03 04:05\n\nHi"])).blocks).toHaveLength(1);
  });
});

describe("splitComments on large bodies", () => {
  it("takes linear time on many comment section headings", () => {
    const body = "## Comments\n".repeat(80_000);
    const started = performance.now();
    expect(splitComments(body).blocks).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("timestampOf", () => {
  it("writes local time to the minute with the UTC offset, which reads back as the same moment", () => {
    const date = new Date("2026-10-10T12:32:45Z");
    const stamp = timestampOf(date);
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const { blocks } = splitComments(`## Comments\n\n${commentBlock(commentHeading("A", stamp), "x")}\n`);
    expect(new Date(blocks[0]!.comment.date).getTime()).toBe(new Date("2026-10-10T12:32:00Z").getTime());
  });
});
