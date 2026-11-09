/**
 * Genbeya on GitHub, at `/github/<owner>/<repo>` on genbeya.fyi: before anything is requested, a notice
 * says what the page asks GitHub for. Once the visitor agrees, the repository is read into the page and
 * the client runs on it with the web demo's managers (`src/managers/demo/github-backend.ts`). A token for
 * a private repository is used while the files are read, and then dropped.
 *
 * The notice is plain DOM, shown before the client starts, so nothing of the app runs before the visitor
 * has agreed.
 */
import type { Fetch } from "../../../access/github/github-reader";
import { openGitHubBackend, type GitHubBackend } from "../../../managers/demo/github-backend";
import { gitHubAddressPath, parseGitHubAddress, type GitHubAddress } from "../../../utilities/github-address";
import { connectDemo, type DemoPage } from "./demo-connector";
import type { DemoAbout, Platform } from "./platform";

export const PRIVACY_URL = "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement";

const browserFetch: Fetch = (url, init) => globalThis.fetch(url, init);

export async function connectGitHub(page: DemoPage = window, fetch: Fetch = browserFetch): Promise<Platform> {
  const screen = new StartScreen(page);
  const address = parseGitHubAddress(page.location.pathname, page.location.search);
  if (!address) return screen.choose();
  const backend = await screen.notice(address, (token, progress) => openGitHubBackend(address, { fetch, token, progress }));
  screen.remove();
  return connectDemo(page, backend.managers, aboutGitHub(backend));
}

/** What the badge says about the repository. */
export function aboutGitHub({ snapshot: { tree, unread } }: GitHubBackend): DemoAbout {
  const label = `${tree.owner}/${tree.name}`;
  const skipped = tree.skipped.length;
  const missing = [
    unread
      ? `Code has the files the wiki and the tasks refer to; ${unread === 1 ? "one other stays" : `${unread} others stay`} on GitHub.`
      : "",
    skipped ? `${skipped === 1 ? "One entry is" : `${skipped} entries are`} left out: links, submodules or files over a megabyte.` : "",
    tree.truncated ? "GitHub listed only part of the repository's files." : "",
  ].filter(Boolean);
  const branch = tree.branch === tree.defaultBranch ? "" : `/tree/${tree.branch.split("/").map(encodeURIComponent).join("/")}`;
  return {
    title: "About this page",
    pill: "GitHub",
    caption: label,
    note: [
      `Genbeya runs here in your browser, on ${label} as it is on GitHub: ${tree.branch} at ${tree.commit.sha.slice(0, 7)}.`,
      "What you change stays in this tab. Nothing is written back to GitHub, and reading the repository again starts over.",
      ...missing,
    ].join(" "),
    reset: {
      label: "Read again from GitHub",
      title: `Read ${label} again?`,
      message: "Everything you changed goes, and the repository is read from GitHub as it is now.",
    },
    link: { label: "Open on GitHub", url: tree.webUrl + branch },
  };
}

type Load = (token: string | undefined, progress: (read: number, total: number) => void) => Promise<GitHubBackend>;

/** The page before the client starts: the notice, the progress of reading, and what went wrong. */
class StartScreen {
  private readonly document: Document;
  private readonly root: HTMLElement;

  constructor(private readonly page: DemoPage) {
    this.document = page.document;
    this.root = this.element("main", { className: "gh-start" });
    this.document.body.append(this.root);
  }

  /** Asks for a repository when the address names none; opening one loads the page again. */
  choose(): Promise<never> {
    this.page.document.title = "Genbeya on GitHub";
    const card = this.card("Open a GitHub repository", "Its wiki, its task board and its code, read from GitHub into your browser.");
    const form = this.element("form", { className: "gh-form" });
    const label = this.element("label", { textContent: "Repository", htmlFor: "gh-repository" });
    const input = this.element("input", {
      id: "gh-repository",
      placeholder: "owner/repository",
      autocomplete: "off",
      spellcheck: false,
      required: true,
    });
    const error = this.element("p", { className: "gh-error", hidden: true });
    error.setAttribute("role", "alert");
    form.append(
      label,
      input,
      error,
      this.actions(this.element("button", { className: "btn btn-primary", type: "submit", textContent: "Continue" })),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim().replace(/^https:\/\/github\.com\//, "");
      const address = parseGitHubAddress("", `?repo=${encodeURIComponent(value)}`);
      if (!address) {
        error.textContent = "Enter a repository as owner/repository, such as genbeya/genbeya.";
        error.hidden = false;
        return;
      }
      const { pathname } = this.page.location;
      this.page.location.replace(
        /\/github\/?$/.test(pathname)
          ? pathname.replace(/\/github\/?$/, gitHubAddressPath(address))
          : `${pathname}?repo=${address.owner}/${address.name}`,
      );
    });
    card.append(form);
    input.focus();
    return new Promise<never>(() => undefined);
  }

  /** Says what the page requests, and reads the repository once the visitor agrees. */
  notice(address: GitHubAddress, load: Load): Promise<GitHubBackend> {
    const label = `${address.owner}/${address.name}`;
    this.page.document.title = `${label} · Genbeya`;
    const card = this.card(label, address.branch ? `Branch ${address.branch}` : "");
    card.append(
      this.text("Genbeya opens this repository here in your browser: its wiki, its task board and its code, as they are on GitHub now."),
      this.element("h2", { textContent: "What this page requests" }),
    );
    const privacy = this.element("a", {
      href: PRIVACY_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      textContent: "GitHub's privacy statement",
    });
    const list = this.element("ul");
    list.append(
      this.item(
        "Your browser reads the repository's files from GitHub, at api.github.com and raw.githubusercontent.com, as it does when you browse them on github.com. ",
        privacy,
        " applies to those requests.",
      ),
      this.item("Nothing goes anywhere else: genbeya.fyi receives nothing, and nothing is stored in your browser."),
      this.item(
        "What you change stays in this tab. Nothing is written back to GitHub, and loading the page again reads the repository again.",
      ),
    );
    card.append(list);

    const form = this.element("form", { className: "gh-form" });
    const details = this.element("details");
    const token = this.element("input", { id: "gh-token", type: "password", autocomplete: "off", spellcheck: false });
    details.append(
      this.element("summary", { textContent: "Private repository?" }),
      this.element("label", { textContent: "Token", htmlFor: "gh-token" }),
      token,
      this.text(
        "A fine-grained personal access token that may read the repository's contents. It goes only to api.github.com, is used while the files are read, and is then forgotten.",
        "gh-hint",
      ),
    );
    const status = this.element("p", { className: "gh-status" });
    status.setAttribute("role", "status");
    const error = this.element("p", { className: "gh-error", hidden: true });
    error.setAttribute("role", "alert");
    const open = this.element("button", { className: "btn btn-primary", type: "submit", textContent: "Open repository" });
    const github = this.element("a", {
      className: "btn",
      href: `https://github.com${gitHubAddressPath(address).slice("/github".length)}`,
      target: "_blank",
      rel: "noopener noreferrer",
      textContent: "View on GitHub",
    });
    form.append(details, status, error, this.actions(open, github));
    card.append(form);
    open.focus();

    return new Promise((resolve) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (open.disabled) return;
        open.disabled = token.disabled = true;
        error.hidden = true;
        status.textContent = "Reading the repository from GitHub…";
        const secret = token.value.trim() || undefined;
        load(
          secret,
          (read, total) =>
            (status.textContent = total ? `Reading files from GitHub: ${read} of ${total}` : "Reading the repository from GitHub…"),
        )
          .then(resolve)
          .catch((failure: unknown) => {
            status.textContent = "";
            error.textContent = failure instanceof Error ? failure.message : String(failure);
            error.hidden = false;
            if (!secret && /token/.test(error.textContent)) details.open = true;
            open.disabled = token.disabled = false;
          });
      });
    });
  }

  remove(): void {
    this.root.remove();
  }

  private card(title: string, subtitle: string): HTMLElement {
    const card = this.element("section", { className: "gh-card" });
    card.setAttribute("aria-labelledby", "gh-title");
    card.append(
      this.element("p", { className: "gh-eyebrow", textContent: "Genbeya on GitHub" }),
      this.element("h1", { id: "gh-title", textContent: title }),
    );
    if (subtitle) card.append(this.text(subtitle, "gh-subtitle"));
    this.root.append(card);
    return card;
  }

  private actions(...buttons: HTMLElement[]): HTMLElement {
    const row = this.element("div", { className: "gh-actions" });
    row.append(...buttons);
    return row;
  }

  private text(text: string, className = ""): HTMLElement {
    return this.element("p", { textContent: text, className });
  }

  private item(...parts: (string | Node)[]): HTMLElement {
    const item = this.element("li");
    item.append(...parts);
    return item;
  }

  private element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    properties: Partial<HTMLElementTagNameMap[K]> = {},
  ): HTMLElementTagNameMap[K] {
    return Object.assign(this.document.createElement(tag), properties);
  }
}
