# Privacy review

The brief for the outside review of [Forges](../Forges.md) ([[GENBEYA-43]]): what Genbeya in the browser does with data, where to find it, how to run it, and the questions we want answered. Nothing of it is public yet: genbeya.fyi serves it only after this review ([[GENBEYA-41]]).

[TOC]

## In short

Genbeya keeps a project's wiki and task board as Markdown files in its Git repository. **Genbeya on your forge** opens such a repository from GitHub, GitLab, Bitbucket, Codeberg, Gitea or Forgejo in a browser tab, without cloning it: the address is the forge's own with `genbeya.fyi/<forge>` in front, such as `genbeya.fyi/github/genbeya/genbeya`.

- **A static page, no server of ours.** The page is static files. It reads the repository from the forge's public API, in the visitor's browser. genbeya.fyi receives no repository content, no tokens, no usage data. There is no analytics, no tracking, no third-party script.
- **Nothing before consent.** Every address of the page starts at a notice that says what will be requested from whom. Nothing is requested before the visitor chooses **Open repository**; **Cancel** requests nothing.
- **Nothing stored unless chosen.** By default nothing is stored in the browser. Keeping the repository in the browser (OPFS) is a separate, unticked choice, and deleting it is as easy.
- **Tokens** for private repositories are typed by the visitor, go only to the forge's API, are used while the files are read, and are then dropped.

## Where it is

| | |
| --- | --- |
| Repository | <https://github.com/genbeya/genbeya> (public) |
| Branch | `feature/GENBEYA-39-github-integration-poc` |
| Design | `docs/Architecture/Forges.md`, the page above this one; its [Privacy](../Forges.md#privacy) section is the core of the review |
| Tasks | `tasks/GENBEYA-39.md` (reading GitHub), `GENBEYA-40` (keeping), `GENBEYA-42` (other forges), `GENBEYA-43` (this review), `GENBEYA-41` (hosting, after the review) |

The code a review should look at:

| What | Where |
| --- | --- |
| The notice: its wording, the choices, what runs before consent | `src/client/app/platform/forge-notice.ts` |
| Composing it all; saving while kept; one tab at a time | `src/client/app/platform/forge-connector.ts` |
| The requests to each forge, and where a token goes | `src/access/forges/` (`forge.ts`, `github.ts`, `gitlab.ts`, `gitea.ts`, `bitbucket.ts`) |
| What is read from a repository | `src/managers/demo/forge-backend.ts` (`readForgeContent`) |
| What is kept in the browser, and how it is deleted | `src/managers/demo/forge-keeping.ts`, `src/access/browser/kept-files.ts`, `src/access/memory/repository-state.ts` |
| Addresses, and which hosts each forge's page may connect to | `src/utilities/forge-address.ts` |
| The content security policy: the page's own, and the one per address | `src/client/index.forge.html`, `scripts/serve-forge.mjs` |
| What the tests check | `e2e/forge/forge.spec.ts` (in a real browser), `src/**/*.spec.ts` |

## Run it

Needs Node.js 24 and Git.

```bash
git clone --branch feature/GENBEYA-39-github-integration-poc https://github.com/genbeya/genbeya.git
cd genbeya
npm ci
npm run build:forge
node scripts/serve-forge.mjs 4200
```

Then open, in any current browser:

- <http://127.0.0.1:4200/github/genbeya/genbeya> — Genbeya's own repository, with a full wiki and board;
- <http://127.0.0.1:4200/gitlab/gitlab-org/project-templates/express>, <http://127.0.0.1:4200/bitbucket/atlassian/atlassian-connect-express>, <http://127.0.0.1:4200/gitea/gitea/awesome-gitea?host=gitea.com> — other forges, the last as a server of its own;
- <http://127.0.0.1:4200/> — the start page, which asks for a repository and lists kept ones.

The browser's developer tools (Network, and Application → Storage) show what the page requests and stores. `scripts/serve-forge.mjs` serves the page the way genbeya.fyi will, with the content security policy for each address as a header.

To run the tests: `npm run test:backend` and `npm run test:client` (unit tests), and `npx playwright install chromium` once, then `npm run e2e:forge` (the page in Chromium against simulated forges, no network needed).

> [!NOTE]
> With older Git versions (seen with Git 2.43), ten backend tests of the desktop app's Git commands fail with "option '--end-of-options' must come before non-option arguments". They are unrelated to this branch and fail on `develop` too.

## What happens to data

### Before the visitor agrees

The page loads its own files from genbeya.fyi, reads the address, and, only to say so on the notice, looks in the browser's storage for a copy the visitor kept earlier. It requests nothing from any forge. The end-to-end tests open the page at every kind of address and check that no request reached a forge and none of the app ran.

### The notice, word for word

For a repository on github.com:

> Genbeya opens this repository here in your browser: its wiki, its task board and its code, as they are on GitHub now.
>
> **What happens when you open it**
>
> - Your browser asks GitHub for the repository's files, at api.github.com and raw.githubusercontent.com. GitHub sees your IP address and that the requests come from a page on genbeya.fyi, which browsers tell sites with every such request, and processes them under GitHub's privacy statement *(linked)*, also in the United States.
> - Nothing goes anywhere else: genbeya.fyi receives nothing, and nothing on this page tracks you.
> - What you change stays in this browser. Nothing is written back to GitHub.
>
> ☐ Keep it in this browser
>
> Off, nothing is stored: closing or reloading the tab forgets the repository. On, Genbeya saves it with your changes in this browser's private storage for this site, so it opens again without asking GitHub. It never leaves your device, you can delete it at any time, and tokens are never kept.
>
> ▸ Private repository? *(a token field: "Token for api.github.com". A fine-grained personal access token that may read the repository's contents. It goes only to api.github.com, is used while the files are read, and is then forgotten.)*
>
> **Open repository** · **Cancel** · View on GitHub

GitLab and Atlassian (Bitbucket) are named with their privacy statements and "also in the United States", Codeberg e.V. with its privacy policy. For a server named with `?host=`, the notice opens with a warning instead:

> This address names a server of its own: **git.example.com**. Genbeya can't tell who runs it. Open the repository, and give it a token, only if you know and trust git.example.com.

and says "Whoever runs git.example.com sees your IP address … and processes them under their own terms."

### What leaves the device

| To | What | When |
| --- | --- | --- |
| The forge | Requests for the repository and its files: the visitor's IP address, the `Origin: https://genbeya.fyi` header that browsers add and no page can suppress, the browser's own headers (user agent, language); with a token, the token, only to the forge's API. No referrer | After **Open repository** or **Read again** |
| genbeya.fyi, through its hosting provider (Cloudflare) | Requests for the page's own files, which the provider logs as for any website | When the page loads |
| Anyone else | Nothing; the content security policy blocks it | Never |

The page reads only Genbeya's content: the settings, the wiki and task folders, Markdown files and the files they refer to. For Genbeya's own repository that is 85 of 706 files. The repository's content holds personal data: commit authors' names and email addresses, people named in tasks and comments. It is processed only in the visitor's browser.

### What stays on the device

| What | Where | How long |
| --- | --- | --- |
| The repository, while the tab is open | The tab's memory | Until the tab closes or reloads |
| A kept repository with the visitor's changes, only if the visitor ticked **Keep it in this browser** or chose **Keep in this browser** in the menu | The browser's Origin Private File System, for the site's origin | Until deleted: **Delete kept copy**, **Delete the kept copy**, **Delete everything kept**, or clearing the site's data. The page asks the browser not to evict it on its own |
| Cookies, local storage, session storage, IndexedDB | Never used | The tests check they stay empty |
| Tokens | Never stored | Dropped once the files are read |

### Enforced, not only promised

- **Content security policy.** The page allows connections only to its own origin and https hosts. The server narrows that per address to the forge's hosts (`api.github.com` and `raw.githubusercontent.com`, `gitlab.com`, `api.bitbucket.org`, `codeberg.org`, or the named server), and the start page connects nowhere. A test checks that a page for one forge can't reach another.
- **Tokens only to the API.** The readers add the token only to requests to the forge's API host, and never follow a "next page" link that leads elsewhere. Without a token, requests carry no headers of the page's own.
- **No token near repository content.** The token is gone before any repository content is rendered, so a hostile page in a repository can't read it. Rendering itself goes through the app's Markdown allowlist ([Security](../Security.md)).

## Questions for the review

1. **Consent and its basis.** Is the notice, as worded, enough for informed consent to the transfer to the forge, or is the request better framed as necessary for a service the visitor explicitly asked for? Does anything need to be clearer, or is anything missing, for example the user agent and language headers?
2. **Joint controllership.** In *Fashion ID* (CJEU, C‑40/17) a site that embedded a third party's plugin was held jointly responsible for collecting and transmitting visitors' data to that party. The page here makes the visitor's browser contact the forge, though only after the visitor asks. Does genbeya.fyi become a joint controller with the forge for that, and what follows from it?
3. **Storage.** Is the opt-in for keeping a repository in OPFS adequate under ePrivacy Article 5(3) and TDDDG §25: unticked, separate from agreeing to the requests, explained, and as easy to delete? Should the page also not look in storage for a kept copy before the visitor has chosen anything, which it does today to offer it on the notice?
4. **The `Origin` header.** Is the wording of what the forge learns accurate and enough?
5. **Transfers to the United States.** GitHub, GitLab and Atlassian process the requests also in the US. Is "also in the United States" with a link to their statements enough, given that the visitor's own browser makes the requests?
6. **Servers of their own.** A link can name any host. Are the warning and the token field's label enough against a link that names an attacker's server to collect tokens? Would you restrict hosts, for example to ones the visitor typed on the start page?
7. **Hosting.** The plan is a separate origin (`open.genbeya.fyi`) so the rest of genbeya.fyi stays without any outside request or storage, with the policy sent as a header by a Cloudflare Worker. Anything to watch there, for example Cloudflare's own logs, analytics or features that must stay off?
8. **Which law applies.** That depends on where genbeya.fyi is run from (for example Swiss revFADP or the GDPR) and on its visitors, in the EU in particular (GDPR, ePrivacy). What does genbeya.fyi need besides this: a privacy notice for the site (naming the hosting provider's logs), an imprint?
9. **Anything else** you would not ship like this.

## Known gaps

- Not yet tested from a real browser on a real network: requests with a token, which make browsers ask the forge first (a CORS preflight). The development environment's proxy blocked those.
- Not covered: GitHub Enterprise Server, Bitbucket Data Center, and Bitbucket's API tokens that sign in with an email address.
- Signing in with a forge (OAuth) instead of pasting a token needs a small relay on genbeya.fyi, since the forges' token endpoints refuse web pages; it would be reviewed on its own.

## Findings

*To be filled in from the review.*
