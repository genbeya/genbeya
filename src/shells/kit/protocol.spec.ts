import { describe, expect, it } from "vitest";
import { checkFromKit, parseToKit, ProtocolError, type FromKit, type ToKit } from "./protocol";

const json = (value: unknown) => JSON.stringify(value);

describe("parseToKit", () => {
  const valid: ToKit[] = [
    {
      type: "context",
      parts: {
        wiki: { version: "1", value: [] },
        files: { version: "7", value: ["src/app.ts"] },
        settings: { version: "2", value: { wikiRoot: "docs", statuses: ["todo", "done"] } },
        author: { version: "3", value: null },
      },
    },
    { type: "theme", mode: "light", tokens: { "bg-app": "#ffffff", "font-ui": '"Inter Variable", system-ui' } },
    { type: "preview", document: { kind: "page", path: "docs/Home.md", title: "Home", source: "# Home", hash: "a1" } },
    { type: "preview", document: { kind: "markdown", area: "pulls", path: "pulls/PR-1.md", source: "", hash: "b2" } },
    { type: "preview", document: { kind: "markdown", area: "pulls", path: "pulls/PR-1.md", source: "", hash: "b2", checkboxes: false } },
    { type: "preview", document: { kind: "markdown", area: "pulls", path: "pulls/PR-1.md", source: "", hash: "b2", checkboxes: true } },
    { type: "reveal", id: "use-the-new-verifier" },
    {
      type: "preview",
      document: {
        kind: "task",
        task: {
          id: "GENBEYA-1",
          path: "tasks/GENBEYA-1.md",
          title: "One",
          status: "todo",
          priority: "",
          assignee: "",
          labels: [],
          type: "",
          fields: {},
          body: "",
          epic: "",
          hash: "c3",
          comments: [],
        },
      },
    },
    { type: "edit", area: "wiki", path: "docs/Home.md", text: "# Home", hash: "a1", readOnly: false },
    { type: "editorCommand", command: "insert", text: "@sam" },
    { type: "editorCommand", command: "undo" },
    { type: "reply", id: 4, value: "data:image/png;base64,AA==" },
    { type: "reply", id: 5, error: "No such file." },
  ];

  it("takes every message of the protocol", () => {
    for (const message of valid) expect(parseToKit(json(message))).toEqual(message);
  });

  it.each([
    ["not JSON", "{", "The message is not JSON."],
    ["an unknown type", json({ type: "launch" }), "launch is not a message the kit takes."],
    ["an unknown context part", json({ type: "context", parts: { secrets: { version: "1", value: [] } } }), "context.parts.secrets"],
    ["a part without a version", json({ type: "context", parts: { files: { value: [] } } }), "context.parts.files.version"],
    ["a token that ends its declaration", json({ type: "theme", mode: "dark", tokens: { "bg-app": "red; }" } }), "theme.tokens.bg-app"],
    ["a token name with markup", json({ type: "theme", mode: "dark", tokens: { "a<b": "red" } }), "theme.tokens.a<b"],
    ["a document of another kind", json({ type: "preview", document: { kind: "board" } }), "preview.document.kind"],
    ["a page without its hash", json({ type: "preview", document: { kind: "page", path: "a.md", title: "A", source: "" } }), "hash"],
    ["an area that isn't one", json({ type: "edit", area: "code", path: "a", text: "", hash: "h", readOnly: false }), "edit.area"],
    ["an unknown editor command", json({ type: "editorCommand", command: "format" }), "editorCommand.command"],
    ["insert without text", json({ type: "editorCommand", command: "insert" }), "editorCommand.text"],
    ["a reply without an ID", json({ type: "reply", value: "x" }), "reply.id"],
    ["a reveal of a number", json({ type: "reveal", id: 3 }), "reveal.id"],
    ["a reveal of a 301-character id", json({ type: "reveal", id: "a".repeat(301) }), "reveal.id"],
    [
      "checkboxes that aren't true or false",
      json({ type: "preview", document: { kind: "markdown", area: "pulls", path: "a.md", source: "", hash: "h", checkboxes: "no" } }),
      "preview.document.checkboxes",
    ],
  ])("refuses %s", (_, message, problem) => {
    expect(() => parseToKit(message)).toThrow(ProtocolError);
    expect(() => parseToKit(message)).toThrow(problem);
  });
});

describe("checkFromKit", () => {
  const valid: FromKit[] = [
    { type: "ready", protocol: 1, genbeya: "0.2.1" },
    { type: "follow", link: { kind: "external", url: "https://genbeya.fyi" } },
    { type: "follow", link: { kind: "file", path: "tasks/GENBEYA-1.md", anchor: undefined } },
    { type: "follow", link: { kind: "missing", title: "Nowhere" } },
    { type: "follow", link: { kind: "person", handle: "sam" } },
    { type: "toggle", area: "wiki", path: "docs/Home.md", hash: "a1", offset: 12 },
    { type: "image", id: 1, path: "docs/logo.png" },
    { type: "file", id: 2, path: "src/app.ts" },
    { type: "fileAt", id: 3, path: "src/app.ts", revision: "v1.0" },
    { type: "planHistory", id: 4, baseline: null },
    { type: "planHistory", id: 5, baseline: "v1.0" },
    { type: "height", height: 480 },
    { type: "outline", path: "docs/Home.md", headings: [] },
    {
      type: "outline",
      path: "docs/Home.md",
      headings: [
        { level: 1, text: "Home", id: "home" },
        { level: 3, text: "Ça va?", id: "ça-va" },
      ],
    },
    { type: "draft", path: "docs/Home.md", hash: "a1", text: "# Home!" },
    { type: "save", path: "docs/Home.md", hash: "a1", text: "# Home!" },
    { type: "editorState", path: "docs/Home.md", dirty: true, selection: { from: 0, to: 4 }, completing: false },
    { type: "error", message: "launch is not a message the kit takes." },
  ];

  it("passes every message of the protocol", () => {
    for (const message of valid) expect(checkFromKit(JSON.parse(json(message)))).toEqual(JSON.parse(json(message)));
  });

  it.each([
    ["an unknown type", { type: "write", path: "x" }],
    ["a toggle without the version shown", { type: "toggle", area: "wiki", path: "a.md", offset: 1 }],
    ["a negative offset", { type: "toggle", area: "wiki", path: "a.md", hash: "h", offset: -1 }],
    ["a request without an ID", { type: "image", path: "a.png" }],
    ["a link of another kind", { type: "follow", link: { kind: "command", run: "rm" } }],
    ["a height that isn't whole", { type: "height", height: 1.5 }],
    ["an editor state without its selection", { type: "editorState", path: "a", dirty: false, completing: false }],
    ["an outline heading of level 7", { type: "outline", path: "a.md", headings: [{ level: 7, text: "Deep", id: "deep" }] }],
    [
      "an outline of 501 headings",
      { type: "outline", path: "a.md", headings: Array.from({ length: 501 }, (_, i) => ({ level: 2, text: `H${i}`, id: `h${i}` })) },
    ],
    ["an outline without its path", { type: "outline", headings: [] }],
  ])("refuses %s", (_, message) => {
    expect(() => checkFromKit(message)).toThrow(ProtocolError);
  });
});
