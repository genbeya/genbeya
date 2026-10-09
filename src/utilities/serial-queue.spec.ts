import { describe, expect, it } from "vitest";
import { SerialQueue, splitIntoBatches } from "./serial-queue";

describe("SerialQueue", () => {
  it("runs operations one at a time, in order", async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const slow = queue.run(async () => {
      events.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("a:end");
      return "a";
    });
    const fast = queue.run(async () => {
      events.push("b");
      return "b";
    });
    expect(await Promise.all([slow, fast])).toEqual(["a", "b"]);
    expect(events).toEqual(["a:start", "a:end", "b"]);
  });

  it("keeps going after a failure", async () => {
    const queue = new SerialQueue();
    await expect(queue.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await queue.run(async () => 1)).toBe(1);
  });
});

describe("splitIntoBatches", () => {
  it("keeps each batch within the budget", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `file-${i}.txt`);
    const batches = splitIntoBatches(paths, 40);
    expect(batches.flat()).toEqual(paths);
    for (const batch of batches) expect(batch.reduce((size, p) => size + p.length + 3, 0)).toBeLessThanOrEqual(40);
  });

  it("never returns empty batches", () => {
    expect(splitIntoBatches([], 10)).toEqual([]);
    expect(splitIntoBatches(["a-very-long-path"], 5)).toEqual([["a-very-long-path"]]);
  });
});
