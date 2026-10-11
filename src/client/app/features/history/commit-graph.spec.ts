import type { Commit } from "../../../../contracts/model";
import { layoutGraph } from "./commit-graph";

const commit = (hash: string, parents: string[]): Commit => ({
  hash,
  parents,
  author: "a",
  email: "",
  date: "2026-01-01T00:00:00Z",
  subject: hash,
  refs: [],
});

describe("layoutGraph", () => {
  it("keeps a straight history on one lane", () => {
    const { rows, lanes } = layoutGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(lanes).toBe(1);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
  });

  it("follows parents and merges", () => {
    // m merges f into c; f and c both descend from r.
    const { rows, lanes } = layoutGraph([commit("m", ["c", "f"]), commit("f", ["r"]), commit("c", ["r"]), commit("r", [])]);
    expect(lanes).toBe(2);
    expect(rows[0]).toMatchObject({ lane: 0, into: [], out: [0, 1] });
    expect(rows[1]).toMatchObject({ lane: 1, into: [1], through: [[0, 0]], out: [1] });
    // c takes over r on lane 0; f's line bends back into it.
    expect(rows[2]).toMatchObject({ lane: 0, into: [0], through: [[1, 0]], out: [0] });
    expect(rows[3]).toMatchObject({ lane: 0, into: [0], through: [], out: [] });
  });

  it("gives unrelated tips their own lanes", () => {
    const { lanes } = layoutGraph([commit("x", ["a"]), commit("y", ["b"]), commit("a", []), commit("b", [])]);
    expect(lanes).toBe(2);
  });
});
