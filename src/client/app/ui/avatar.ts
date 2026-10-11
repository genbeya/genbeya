import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

/** How many avatar colours the tokens define (`--avatar-0` …). */
const HUES = 8;

/** "Ada Lovelace" → "AL", "sam" → "S". */
export const initials = (name: string): string =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

/** The colour of a name's avatar, 0 to 7, the same wherever the person shows. */
export function avatarHue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % HUES;
}

/** Initials on a colour derived from the name, so a person keeps their colour everywhere. */
@Component({
  selector: "gd-avatar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "avatar",
    "[attr.title]": "name()",
    "[style.width.px]": "size()",
    "[style.height.px]": "size()",
    "[style.font-size.px]": "size() * 0.42",
    "[style.background]": "color()",
  },
  template: `{{ initials() }}`,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(20);
  protected readonly initials = computed(() => initials(this.name()));
  protected readonly color = computed(() => `var(--avatar-${avatarHue(this.name())})`);
}
