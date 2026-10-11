/**
 * `@handle` mentions of the repository's people, as chips with the
 * person's name. Handles nobody has stay text, so an `@` in prose never
 * turns into a broken link.
 */
import type { Root } from "mdast";
import type { Person } from "../../../contracts/model";
import { MENTION, mentioned, peopleIndex } from "../../../utilities/people";
import { avatarHue, initials } from "../ui/avatar";
import { PERSON_LINK } from "./link-target";
import { inline, replaceInProse } from "./prose-text";

export interface MentionOptions {
  /** The people `@handle` can mention. */
  readonly people?: readonly Person[];
}

export function remarkMentions(options: MentionOptions = {}) {
  return (tree: Root) => {
    if (!options.people?.length) return;
    const index = peopleIndex(options.people);
    replaceInProse(tree, MENTION, (match) => {
      const person = mentioned(index, match[1]!);
      if (!person) return null;
      return {
        type: "link",
        url: PERSON_LINK + encodeURIComponent(person.handle),
        title: person.email ? `${person.name} <${person.email}>` : person.name,
        data: { hProperties: { className: ["md-mention"], ariaLabel: `${person.name} (@${person.handle})` } },
        children: [
          inline(`md-mention-avatar avatar-hue-${avatarHue(person.name)}`, initials(person.name)),
          inline("md-mention-name", person.name),
        ],
      };
    });
  };
}
