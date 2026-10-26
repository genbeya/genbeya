/**
 * Filling in what rendered Markdown shows of repository files once it is in
 * the page: embedded lines (`![[path#L1-L9]]`, of a revision when pinned)
 * and the state of pinned references. Shared by the app and VS Code's
 * preview, which read files their own ways.
 */
import { fileFragment, parseFileFragment, shortRevision } from "../../../utilities/references";
import { embedSource, sameLines } from "./embeds";
import { resolveHref } from "./link-target";
import { icon, renderMarkdownTree, type Embed } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

/** Where embeds and pinned references read files. */
export interface EmbeddedFiles {
  /** The file in the checkout. */
  file(path: string): Promise<string>;
  /** The file as committed in `revision`; rejects saying what is missing. */
  fileAt(path: string, revision: string): Promise<string>;
}

function note(text: string): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "md-embed-note";
  paragraph.textContent = text;
  return paragraph;
}

/** The short revision a pinned reference or embed shows. */
export function revisionLabel(revision: string): HTMLElement {
  const label = document.createElement("span");
  label.className = "md-ref-rev";
  label.textContent = shortRevision(revision);
  return label;
}

/**
 * Lines of a repository file, highlighted like a code block, under a link
 * to the file. Pinned to a revision, they are that version's, with a note
 * when the file reads differently now. `current` says whether the render the
 * embed belongs to is still shown.
 */
export async function fillEmbed({ element, path, lines, revision }: Embed, files: EmbeddedFiles, current: () => boolean) {
  const title = document.createElement("a");
  title.className = "md-embed-title";
  title.append(icon(document, "fileCode", 13), document.createTextNode(path));
  let body: Node;
  try {
    const [content, now] = revision
      ? await Promise.all([files.fileAt(path, revision), files.file(path).catch(() => null)])
      : [await files.file(path), null];
    const source = embedSource(path, content, lines);
    if (!current()) return;
    title.setAttribute("href", `/${path}#${fileFragment({ lines: source, revision })}`);
    const range = document.createElement("span");
    range.className = "md-ref-lines";
    range.textContent = source.from === source.to ? `:${source.from}` : `:${source.from}–${source.to}`;
    title.append(range);
    if (revision) title.append(revisionLabel(revision));
    body = renderMarkdownTree(parseMarkdown(source.markdown), document, { path, interactiveCheckboxes: false }).fragment;
    if (source.cut) body.appendChild(note("Cut short; open the file for the rest."));
    if (revision && now === null) body.appendChild(note("Not in the checkout any more."));
    else if (revision && now !== null && !sameLines(content, now, lines)) {
      const changed = note(`Changed since ${shortRevision(revision)}. `);
      const link = document.createElement("a");
      link.setAttribute("href", `/${path}#${fileFragment({ lines: source, revision: null })}`);
      link.textContent = "Show the current version";
      changed.append(link);
      body.appendChild(changed);
    }
  } catch (error) {
    if (!current()) return;
    title.setAttribute("href", `/${path}`);
    element.classList.add("is-error");
    body = document.createElement("p");
    body.textContent = error instanceof Error ? error.message : String(error);
  }
  element.replaceChildren(title, body);
}

/**
 * Marks a pinned reference (`a.md-ref-pinned`, in a document at `from`) whose
 * lines read differently in the checkout, and one whose revision or file is
 * missing, with the reason as its tooltip.
 */
export async function checkPinned(link: HTMLAnchorElement, from: string, files: EmbeddedFiles, current: () => boolean) {
  const target = resolveHref(from, link.getAttribute("href") ?? "");
  if (target.kind !== "file") return;
  const { lines, revision } = parseFileFragment(target.anchor);
  if (!revision) return;
  try {
    const [pinned, now] = await Promise.all([files.fileAt(target.path, revision), files.file(target.path).catch(() => null)]);
    if (!current() || (now !== null && sameLines(pinned, now, lines && `${lines.from}-${lines.to}`))) return;
    link.classList.add("is-outdated");
    link.title += now === null ? "; not in the checkout any more" : "; changed since";
  } catch (error) {
    if (!current()) return;
    link.classList.add("md-ref-missing");
    link.title = error instanceof Error ? error.message : String(error);
  }
}
