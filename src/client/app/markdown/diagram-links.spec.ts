import { boxAt, mentionsTasks, namedTask } from "./diagram-links";

const tasks = new Map([
  ["PW-6", { id: "PW-6" }],
  ["PW-12", { id: "PW-12" }],
]);

describe("diagram links", () => {
  it("finds the task a label names by its ID, ignoring case and IDs it doesn't know", () => {
    expect(namedTask("pw-6 Publish the release", tasks)).toEqual({ id: "PW-6" });
    expect(namedTask("PW-61 and PW-12", tasks)).toEqual({ id: "PW-12" });
    expect(namedTask("No task here", tasks)).toBeNull();
    expect(mentionsTasks("<svg><text>PW-6</text></svg>", tasks)).toBe(true);
  });

  it("picks the smallest label under the pointer, with a little room around it", () => {
    const boxes = [
      { task: "outer", left: 0, top: 0, width: 200, height: 100 },
      { task: "inner", left: 20, top: 20, width: 50, height: 20 },
    ];
    expect(boxAt(boxes, { x: 30, y: 30 })).toBe("inner");
    expect(boxAt(boxes, { x: 72, y: 42 })).toBe("inner");
    expect(boxAt(boxes, { x: 150, y: 80 })).toBe("outer");
    expect(boxAt(boxes, { x: 300, y: 80 })).toBeNull();
  });
});
