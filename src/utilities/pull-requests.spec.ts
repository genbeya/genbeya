import { describe, expect, it } from "vitest";
import {
  addDiscussionReply,
  addLocation,
  addReplyAt,
  addTopic,
  approvalsOf,
  dismissTodo,
  openItems,
  parsePullBody,
  promoteTodo,
  replyText,
  setTodo,
  shortenTopic,
  taskIdsOf,
  verdictRevisions,
} from "./pull-requests";

const A = "a".repeat(40);
const B = "b".repeat(40);

const BODY = `Migrate to \`verifyToken()\`. Implements [[GENBEYA-17]].

- [ ] Update the changelog

## Review

### Use the new verifier consistently

**Alex — 2026-10-23 12:40+02:00:** Several callers need it;
avoid a sync wrapper.

#### [[src/auth/login.ts#L42-L48@${A}]]

\`\`\`diff
- const user = validateToken(token);
+ const user = await verifyToken(token);
\`\`\`

**Alex — 2026-10-23 12:41+02:00:** This caller can await directly.

**Sam — 2026-10-24 09:20+02:00:** Done.

- [x] Replace the deprecated call

#### [[src/auth/session.ts#L81-L89@${A}]]

**Alex — 2026-10-23 12:44+02:00:** Keep expired and invalid tokens apart.

- [ ] Preserve expired-versus-invalid handling

## Discussion

**Sam — 2026-10-23 09:10+02:00 — requested review:** Ready.

**Alex — 2026-10-23 12:45+02:00 — requested changes at \`${A}\`:** See the verifier topic.

**Frank — 2026-10-24 11:00+02:00 — approved \`${B}\`:** Looks good.

**Frank — yesterday — approved:** Unreadable.
`;

describe("parsePullBody", () => {
  const parsed = parsePullBody(BODY);

  it("reads the description, the topics and their code ranges", () => {
    expect(parsed.description).toBe("Migrate to `verifyToken()`. Implements [[GENBEYA-17]].\n\n- [ ] Update the changelog");
    expect(parsed.topics).toHaveLength(1);
    const [topic] = parsed.topics;
    expect(topic!.title).toBe("Use the new verifier consistently");
    expect(topic!.replies.map((reply) => reply.text)).toEqual(["Several callers need it;\navoid a sync wrapper."]);
    expect(topic!.locations.map((location) => [location.path, location.lines, location.revision])).toEqual([
      ["src/auth/login.ts", { from: 42, to: 48 }, A],
      ["src/auth/session.ts", { from: 81, to: 89 }, A],
    ]);
    expect(topic!.locations[0]!.suggestion).toBe("- const user = validateToken(token);\n+ const user = await verifyToken(token);");
    expect(topic!.locations[0]!.replies.map((reply) => reply.author)).toEqual(["Alex", "Sam"]);
    expect(topic!.locations[1]!.todos).toEqual([
      { text: "Preserve expired-versus-invalid handling", done: false, line: expect.any(Number) },
    ]);
  });

  it("reads verdicts and flags lines it can't read", () => {
    expect(parsed.discussion.map((reply) => [reply.author, reply.verdict])).toEqual([
      ["Sam", { kind: "requested review", revision: null }],
      ["Alex", { kind: "requested changes", revision: A }],
      ["Frank", { kind: "approved", revision: B }],
    ]);
    expect(parsed.unreadable).toEqual(["**Frank — yesterday — approved:** Unreadable."]);
    expect(verdictRevisions(parsed.replies)).toEqual([A, B]);
  });

  it("collects every to-do", () => {
    expect(parsed.todos.map((todo) => [todo.text, todo.done])).toEqual([
      ["Update the changelog", false],
      ["Replace the deprecated call", true],
      ["Preserve expired-versus-invalid handling", false],
    ]);
    expect(openItems(parsed).todos).toHaveLength(2);
    expect(openItems(parsed).topics).toHaveLength(1);
  });

  it("ignores headings and replies in code blocks", () => {
    const body = "```markdown\n## Review\n\n### Not a topic\n**Alex — 2026-10-23 12:40+02:00:** No.\n```\n";
    const code = parsePullBody(body);
    expect(code.topics).toEqual([]);
    expect(code.replies).toEqual([]);
    expect(code.description).toBe(body.trim());
  });
});

describe("writing", () => {
  const reply = { author: "Kim", date: "2026-10-25 10:00+02:00", text: "Agreed." };

  it("writes replies and verdicts as one paragraph", () => {
    expect(replyText({ ...reply, text: "One\n\nTwo" })).toBe("**Kim — 2026-10-25 10:00+02:00:** One\nTwo");
    expect(replyText({ ...reply, verdict: { kind: "approved", revision: B } })).toBe(
      `**Kim — 2026-10-25 10:00+02:00 — approved \`${B}\`:** Agreed.`,
    );
    expect(parsePullBody(replyText({ ...reply, verdict: { kind: "withdrew approval", revision: null } })).replies[0]!.verdict).toEqual({
      kind: "withdrew approval",
      revision: null,
    });
  });

  it("appends to the discussion, adding it when there is none", () => {
    expect(
      addDiscussionReply(BODY, reply).endsWith(
        "**Frank — yesterday — approved:** Unreadable.\n\n**Kim — 2026-10-25 10:00+02:00:** Agreed.\n",
      ),
    ).toBe(true);
    expect(addDiscussionReply("Text.\n", reply)).toBe("Text.\n\n## Discussion\n\n**Kim — 2026-10-25 10:00+02:00:** Agreed.\n");
    expect(addDiscussionReply("", reply)).toBe("## Discussion\n\n**Kim — 2026-10-25 10:00+02:00:** Agreed.\n");
  });

  it("replies to a topic or a code range, before its to-dos", () => {
    const location = parsePullBody(BODY).topics[0]!.locations[0]!;
    const replied = parsePullBody(addReplyAt(BODY, location.line, reply));
    const updated = replied.topics[0]!.locations[0]!;
    expect(updated.replies.map((item) => item.author)).toEqual(["Alex", "Sam", "Kim"]);
    expect(updated.todos[0]!.line).toBeGreaterThan(updated.replies[2]!.line);
    const topic = parsePullBody(addReplyAt(BODY, replied.topics[0]!.line, reply)).topics[0]!;
    expect(topic.replies.map((item) => item.author)).toEqual(["Alex", "Kim"]);
    expect(topic.locations).toHaveLength(2);
  });

  it("adds topics before the discussion, and code ranges to topics", () => {
    const added = addTopic(BODY, "Naming", { reference: `src/a.ts#L1-L2@${B}`, suggestion: "-a\n+b", reply }, null);
    const parsed = parsePullBody(added);
    expect(parsed.topics.map((topic) => topic.title)).toEqual(["Use the new verifier consistently", "Naming"]);
    expect(parsed.topics[1]!.locations[0]!.suggestion).toBe("-a\n+b");
    expect(parsed.discussion).toHaveLength(3);
    const withRange = parsePullBody(addLocation(added, parsed.topics[1]!.line, { reference: "src/b.ts#L3", todo: "Rename" }));
    expect(withRange.topics[1]!.locations.map((location) => location.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(withRange.topics[1]!.locations[1]!.todos[0]!.text).toBe("Rename");

    const fresh = addTopic("Text.\n", "First", null, reply);
    expect(fresh).toBe("Text.\n\n## Review\n\n### First\n\n**Kim — 2026-10-25 10:00+02:00:** Agreed.\n");
  });

  it("ticks, dismisses and promotes to-dos", () => {
    const line = parsePullBody(BODY).todos[0]!.line;
    expect(parsePullBody(setTodo(BODY, line, true)).todos[0]!.done).toBe(true);
    expect(parsePullBody(dismissTodo(BODY, line, "Not needed")).todos[0]!.text).toBe("~~Update the changelog~~ (dismissed: Not needed)");
    expect(parsePullBody(promoteTodo(BODY, line, "GENBEYA-70")).todos[0]!.text).toBe("Update the changelog → [[GENBEYA-70]]");
    expect(() => setTodo(BODY, 0, true)).toThrow();
  });

  it("shortens a topic to its outcome, keeping its verdicts", () => {
    const body = addReplyAt(BODY, parsePullBody(BODY).topics[0]!.line, { ...reply, verdict: { kind: "approved", revision: A } });
    const short = shortenTopic(body, parsePullBody(body).topics[0]!.line, "Every caller awaits now.");
    const topic = parsePullBody(short).topics[0]!;
    expect(topic.outcome).toBe("Every caller awaits now.");
    expect(topic.locations).toEqual([]);
    expect(topic.replies.map((item) => item.verdict?.kind)).toEqual(["approved"]);
    expect(parsePullBody(short).discussion).toHaveLength(3);
    expect(openItems(parsePullBody(short)).topics).toEqual([]);
  });
});

describe("approvalsOf", () => {
  const verdict = (author: string, kind: "approved" | "requested changes" | "withdrew approval", revision: string | null = null) =>
    parsePullBody(replyText({ author, date: "2026-10-25 10:00+02:00", text: "", verdict: { kind, revision } })).replies[0]!;

  it("counts approvals of the change to merge, also after a rebase", () => {
    const changes = new Map([
      [A, "change-1"],
      [B, "change-1"],
    ]);
    const approvals = approvalsOf(
      [verdict("Frank", "approved", A), verdict("Alex", "approved", B)],
      ["Frank", "Alex", "Kim"],
      changes,
      "change-1",
    );
    expect(approvals.effective).toBe(2);
    expect(approvals.waitingFor).toEqual(["Kim"]);
  });

  it("makes approvals of another change stale", () => {
    const approvals = approvalsOf([verdict("Frank", "approved", A)], [], new Map([[A, "change-1"]]), "change-2");
    expect([approvals.effective, approvals.stale]).toEqual([0, 1]);
  });

  it("keeps a request for changes open until its author approves or withdraws", () => {
    const changes = new Map([[A, "change-1"]]);
    expect(approvalsOf([verdict("Alex", "requested changes", A)], [], changes, "change-1").changesRequested).toEqual(["Alex"]);
    const later = [verdict("Alex", "requested changes", A), verdict("Alex", "approved", A.slice(0, 7))];
    expect(approvalsOf(later, [], changes, "change-1")).toMatchObject({ changesRequested: [], effective: 1 });
    const withdrawn = [verdict("Alex", "approved", A), verdict("alex", "withdrew approval")];
    expect(approvalsOf(withdrawn, [], changes, "change-1")).toMatchObject({ changesRequested: [], effective: 0 });
  });

  it("says when it can't tell", () => {
    expect(approvalsOf([verdict("Frank", "approved", A)], [], new Map(), "change-1").reviewers[0]!.approval).toBe("unknown");
  });
});

describe("taskIdsOf", () => {
  it("finds task IDs in the branch, the title and the body", () => {
    expect(
      taskIdsOf({ source: "feature/GENBEYA-17-token", title: "Tokens", body: "See [[genbeya-18]] and GENBEYA-17." }, "GENBEYA"),
    ).toEqual(["GENBEYA-17", "GENBEYA-18"]);
  });
});
