/**
 * App versions, `major.minor.patch`. Releases bump the patch with every
 * build, so news is kept per release line (`major.minor`).
 */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const VERSION = /^(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?$/;

/** "1.2.3", or "1.2" for a release line (patch 0); null for anything else. */
export function parseVersion(text: unknown): Version | null {
  const match = typeof text === "string" ? VERSION.exec(text.trim()) : null;
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) } : null;
}

/** Negative when `a` is older than `b`, zero when they are the same, positive when `a` is newer. */
export const compareVersions = (a: Version, b: Version): number => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/** The release line a version belongs to: 0.3.17 → 0.3.0. */
export const releaseLine = (version: Version): Version => ({ ...version, patch: 0 });

/** "0.3" for 0.3.17. */
export const formatReleaseLine = (version: Version): string => `${version.major}.${version.minor}`;
