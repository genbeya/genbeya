/** Runs async operations strictly one after another; a failure does not stop the queue. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Command lines on Windows are limited to 32K characters. */
export const COMMAND_LINE_BUDGET = 20_000;

/** Splits paths into batches whose command-line length stays within the budget. */
export function splitIntoBatches(paths: readonly string[], budget = COMMAND_LINE_BUDGET): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const path of paths) {
    const cost = path.length + 3;
    if (current.length && size + cost > budget) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(path);
    size += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}
