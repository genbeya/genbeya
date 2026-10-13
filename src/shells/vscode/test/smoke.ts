/**
 * Runs inside VS Code's extension host (scripts/test-vscode.mjs starts it on
 * a sample repository): the extension opens the repository, shows its pages
 * and tasks, and saves through the content file system.
 */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import type { GenbeyaApi } from "../extension";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<GenbeyaApi>("genbeya.genbeya");
  assert.ok(extension, "the extension is installed");
  const api = await extension.activate();
  const folder = vscode.workspace.workspaceFolders![0]!.uri;

  const snapshot = api.snapshot();
  assert.ok(snapshot, "the repository is open");
  assert.deepEqual(
    snapshot.tasks.map((task) => [task.id, task.status]),
    [["SMOKE-1", "todo"]],
  );
  assert.deepEqual(
    snapshot.wiki.map((page) => page.title),
    ["Home"],
  );

  const commands = await vscode.commands.getCommands(true);
  for (const command of ["genbeya.newTask", "genbeya.newPage", "genbeya.setStatus", "genbeya.refresh"]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }

  // A save through the content file system reaches the file and the next snapshot.
  const task = vscode.Uri.from({ scheme: "genbeya-content", path: "/tasks/SMOKE-1.md" });
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(task));
  await vscode.workspace.fs.writeFile(task, new TextEncoder().encode(text.replace("status: todo", "status: done")));
  assert.match(await readFile(join(folder.fsPath, "tasks", "SMOKE-1.md"), "utf8"), /status: done/);
  await api.refresh();
  assert.equal(api.snapshot()!.tasks[0]!.status, "done");

  // A save based on an outdated version fails instead of overwriting the newer one.
  const page = vscode.Uri.from({ scheme: "genbeya-content", path: "/docs/Home.md" });
  await vscode.workspace.fs.readFile(page);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder, "docs", "Home.md"),
    new TextEncoder().encode("# Home\n\nChanged elsewhere.\n"),
  );
  await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(page, new TextEncoder().encode("# Home\n\nStale.\n"))));
}
