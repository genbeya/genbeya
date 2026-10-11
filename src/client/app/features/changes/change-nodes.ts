/** Changed files as a folder tree, for the tree view of the change lists. */
import type { Change } from "../../../../contracts/model";

export interface FolderNode {
  readonly kind: "folder";
  /** The folder's path; the last of a chain of folders shown as one. */
  readonly path: string;
  /** Its name, or the names of a chain of single folders: "src/client/app". */
  readonly label: string;
  /** Every change below it. */
  readonly changes: readonly Change[];
  readonly children: readonly ChangeNode[];
}

export interface FileNode {
  readonly kind: "file";
  readonly change: Change;
}

export type ChangeNode = FolderNode | FileNode;

interface Building {
  readonly folders: Map<string, Building>;
  readonly files: Change[];
  readonly changes: Change[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Folders first, then files, each by name. A folder holding nothing but
 * one folder is shown together with it, so deep paths take one row.
 */
export function changeTree(changes: readonly Change[]): ChangeNode[] {
  const root: Building = { folders: new Map(), files: [], changes: [] };
  for (const change of changes) {
    const parts = change.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part);
      if (!next) folder.folders.set(part, (next = { folders: new Map(), files: [], changes: [] }));
      next.changes.push(change);
      folder = next;
    }
    folder.files.push(change);
  }
  const nodes = (folder: Building, prefix: string): ChangeNode[] => [
    ...[...folder.folders.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, child]): FolderNode => {
        let label = name;
        let path = prefix + name;
        let current = child;
        while (current.files.length === 0 && current.folders.size === 1) {
          const [[next, only]] = [...current.folders.entries()] as [[string, Building]];
          label += `/${next}`;
          path += `/${next}`;
          current = only;
        }
        return { kind: "folder", path, label, changes: child.changes, children: nodes(current, `${path}/`) };
      }),
    ...folder.files.sort((a, b) => byName(nameOf(a.path), nameOf(b.path))).map((change): FileNode => ({ kind: "file", change })),
  ];
  return nodes(root, "");
}
