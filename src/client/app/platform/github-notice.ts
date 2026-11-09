/**
 * The page Genbeya on GitHub shows before anything else: what the page requests and from whom, and the
 * choices the visitor has. Nothing is requested from GitHub and nothing is kept until the visitor chooses
 * so here. It is plain DOM, shown before the client starts, so none of the app runs before then.
 */
import { gitHubAddressPath, parseGitHubAddress, type GitHubAddress } from "../../../utilities/github-address";

export const PRIVACY_URL = "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement";

/** What the start screen needs of the page. */
export type NoticePage = Pick<Window, "document" | "location" | "history" | "confirm">;

/** A repository kept in this browser, as the start screen shows it. */
export interface KeptCopy {
  /** Where it opens, such as `/github/acme/rockets`. */
  readonly path: string;
  /** owner/repository */
  readonly label: string;
  /** Such as "Branch main at 1a2b3c4, saved 9 Nov 2026, 10:01". */
  readonly description: string;
}

/** Everything this browser keeps for Genbeya on GitHub. */
export interface KeptTotal {
  readonly count: number;
  readonly bytes: number;
}

export interface NoticeChoices<T> {
  /** Whether this browser can keep files for the page. */
  readonly canKeep: boolean;
  /** This repository's kept copy, if there is one. */
  readonly kept: KeptCopy | null;
  readonly total: KeptTotal | null;
  /** Reads the repository from GitHub, once the visitor agreed; keeps it if `keep`. */
  read(token: string | undefined, keep: boolean, progress: (read: number, total: number) => void): Promise<T>;
  /** Opens the kept copy, asking nothing of GitHub. */
  openKept(): Promise<T>;
  deleteKept(): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface ChooseChoices {
  readonly kept: readonly KeptCopy[];
  readonly total: KeptTotal | null;
  deleteAll(): Promise<void>;
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toLocaleString("en", { maximumFractionDigits: 1 })} MB`;

export class StartScreen {
  private readonly document: Document;
  private readonly root: HTMLElement;

  constructor(private readonly page: NoticePage) {
    this.document = page.document;
    this.root = this.element("main", { className: "gh-start" });
    this.document.body.append(this.root);
  }

  /** Asks for a repository when the address names none; opening one loads the page again. */
  choose({ kept, total, deleteAll }: ChooseChoices): Promise<never> {
    this.page.document.title = "Genbeya on GitHub";
    this.root.replaceChildren();
    const card = this.card("Open a GitHub repository", "Its wiki, its task board and its code, read from GitHub into your browser.");
    const form = this.element("form", { className: "gh-form" });
    const input = this.element("input", {
      id: "gh-repository",
      placeholder: "owner/repository",
      autocomplete: "off",
      spellcheck: false,
      required: true,
    });
    const error = this.alert();
    form.append(
      this.element("label", { textContent: "Repository", htmlFor: "gh-repository" }),
      input,
      error,
      this.actions(this.element("button", { className: "btn btn-primary", type: "submit", textContent: "Continue" })),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim().replace(/^https:\/\/github\.com\//, "");
      const address = parseGitHubAddress("", `?repo=${encodeURIComponent(value)}`);
      if (!address) return this.show(error, "Enter a repository as owner/repository, such as genbeya/genbeya.");
      this.go(address);
    });
    card.append(form);
    if (kept.length) {
      const list = this.element("ul", { className: "gh-kept-list" });
      for (const copy of kept) {
        const link = this.element("a", { textContent: copy.label, href: "#" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.page.location.replace(this.addressOf(copy.path));
        });
        list.append(this.item(link, ` · ${copy.description}`));
      }
      card.append(this.element("h2", { textContent: "Kept in this browser" }), list);
    }
    this.footer(card, total, deleteAll, () => this.choose({ kept: [], total: null, deleteAll }));
    input.focus();
    return new Promise<never>(() => undefined);
  }

  /** Says what the page requests and keeps, and resolves once the visitor has chosen and the repository is open. */
  notice<T>(address: GitHubAddress, choices: NoticeChoices<T>): Promise<T> {
    const label = `${address.owner}/${address.name}`;
    this.page.document.title = `${label} · Genbeya`;
    this.root.replaceChildren();
    const card = this.card(label, address.branch ? `Branch ${address.branch}` : "");
    card.append(
      this.text("Genbeya opens this repository here in your browser: its wiki, its task board and its code, as they are on GitHub now."),
      this.element("h2", { textContent: "What happens when you open it" }),
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
        "Your browser asks GitHub for the repository's files, at api.github.com and raw.githubusercontent.com. GitHub sees your IP address and that the requests come from a page on genbeya.fyi, which browsers tell sites with every such request, and processes them under ",
        privacy,
        ", also in the United States.",
      ),
      this.item("Nothing goes anywhere else: genbeya.fyi receives nothing, and nothing on this page tracks you."),
      this.item("What you change stays in this browser. Nothing is written back to GitHub."),
    );
    card.append(list);

    return new Promise<T>((resolve) => {
      const busy: (HTMLButtonElement | HTMLInputElement)[] = [];
      const status = this.element("p", { className: "gh-status" });
      status.setAttribute("role", "status");
      const error = this.alert();
      const run = (work: () => Promise<T>, message: string) => {
        if (busy.some((control) => control.disabled)) return;
        for (const control of busy) control.disabled = true;
        error.hidden = true;
        status.textContent = message;
        work()
          .then(resolve)
          .catch((failure: unknown) => {
            status.textContent = "";
            this.show(error, failure instanceof Error ? failure.message : String(failure));
            if (!token.value && /token/.test(error.textContent ?? "")) details.open = true;
            for (const control of busy) control.disabled = false;
          });
      };

      if (choices.kept) {
        const kept = this.element("section", { className: "gh-kept" });
        kept.setAttribute("aria-labelledby", "gh-kept-title");
        const open = this.element("button", { className: "btn btn-primary", type: "button", textContent: "Open kept copy" });
        const remove = this.element("button", { className: "btn", type: "button", textContent: "Delete kept copy" });
        busy.push(open, remove);
        open.addEventListener("click", () => run(choices.openKept, "Opening the kept copy…"));
        remove.addEventListener("click", () => {
          if (!this.page.confirm(`Delete the kept copy of ${label} from this browser, with your changes?`)) return;
          void choices.deleteKept().then(() => this.notice(address, { ...choices, kept: null }).then(resolve));
        });
        kept.append(
          this.element("h2", { id: "gh-kept-title", textContent: "Kept in this browser" }),
          this.text(`${choices.kept.description}, with your changes. Opening it asks nothing of GitHub.`),
          this.actions(open, remove),
        );
        card.append(kept);
      }

      const form = this.element("form", { className: "gh-form" });
      const keep = this.element("input", { id: "gh-keep", type: "checkbox", checked: false, disabled: !choices.canKeep });
      const keepLabel = this.element("label", {
        htmlFor: "gh-keep",
        className: "gh-check",
        textContent: choices.kept ? "Keep it in this browser, replacing the kept copy and its changes" : "Keep it in this browser",
      });
      keepLabel.prepend(keep);
      const keepHint = this.text(
        choices.canKeep
          ? "Off, nothing is stored: closing or reloading the tab forgets the repository. On, Genbeya saves it with your changes in this browser's private storage for genbeya.fyi, so it opens again without asking GitHub. It never leaves your device, you can delete it at any time, and tokens are never kept."
          : "This browser can't keep files for web pages: the repository lives in this tab only.",
        "gh-hint",
      );
      const details = this.element("details");
      const token = this.element("input", { id: "gh-token", type: "password", autocomplete: "off", spellcheck: false });
      details.append(
        this.element("summary", { textContent: "Private repository?" }),
        this.element("label", { textContent: "Token for api.github.com", htmlFor: "gh-token" }),
        token,
        this.text(
          "A fine-grained personal access token that may read the repository's contents. It goes only to api.github.com, is used while the files are read, and is then forgotten.",
          "gh-hint",
        ),
      );
      const open = this.element("button", {
        className: choices.kept ? "btn" : "btn btn-primary",
        type: "submit",
        textContent: choices.kept ? "Read again from GitHub" : "Open repository",
      });
      const cancel = this.element("button", { className: "btn", type: "button", textContent: "Cancel" });
      busy.push(open, cancel, keep, token);
      cancel.addEventListener("click", () => this.declined(address));
      const github = this.element("a", {
        className: "btn btn-ghost",
        href: `https://github.com${gitHubAddressPath(address).slice("/github".length)}`,
        target: "_blank",
        rel: "noopener noreferrer",
        textContent: "View on GitHub",
      });
      form.append(keepLabel, keepHint, details, status, error, this.actions(open, cancel, github));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        run(
          () =>
            choices.read(
              token.value.trim() || undefined,
              keep.checked,
              (read, total) => (status.textContent = `Reading files from GitHub: ${read} of ${total}`),
            ),
          "Reading the repository from GitHub…",
        );
      });
      card.append(form);
      this.footer(card, choices.total, choices.deleteAll, () =>
        this.notice(address, { ...choices, kept: null, total: null }).then(resolve),
      );
      (choices.kept ? card.querySelector<HTMLButtonElement>(".gh-kept .btn-primary") : open)?.focus();
    });
  }

  remove(): void {
    this.root.remove();
  }

  /** The visitor said no: nothing was requested, and nothing happens until they choose otherwise. */
  private declined(address: GitHubAddress): void {
    this.root.replaceChildren();
    const card = this.card("Nothing was requested", "");
    card.append(this.text("Genbeya asked GitHub for nothing and kept nothing. You can close this tab."));
    const again = this.element("button", { className: "btn", type: "button", textContent: "Show the notice again" });
    again.addEventListener("click", () => this.page.location.reload());
    const buttons: HTMLElement[] = [again];
    if (this.page.history.length > 1) {
      const back = this.element("button", { className: "btn btn-primary", type: "button", textContent: "Go back" });
      back.addEventListener("click", () => this.page.history.back());
      buttons.unshift(back);
    }
    const github = this.element("a", {
      className: "btn btn-ghost",
      href: `https://github.com${gitHubAddressPath(address).slice("/github".length)}`,
      rel: "noopener noreferrer",
      textContent: "View on GitHub",
    });
    card.append(this.actions(...buttons, github));
  }

  /** How much this browser keeps, and a way to delete it all. */
  private footer(card: HTMLElement, total: KeptTotal | null, deleteAll: () => Promise<void>, after: () => unknown): void {
    if (!total?.count) return;
    const remove = this.element("button", { className: "btn btn-s", type: "button", textContent: "Delete everything kept" });
    remove.addEventListener("click", () => {
      if (
        !this.page.confirm(
          `Delete the ${total.count === 1 ? "repository" : `${total.count} repositories`} Genbeya keeps in this browser, with your changes?`,
        )
      )
        return;
      void deleteAll().then(after);
    });
    const footer = this.element("p", { className: "gh-footer" });
    footer.append(
      `This browser keeps ${total.count === 1 ? "one repository" : `${total.count} repositories`} for Genbeya on GitHub (${megabytes(total.bytes)}). `,
      remove,
    );
    card.append(footer);
  }

  /** The address of the page for `path`, wherever the page is served. */
  private addressOf(path: string): string {
    const address = parseGitHubAddress(path)!;
    const { pathname } = this.page.location;
    return /\/github(\/|$)/.test(pathname)
      ? pathname.replace(/\/github(\/.*)?$/, path)
      : `${pathname}?repo=${address.owner}/${address.name}${address.branch ? `&branch=${encodeURIComponent(address.branch)}` : ""}`;
  }

  private go(address: GitHubAddress): void {
    this.page.location.replace(this.addressOf(gitHubAddressPath(address)));
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

  private alert(): HTMLElement {
    const error = this.element("p", { className: "gh-error", hidden: true });
    error.setAttribute("role", "alert");
    return error;
  }

  private show(element: HTMLElement, text: string): void {
    element.textContent = text;
    element.hidden = false;
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
