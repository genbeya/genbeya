# Pull requests

The **Pull requests** view (`Ctrl+6`) asks for a review of a branch and keeps the whole review in the repository. Each pull request is one Markdown file in the pull request folder (`pulls/` unless **Settings** names another), named after its ID: its branches, its description, the review grouped by topic, the discussion and the reviewers' verdicts. Anyone can read and answer it with any editor; Genbeya adds the diff, the buttons, and what it works out from the branches.

> [!NOTE]
> A first version, to try out. What it does not do yet is listed under [The prototype](../Design/Pull-requests.md#the-prototype).

[TOC]

## The file

````markdown
---
id: PR-7
title: Replace deprecated authentication API
status: open
author: Sam
source: feature/GENBEYA-17-verify-token
target: develop
reviewers: [Alex, Frank]
---

Migrate authentication from `validateToken()` to `verifyToken()`. Implements [[GENBEYA-17]].

- [ ] Update the changelog

## Review

### Use the new verifier consistently

**Alex — 2026-10-23 12:40+02:00:** Several callers need it; avoid a sync wrapper.

#### [[src/auth/login.ts#L42-L48@3f2c9e1a…]]

```diff
- const user = validateToken(token);
+ const user = await verifyToken(token);
```

**Sam — 2026-10-24 09:20+02:00:** Done.

- [x] Replace the deprecated call

## Discussion

**Sam — 2026-10-23 09:10+02:00 — requested review:** Ready.

**Frank — 2026-10-24 11:00+02:00 — approved `8b1d04c2…`:** Looks good.
````

- **Commit IDs** are written in full; they are shortened above.
- **Frontmatter:** `status` is `draft`, `open`, `merged` or `closed`; `source` is the branch to merge, `target` where it goes; `merge_commit` is added by **Merge**. Other fields survive edits made in Genbeya.
- **`## Review`** has one `###` topic per issue, with remarks on the topic as a whole, and one `####` code range per place in the code: a [pinned reference](References.md#pinned-to-a-revision) to the lines at the revision they were written about. Under a code range go its suggestion (a `diff` block), its replies and its to-dos.
- **`## Discussion`** holds replies about the whole pull request, and the verdicts.
- **Replies** are one paragraph each, starting with the name and time in bold, as in [task comments](Tasks.md#comments). Lines that start like a reply but can't be read are listed at the top of the pull request, never dropped.
- **To-dos** are checkboxes anywhere in the file; tick them right in the pull request.
- **Nothing derived is written into the file:** which approvals still count, whether it can be merged, the commits and files are worked out each time from the branches.

## Opening one

**+** in the list, **New pull request** in the `Ctrl+K` palette, or the button on the empty view: choose the branch to merge and where to merge it (the current branch into the default branch to start with), a title, the reviewers (names separated by commas), a description, and whether it is a draft. The file is written with your Git name as the author.

Where the file lives is the project's choice, as for the wiki and the tasks (**Settings → Where content lives → Pull requests**):

| | In the checkout | On the content branch |
| --- | --- | --- |
| The file | is an ordinary change: commit it, on the source branch if you like, so it merges with the code | is committed with every edit, and shared with **Sync** |
| The list shows | the pull requests in the checked-out branch | every pull request, whatever is checked out |
| A squash merge | drops the history of the discussion | keeps it |

## The list

Open pull requests (with drafts), merged, closed or all, newest first, with the number of open to-dos; the filter matches the ID, title, branches, author and reviewers. The sidebar counts the open ones.

## A pull request

The header names the branches, how many commits the source has that the target lacks and how far it is behind, and each reviewer with their latest verdict: approved, approved but stale, changes requested, or still waiting. Hover over a reviewer for when and at which revision.

### Conversation

- **Ready to merge?** lists each condition on its own: enough approvals that still count (as many as **Settings → Approvals needed** asks), no request for changes still open, no open to-do, no conflicts with the target, and, when the source or target is checked out, no uncommitted changes. It advises; it can't enforce. Protected branches on the Git host do that.
- **Tasks** the pull request names (in its source branch, title or description) show with their state.
- The file's description, review and discussion, rendered; tick to-dos right there.
- **Reply to** the discussion, a topic or a code range. **Approve** and **Request changes** add a verdict naming the commit the source is at, with what you typed; **Withdraw approval** takes yours back. The author can **Request review**.

### Files

The files the source changes, compared with the commit where the branches meet, as the target will get them. A file with review threads shows how many; its threads show above its diff, marked **outdated** when they were written about an older revision of the source.

To comment on lines, select them by their numbers, or use the bar above a change, and choose **Comment on**: start a new topic or add the code range to an existing one, with a comment, an optional suggestion (edit the lines as they should be; Genbeya writes the `diff`), and an optional to-do.

## Which approvals still count

An approval names the commit the reviewer looked at. It counts while the change it approved is still the change to merge:

- **The change, not the commit:** Genbeya compares a fingerprint of the diff from where the branches meet to the source, without line positions. A rebase that keeps the code keeps the approval; any code change makes it stale.
- **Review files don't count:** Markdown files directly in the pull request folder are left out, so replies and verdicts committed to the source branch keep approvals. Anything else in that folder is reviewed like code.
- **Each person's latest verdict counts.** A request for changes stays open until that person approves or withdraws.
- **Recorded, not verified:** a verdict says who gave it, and anyone with write access could have written it.

## Cleaning up

**Clean up…** walks through what is still open before the merge:

- **Resolve** ticks a to-do: the change was made.
- **Dismiss…** ticks it, struck through, with the reason.
- **To task** creates a task from it and replaces it with a reference to the task.
- **Shorten to outcome…** replaces a topic's remarks, code ranges and to-dos with what came of it. Verdicts stay, and the full discussion stays in Git.

## Merging

**Merge** switches to the target if needed, merges the source with a merge commit named after the pull request, and records `status: merged` and the `merge_commit` in the file. Push afterwards to share it. When the merge stops for conflicts, finish it in **Changes**, then **Mark merged**: the button replaces **Merge** once the target has every commit of the source, also after merging some other way. **Close** and **Reopen** change only the status.

## Pull requests and tasks

A task shows the pull requests that name it, below its plan, with their state ("Open into main, 1 of 2 approvals"); click one to open it. On the board, a card with an open pull request gets a pull request mark next to its ID.
