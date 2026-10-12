import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import type { Location } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";

/** "TaskBoard" → "TB", "my project" → "MP", "atlas" → "AT". */
export function initials(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean);
  const capitals = name.match(/[A-Z]/g);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : capitals && capitals.length > 1 ? capitals.join("") : name.slice(0, 2))
    .slice(0, 2)
    .toUpperCase();
}

/** The icon of where a repository lives: this computer, WSL or SSH. */
@Component({
  selector: "gd-host-icon",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @switch (kind()) {
      @case ("ssh") {
        <svg gd-icon name="server" [size]="size()"></svg>
      }
      @case ("wsl") {
        <svg gd-icon name="monitor" [size]="size()"></svg>
      }
      @default {
        <svg gd-icon name="folder-open" [size]="size()"></svg>
      }
    }
  `,
})
export class HostIcon {
  readonly location = input.required<Location>();
  readonly size = input(13);
  protected readonly kind = computed(() => this.location().kind);
}
