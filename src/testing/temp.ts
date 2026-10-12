/** Disposable folders for tests, below .test-work/ unless they must be outside any repository. */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";

const BASE = path.resolve(".test-work");

/** A fresh folder; `outsideRepository` puts it in the system temp folder, away from this repository. */
export async function temporaryFolder(prefix = "t-", outsideRepository = false): Promise<string> {
  const base = outsideRepository ? await fs.realpath(tmpdir()) : BASE;
  await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, `genbeya-${prefix}`));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined));
  return folder;
}
