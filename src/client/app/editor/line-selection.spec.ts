import { Chunk } from "@codemirror/merge";
import { EditorSelection, Text } from "@codemirror/state";
import { chosenLines, chunkLines, selectedLines, wholeChunk, type ChunkLines } from "./line-selection";

const doc = (...lines: string[]) => Text.of(lines);
const range = (from: number, to = from) => ({ from, to });

function chunks(a: Text, b: Text): ChunkLines[] {
  return Chunk.build(a, b).map((chunk) => chunkLines(chunk, a, b));
}

describe("line selection", () => {
  const original = doc("a", "b", "c", "d", "e", "f", "g", "h");
  const modified = doc("a", "B", "B2", "c", "d", "e", "g", "h");
  const changed = chunks(original, modified);

  it("finds the lines of each chunk", () => {
    expect(changed).toEqual([
      { original: range(2), modified: range(2, 3), at: 2 },
      { original: range(6), modified: null, at: 7 },
    ]);
    expect(wholeChunk(changed[0]!)).toEqual({ original: [range(2)], modified: [range(2, 3)] });
  });

  it("chooses removed lines selected in the original", () => {
    expect(chosenLines(changed, [range(1, 6)], [])).toEqual({ original: [range(2), range(6)], modified: [] });
  });

  it("chooses added lines, and the lines they replace once all of them are selected", () => {
    expect(chosenLines(changed, [], [range(3)])).toEqual({ original: [], modified: [range(3)] });
    expect(chosenLines(changed, [], [range(1, 3)])).toEqual({ original: [range(2)], modified: [range(2, 3)] });
  });

  it("chooses a removal where the selection in the modified version touches it", () => {
    expect(chosenLines(changed, [], [range(7)])).toEqual({ original: [range(6)], modified: [] });
    expect(chosenLines(changed, [], [range(6)])).toEqual({ original: [range(6)], modified: [] });
    expect(chosenLines(changed, [], [range(5)])).toBeNull();
  });

  it("chooses nothing for unchanged lines", () => {
    expect(chosenLines(changed, [range(1)], [range(8)])).toBeNull();
  });

  it("reads the lines an editor selection covers", () => {
    const text = doc("one", "two", "three");
    expect(selectedLines(text, EditorSelection.create([EditorSelection.cursor(1)]).ranges)).toEqual([]);
    // A selection ending at the start of a line leaves that line out, as selecting whole lines does.
    expect(selectedLines(text, EditorSelection.create([EditorSelection.range(0, 8)]).ranges)).toEqual([range(1, 2)]);
    expect(selectedLines(text, EditorSelection.create([EditorSelection.range(5, 9)]).ranges)).toEqual([range(2, 3)]);
  });
});
