import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icon-data";
import type { PaletteIcon as Kind } from "./palette-items";

const ICONS: Readonly<Record<Kind, IconName>> = {
  page: "book-open",
  wiki: "book-open",
  task: "file-text",
  tasks: "layout-grid",
  file: "file-code-2",
  code: "code-xml",
  changes: "git-commit-horizontal",
  history: "history",
  pulls: "git-pull-request",
  branch: "git-branch",
  "current-branch": "circle-dot",
  "remote-branch": "cloud-download",
  "add-branch": "git-branch-plus",
  merge: "git-merge",
  rebase: "git-pull-request-arrow",
  add: "plus",
  fetch: "refresh-cw",
  sync: "refresh-cw",
  pull: "arrow-down-to-line",
  push: "arrow-up-from-line",
  undo: "undo-2",
  folder: "folder-open",
  local: "folder-open",
  server: "server",
  ssh: "server",
  wsl: "monitor",
  clone: "cloud-download",
  close: "x",
  dark: "moon",
  light: "sun",
  system: "sun-moon",
  minimap: "map",
  keyboard: "keyboard",
  terminal: "square-terminal",
  link: "link",
  tour: "compass",
  news: "sparkles",
  docs: "book-marked",
  search: "search",
};

@Component({
  selector: "gd-palette-icon",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `<svg gd-icon [name]="name()" [size]="15"></svg>`,
})
export class PaletteIcon {
  readonly icon = input.required<Kind>();
  protected readonly name = computed(() => ICONS[this.icon()]);
}
