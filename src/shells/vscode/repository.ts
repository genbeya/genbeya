/**
 * The repository a VS Code window shows: opened with the managers, and its
 * snapshot polled like the client polls it, while the window has focus.
 */
import * as vscode from "vscode";
import type { ContentArea, Snapshot } from "../../contracts/model";
import { locationOfFolder } from "../../access/hosts/host-factory";
import type { Backend } from "../../managers/backend";
import { CONTENT_SCHEME } from "./content-files";

const POLL_INTERVAL = 4000;

export class Repository implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Snapshot>();
  /** Fires with each new snapshot. */
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [this.changed];
  private refreshing: Promise<void> | null = null;

  private constructor(
    readonly backend: Backend,
    /** The workspace ID the managers know the repository by. */
    readonly id: string,
    readonly folder: vscode.Uri,
    private current: Snapshot,
  ) {
    const timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh();
    }, POLL_INTERVAL);
    this.subscriptions.push(
      { dispose: () => clearInterval(timer) },
      vscode.window.onDidChangeWindowState((state) => state.focused && void this.refresh()),
      vscode.workspace.onDidSaveTextDocument(() => void this.refresh()),
    );
  }

  /** Opens the Git repository in `folder`; fails when it is none. */
  static async open(backend: Backend, folder: vscode.Uri): Promise<Repository> {
    const { id, snapshot } = await backend.workspace.open(locationOfFolder(folder.fsPath));
    return new Repository(backend, id, folder, snapshot);
  }

  get snapshot(): Snapshot {
    return this.current;
  }

  /** Takes a new snapshot if anything changed; concurrent calls share one. */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const next = await this.backend.workspace.snapshot(this.id, this.current.version);
        if (next) {
          this.current = next;
          this.changed.fire(next);
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * The document of a page or task. Areas in the checkout are plain files;
   * areas on the content branch go through the managers, which commit each save there.
   */
  uri(area: ContentArea, path: string): vscode.Uri {
    return this.current.storage.areas[area] === "checkout"
      ? vscode.Uri.joinPath(this.folder, path)
      : vscode.Uri.from({ scheme: CONTENT_SCHEME, path: `/${path}` });
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.dispose();
    void this.backend.workspace.close(this.id).catch(() => undefined);
  }
}
