import { embedSource, MAX_EMBED_LINES } from "./embeds";

const file = ["one", "two", "three", "four"].join("\r\n") + "\r\n";

describe("embedSource", () => {
  it("fences the requested lines in the file's language", () => {
    expect(embedSource("src/app.ts", file, "2-3")).toEqual({ markdown: "```ts\ntwo\nthree\n```\n", from: 2, to: 3, cut: false });
    expect(embedSource("Dockerfile", "FROM x\n", null).markdown).toBe("```dockerfile\nFROM x\n```\n");
    expect(embedSource("notes.weird", "a\n", null).markdown).toBe("```text\na\n```\n");
  });

  it("embeds the whole file without lines and clamps ranges past its end", () => {
    expect(embedSource("a.ts", file, null)).toMatchObject({ from: 1, to: 4 });
    expect(embedSource("a.ts", file, "3-99")).toMatchObject({ from: 3, to: 4, cut: false });
    expect(() => embedSource("a.ts", file, "9-12")).toThrow("a.ts has only 4 lines.");
  });

  it("keeps code with backtick fences intact and cuts very long ranges", () => {
    expect(embedSource("README.md", "```js\nx\n```\n", null).markdown).toBe("````md\n```js\nx\n```\n````\n");
    const long = Array.from({ length: MAX_EMBED_LINES + 10 }, (_, i) => `line ${i}`).join("\n");
    expect(embedSource("a.ts", long, null)).toMatchObject({ from: 1, to: MAX_EMBED_LINES, cut: true });
  });
});
