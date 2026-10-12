/**
 * A Genbeya link names an item of a repository by the repository's remote
 * URL, so a coworker's Genbeya can open it in their own clone:
 * `genbeya://open?remote=<url>&task=GENBEYA-12`. Shells hand links over as launch
 * arguments; src/utilities/genbeya-link.ts formats and parses them.
 */

/** Something a link can point at: pages and files by path, tasks by ID, commits by hash. */
export type LinkItem =
  | { readonly kind: "page"; readonly path: string }
  | { readonly kind: "task"; readonly id: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "commit"; readonly hash: string };

export interface GenbeyaLink {
  /** A remote URL of the repository, as the clone that shared the link has it. */
  readonly remote: string;
  readonly item: LinkItem;
}

/** Links start with this; the app's own pages live on `genbeya://app/` (Electron) and never take part. */
export const GENBEYA_LINK_PREFIX = "genbeya://open";
