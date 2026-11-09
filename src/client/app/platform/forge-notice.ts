/**
 * The page Genbeya on a forge shows before anything else: what the page requests and from whom, and the
 * choices the visitor has. Nothing is requested from the forge and nothing is kept until the visitor chooses
 * so here. It is plain DOM, shown before the client starts, so none of the app runs before then.
 */
import {
  FORGE_HOSTS,
  FORGE_LABELS,
  FORGES,
  forgeAddressPath,
  forgeConnectHosts,
  forgeWebUrl,
  isSelfHosted,
  parseForgeAddress,
  SELF_HOSTED,
  type Forge,
  type ForgeAddress,
} from "../../../utilities/forge-address";

/** Who runs each forge's website, and the privacy statement the requests fall under. */
export const OPERATORS: Readonly<
  Record<Exclude<Forge, "gitea" | "forgejo">, { who: string; statement: string; url: string; where: string }>
> = {
  github: {
    who: "GitHub",
    statement: "GitHub's privacy statement",
    url: "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement",
    where: ", also in the United States",
  },
  gitlab: {
    who: "GitLab",
    statement: "GitLab's privacy statement",
    url: "https://about.gitlab.com/privacy/",
    where: ", also in the United States",
  },
  bitbucket: {
    who: "Atlassian, which runs Bitbucket,",
    statement: "Atlassian's privacy policy",
    url: "https://www.atlassian.com/legal/privacy-policy",
    where: ", also in the United States",
  },
  codeberg: {
    who: "Codeberg e.V.",
    statement: "Codeberg's privacy policy",
    url: "https://codeberg.org/Codeberg/org/src/branch/main/PrivacyPolicy.md",
    where: "",
  },
};

/** What a token for each forge must be allowed to do. */
const TOKENS: Readonly<Record<Forge, string>> = {
  github: "A fine-grained personal access token that may read the repository's contents.",
  gitlab: "A personal, project or group access token with the read_api scope.",
  bitbucket: "A repository, project or workspace access token with the repository:read scope.",
  codeberg: "An access token with read access to repositories (read:repository).",
  gitea: "An access token with read access to repositories (read:repository).",
  forgejo: "An access token with read access to repositories (read:repository).",
};

/** What the start screen needs of the page. */
export type NoticePage = Pick<Window, "document" | "location" | "history" | "confirm">;

/** A repository kept in this browser, as the start screen shows it. */
export interface KeptCopy {
  readonly address: ForgeAddress;
  /** Such as "GitLab: acme/rockets". */
  readonly label: string;
  /** Such as "Branch main at 1a2b3c4, saved 9 Nov 2026, 10:01". */
  readonly description: string;
}

/** Everything this browser keeps for Genbeya on forges. */
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
  /** Reads the repository from its forge, once the visitor agreed; keeps it if `keep`. */
  read(token: string | undefined, keep: boolean, progress: (read: number, total: number) => void): Promise<T>;
  /** Opens the kept copy, asking nothing of the forge. */
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
const listed = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
/** The forge whose website a host is, if any. */
const forgeOfHost = (host: string) => FORGES.find((forge) => FORGE_HOSTS[forge] === host);

/** The repository a visitor typed: `owner/repository` on the chosen forge, or a repository's address on any forge. */
export function parseRepositoryInput(value: string, forge: Forge, host: string): ForgeAddress | null {
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const known = forgeOfHost(url.host);
    const kind = known ?? (SELF_HOSTED.includes(forge) ? forge : null);
    if (!kind) return null;
    return parseForgeAddress(`/${kind}${url.pathname.replace(/\/$/, "")}`, known ? "" : `?host=${encodeURIComponent(url.host)}`);
  }
  const query = new URLSearchParams({ forge, repo: text.replace(/\.git$/, "") });
  if (host.trim()) query.set("host", host.trim());
  return parseForgeAddress("", `?${query}`);
}

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
    this.page.document.title = "Genbeya on your forge";
    this.root.replaceChildren();
    const card = this.card("Genbeya", "Open a repository", "Its wiki, its task board and its code, read from its forge into your browser.");
    const form = this.element("form", { className: "gh-form" });
    const forge = this.element("select", { id: "gh-forge" });
    for (const kind of FORGES) forge.append(this.element("option", { value: kind, textContent: FORGE_LABELS[kind] }));
    const host = this.element("input", { id: "gh-host", placeholder: "gitlab.example.com", autocomplete: "off", spellcheck: false });
    const hostRow = this.element("div");
    hostRow.append(this.element("label", { textContent: "Server", htmlFor: "gh-host" }), host);
    const input = this.element("input", {
      id: "gh-repository",
      placeholder: "owner/repository",
      autocomplete: "off",
      spellcheck: false,
      required: true,
    });
    const error = this.alert();
    const showHost = () => {
      hostRow.hidden = !SELF_HOSTED.includes(forge.value as Forge);
      host.placeholder = forge.value === "gitlab" ? "gitlab.com, or your own server" : "git.example.com";
      host.required = forge.value === "gitea" || forge.value === "forgejo";
    };
    forge.addEventListener("change", showHost);
    showHost();
    form.append(
      this.element("label", { textContent: "Forge", htmlFor: "gh-forge" }),
      forge,
      hostRow,
      this.element("label", { textContent: "Repository", htmlFor: "gh-repository" }),
      input,
      this.text("owner/repository, a GitLab group path, or the repository's address on its forge.", "gh-hint"),
      error,
      this.actions(this.element("button", { className: "btn btn-primary", type: "submit", textContent: "Continue" })),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const address = parseRepositoryInput(input.value, forge.value as Forge, hostRow.hidden ? "" : host.value);
      if (!address)
        return this.show(error, "Enter a repository as owner/repository, such as genbeya/genbeya, or its address on its forge.");
      this.go(address);
    });
    card.append(form);
    if (kept.length) {
      const list = this.element("ul", { className: "gh-kept-list" });
      for (const copy of kept) {
        const link = this.element("a", { textContent: copy.label, href: "#" });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          this.go(copy.address);
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
  notice<T>(address: ForgeAddress, choices: NoticeChoices<T>): Promise<T> {
    const forge = FORGE_LABELS[address.forge];
    const label = `${address.owner}/${address.name}`;
    const own = isSelfHosted(address);
    const hosts = forgeConnectHosts(address);
    this.page.document.title = `${label} · Genbeya`;
    this.root.replaceChildren();
    const card = this.card(
      `Genbeya on ${forge}`,
      label,
      [own ? `On ${address.host}` : "", address.branch ? `Branch ${address.branch}` : ""].filter(Boolean).join(" · "),
    );
    if (own) {
      const warning = this.element("p", { className: "gh-warning" });
      warning.setAttribute("role", "note");
      const server = this.element("strong", { textContent: address.host });
      warning.append(
        "This address names a server of its own: ",
        server,
        `. Genbeya can't tell who runs it. Open the repository, and give it a token, only if you know and trust ${address.host}.`,
      );
      card.append(warning);
    }
    card.append(
      this.text(`Genbeya opens this repository here in your browser: its wiki, its task board and its code, as they are on ${forge} now.`),
      this.element("h2", { textContent: "What happens when you open it" }),
    );
    const list = this.element("ul");
    const operator =
      own || address.forge === "gitea" || address.forge === "forgejo" ? null : OPERATORS[address.forge as keyof typeof OPERATORS];
    const sees = `sees your IP address and that the requests come from a page on genbeya.fyi, which browsers tell sites with every such request`;
    list.append(
      operator
        ? this.item(
            `Your browser asks ${forge} for the repository's files, at ${listed(hosts)}. ${operator.who} ${sees}, and processes them under `,
            this.element("a", { href: operator.url, target: "_blank", rel: "noopener noreferrer", textContent: operator.statement }),
            `${operator.where}.`,
          )
        : this.item(
            `Your browser asks ${address.host} for the repository's files. Whoever runs ${address.host} ${sees}, and processes them under their own terms.`,
          ),
      this.item("Nothing goes anywhere else: genbeya.fyi receives nothing, and nothing on this page tracks you."),
      this.item(`What you change stays in this browser. Nothing is written back to ${forge}.`),
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
          this.text(`${choices.kept.description}, with your changes. Opening it asks nothing of ${forge}.`),
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
          ? `Off, nothing is stored: closing or reloading the tab forgets the repository. On, Genbeya saves it with your changes in this browser's private storage for this site, so it opens again without asking ${forge}. It never leaves your device, you can delete it at any time, and tokens are never kept.`
          : "This browser can't keep files for web pages: the repository lives in this tab only.",
        "gh-hint",
      );
      const apiHost = hosts[0]!;
      const details = this.element("details");
      const token = this.element("input", { id: "gh-token", type: "password", autocomplete: "off", spellcheck: false });
      details.append(
        this.element("summary", { textContent: "Private repository?" }),
        this.element("label", { textContent: `Token for ${apiHost}`, htmlFor: "gh-token" }),
        token,
        this.text(
          `${TOKENS[address.forge]} It goes only to ${apiHost}, is used while the files are read, and is then forgotten.`,
          "gh-hint",
        ),
      );
      const open = this.element("button", {
        className: choices.kept ? "btn" : "btn btn-primary",
        type: "submit",
        textContent: choices.kept ? `Read again from ${forge}` : "Open repository",
      });
      const cancel = this.element("button", { className: "btn", type: "button", textContent: "Cancel" });
      busy.push(open, cancel, keep, token);
      cancel.addEventListener("click", () => this.declined(address));
      const view = this.element("a", {
        className: "btn btn-ghost",
        href: forgeWebUrl(address),
        target: "_blank",
        rel: "noopener noreferrer",
        textContent: `View on ${forge}`,
      });
      form.append(keepLabel, keepHint, details, status, error, this.actions(open, cancel, view));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        run(
          () =>
            choices.read(
              token.value.trim() || undefined,
              keep.checked,
              (read, total) => (status.textContent = `Reading files from ${forge}: ${read} of ${total}`),
            ),
          `Reading the repository from ${forge}…`,
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
  private declined(address: ForgeAddress): void {
    const forge = FORGE_LABELS[address.forge];
    this.root.replaceChildren();
    const card = this.card(`Genbeya on ${forge}`, "Nothing was requested", "");
    card.append(
      this.text(`Genbeya asked ${isSelfHosted(address) ? address.host : forge} for nothing and kept nothing. You can close this tab.`),
    );
    const again = this.element("button", { className: "btn", type: "button", textContent: "Show the notice again" });
    again.addEventListener("click", () => this.page.location.reload());
    const buttons: HTMLElement[] = [again];
    if (this.page.history.length > 1) {
      const back = this.element("button", { className: "btn btn-primary", type: "button", textContent: "Go back" });
      back.addEventListener("click", () => this.page.history.back());
      buttons.unshift(back);
    }
    buttons.push(
      this.element("a", {
        className: "btn btn-ghost",
        href: forgeWebUrl(address),
        rel: "noopener noreferrer",
        textContent: `View on ${forge}`,
      }),
    );
    card.append(this.actions(...buttons));
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
      `This browser keeps ${total.count === 1 ? "one repository" : `${total.count} repositories`} for Genbeya (${megabytes(total.bytes)}). `,
      remove,
    );
    card.append(footer);
  }

  /** Opens `address`: at its path where the page is served at forge paths, else by the query. */
  private go(address: ForgeAddress): void {
    const { pathname } = this.page.location;
    const at = /\/(?:github|gitlab|bitbucket|codeberg|gitea|forgejo)(?:\/.*)?$/.exec(pathname);
    if (at) return this.page.location.replace(pathname.slice(0, at.index) + forgeAddressPath(address));
    const query = new URLSearchParams({ forge: address.forge, repo: `${address.owner}/${address.name}` });
    if (address.branch) query.set("branch", address.branch);
    if (isSelfHosted(address)) query.set("host", address.host);
    this.page.location.replace(`${pathname}?${query}`);
  }

  private card(eyebrow: string, title: string, subtitle: string): HTMLElement {
    const card = this.element("section", { className: "gh-card" });
    card.setAttribute("aria-labelledby", "gh-title");
    card.append(
      this.element("p", { className: "gh-eyebrow", textContent: eyebrow }),
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
