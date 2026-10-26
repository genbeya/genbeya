/**
 * Files as committed in a revision, for references pinned to one, as
 * read-only documents of the `genbeya-revision` scheme: the path is the
 * file's, so VS Code picks its language; the query is the revision.
 */
import * as vscode from "vscode";
import { pinnedText } from "../../utilities/references";
import type { Repository } from "./repository";

export const REVISION_SCHEME = "genbeya-revision";

export class RevisionFiles implements vscode.TextDocumentContentProvider {
  constructor(private readonly repository: () => Repository | undefined) {}

  /** The document showing `path` as committed in `revision`. */
  static uri(path: string, revision: string): vscode.Uri {
    return vscode.Uri.from({ scheme: REVISION_SCHEME, path: `/${path}`, query: revision });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const repository = this.repository();
    if (!repository) throw new Error("No Genbeya repository is open.");
    const [path, revision] = [uri.path.slice(1), uri.query];
    return pinnedText(await repository.backend.versionControl.fileAt(repository.id, revision, path), path, revision);
  }
}
