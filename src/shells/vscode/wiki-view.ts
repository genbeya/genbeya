/** The Wiki view: the page tree of the snapshot. A page opens in the preview; its Edit action opens it in the editor. */
import * as vscode from "vscode";
import type { WikiNode } from "../../contracts/model";
import type { Repository } from "./repository";

export const PREVIEW_COMMAND = "genbeya.preview";

export class WikiView implements vscode.TreeDataProvider<WikiNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly repository: () => Repository | undefined) {}

  /** Redraws the tree, after the snapshot changed. */
  refresh() {
    this.changed.fire();
  }

  getChildren(node?: WikiNode): WikiNode[] {
    return [...(node ? node.children : (this.repository()?.snapshot.wiki ?? []))];
  }

  getTreeItem(node: WikiNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.title,
      node.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    // IDs keep each page's expanded state across snapshots.
    item.id = node.path ?? `${node.folder}/`;
    const repository = this.repository();
    if (node.path && repository) {
      item.resourceUri = repository.uri("wiki", node.path);
      item.iconPath = new vscode.ThemeIcon("file-text");
      item.contextValue = "page";
      item.tooltip = node.path;
      item.command = { command: PREVIEW_COMMAND, title: "Preview", arguments: [node] };
    } else {
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = "folder";
    }
    return item;
  }
}
