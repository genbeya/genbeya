# Pull requests

> [!NOTE]
> Proposal, not built yet. Tasks: [[GENBEYA-50]] to [[GENBEYA-56]].

Code review inside the repository: a pull request is one Markdown file that holds everything about one unit of work: its description, the branches, the suggested changes grouped by issue, the discussion, its to-dos and the reviewers' verdicts. Before the merge, what is still open is resolved, dismissed, or turned into tasks and wiki pages, so the merged file is a short record and the knowledge lands where people look for it.

**Decided:**

- The unit is the **pull request**: one file per pull request. A review is not a file of its own, and a pull request is not a task.
- A pull request holds several suggested changes, grouped by issue, each about one or more code ranges. How much review it needs (no reviewers, one approval, several) depends on the team and the project, not on the format.
- Where pull request files live is the project's choice, as for the wiki and the tasks: in the checkout or on the [Content branch](../Architecture/Content-branch.md).

[TOC]

## Who it is for

Teams on GitHub or GitLab review there and will keep doing so. Genbeya's pull requests fit:

- repositories without a forge, or a forge without reviews, and work offline;
- a developer with coding agents, which can write and answer review files like any other Markdown;
- teams that want review outcomes to survive as tasks, decisions and pages, rather than end in a closed pull request on a host.

A bridge to the forges can come later, with the forge plugins.

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

Migrate authentication from `validateToken()` to `verifyToken()`, keeping the error
handling. Implements [[GENBEYA-17]], follows [[ADR-008]].

## Review

### Use the new verifier consistently

**Alex — 2026-10-23 12:40+02:00:** Several callers need it; avoid a sync wrapper.

#### [[src/auth/login.ts#L42-L48@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]]

```diff
- const user = validateToken(token);
+ const user = await verifyToken(token);
```

**Alex — 2026-10-23 12:41+02:00:** This caller can await directly.

**Sam — 2026-10-24 09:20+02:00:** Done in `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`.

- [x] Replace the deprecated call

#### [[src/auth/session.ts#L81-L89@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]]

**Alex — 2026-10-23 12:44+02:00:** Keep expired and invalid tokens apart.

- [ ] Preserve expired-versus-invalid handling

## Discussion

**Sam — 2026-10-23 09:10+02:00 — requested review:** Ready, error propagation needs a look.

**Alex — 2026-10-23 12:45+02:00 — requested changes at `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`:** See the verifier topic.

**Frank — 2026-10-24 11:00+02:00 — approved `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`:** Looks good.
````

| Part | Holds |
| --- | --- |
| Frontmatter | `id`, `title`, `status` (`draft`, `open`, `merged`, `closed`: only what a person decides), `author`, `source` and `target` branches, requested `reviewers`, and after the merge `merge_commit` |
| Description | What the change does and why, with references to its tasks and pages |
| `## Review` | One `###` topic per issue, with its shared remarks; one `####` per code range under it, as a [pinned reference](../Guide/References.md#pinned-to-a-revision), with its own suggestion, to-dos and replies |
| `## Discussion` | Remarks about the pull request as a whole, and the verdicts |

- **Suggestions** are ordinary `diff` code blocks. They read well anywhere and render today. Applying one is optional and checks first that the lines still match.
- **To-dos** are checkboxes: under a code range, in a topic, or in the description.
- **Replies** are flat and in order of time, one paragraph each, starting with the name and time in bold: `**Alex — 2026-10-23 12:41+02:00:**`. The name and time are written as in [task comments](../Guide/Tasks.md#comments). Headings are taken by topics and code ranges, so replies can't be headings as comments in tasks are. Quoting and `@mentions` stand in for nested replies.
- **References** work as everywhere: `[[GENBEYA-17]]`, or `[[ADR-008]]` for a decision recorded as a wiki page of that title.

### Nothing derived in the file

The file holds only what people write. Genbeya computes the rest and shows it next to the file, never writes it into it:

- the current head and the merge base, from the `source` and `target` branches (the file has no `head` or `base` field to go stale);
- which approvals are effective, whether the pull request is ready to merge, and a summary of open to-dos;
- the list of follow-ups, collected from the references in the file.

Sections that repeat facts written elsewhere in the file (a review history next to the discussion, a follow-up list next to the promoted to-dos, a merge-readiness checklist) drift apart as soon as someone edits by hand, so the format has none.

## Verdicts

A verdict is a reply whose heading names it, with the revision it applies to:

| Verdict | Written as |
| --- | --- |
| Request review | `**Sam — <time> — requested review:**` (from the `reviewers` in the frontmatter) |
| Approve | `**Frank — <time> — approved <commit>:**` |
| Request changes | `**Alex — <time> — requested changes at <commit>:**` |
| Withdraw | `**Frank — <time> — withdrew approval:**` |

- An approval always names the revision the reviewer examined; "approved this pull request" is not enough.
- A request for changes blocks until its author approves or withdraws it, or it is dismissed under the project's policy.
- Verdicts are never removed by the cleanup.

### Recorded, not verified

A line saying Frank approved is not proof that Frank did. Genbeya shows verdicts as **recorded**. Git knows which commit added the line: when that commit's author isn't Frank, Genbeya says so ("recorded by Frank, committed by Sam"). Verified approvals, through a signature or a forge, are a later step.

## Which approvals still count

An approval stays effective as long as the change it approved is still the change to merge.

- **Compare the change, not the commit.** Commits that only touch the pull request file (replies, verdicts) don't matter; code, tests and other files changed after the approval make it stale.
- **Rebases:** a rebase gives the same change new commit IDs. Comparing the change itself (Git's `patch-id` of the diff from the merge base to the head) keeps an approval valid through a rebase that didn't change the code; comparing trees, as the first draft of this spec did, makes every rebase onto a moved target stale. Whether the rebased change still works on the new target is the merge check's job.
- **Where the file lives matters:**
  - On the **content branch**, review commits never touch the code branch, so this is a plain comparison of the change.
  - In the **checkout**, the pull request file sits on the source branch, and the comparison leaves out the folder of pull request files. That folder may hold only pull request files, so nothing executable can hide from review in it.
- **Uncommitted changes** are never covered by an approval.

## Ready to merge

Genbeya shows each of these separately, never as one checkbox:

1. **Approvals:** enough effective approvals, as the project requires, and no request for changes still open.
2. **To-dos:** no open to-do left, or the open ones dismissed or turned into tasks.
3. **Mergeable:** the source merges into the target without conflicts, checked without touching the checkout (`git merge-tree`).
4. **Uncommitted changes:** none on the source branch when merging here.

It is advice. Without a server, anyone can still merge with Git; enforcement stays with protected branches on the host. So the project's policy stays small: the number of approvals needed, and whether open to-dos block. No required-reviewer rules, no code owners.

Merging from the pull request uses the merges Genbeya already has, then records `status: merged` and the `merge_commit`.

## Cleaning up

Before the merge, Genbeya offers to settle what is still open, one item at a time:

- **Resolved:** the change was made; the to-do is ticked.
- **Dismissed:** not acted on, with a short reason.
- **Promoted:** turned into a task, or into a decision or note on a wiki page, and replaced by a reference to it.

Afterwards the topics can be shortened to their outcome. The full discussion stays in Git: on the content branch it is never squashed away; in the checkout a squash merge drops the intermediate commits, so teams that need the full history keep the file on the content branch.

## Where the files live

Pull requests are a fourth area, next to the wiki, the tasks and the settings: a folder (`pulls/` unless the settings say otherwise), with `pulls = branch` or `pulls = checkout` in `.genbeya-content`.

| | In the checkout | On the content branch |
| --- | --- | --- |
| The file sits on | the source branch, and merges into the target as the record | the shared content branch, synced by **Sync** |
| Reviewers | commit to the author's branch | never touch the code branch |
| Approval check | leaves the pull request folder out | compares the change as it is |
| Squash merge | drops the discussion's history | keeps it |
| IDs | can collide across branches, as task IDs can | are taken on one shared branch |

## Pull requests and tasks

A pull request names its tasks. Tasks already find their branches by the ID in the branch name ([Branches of a task](../Guide/Tasks.md#branches-of-a-task)); in the same way, a task shows the pull requests of its branches, with their state ("open into develop, 1 of 2 approvals"), and a pull request shows its tasks.

## The view

The one large new piece: a **Pull requests** view, an [optional part](Optional-parts.md).

- A list of pull requests, filtered by state, author and reviewer.
- A pull request shows its description, the computed state (approvals, to-dos, mergeability), and the diff from the target to the source in the existing diff viewer, with the review threads beside the lines they refer to.
- **Comment on lines:** select lines in the diff to start a topic or add a code range to one; type a suggestion as an edit of those lines.
- **Reply, approve, request changes** append to the file; the file stays editable by hand like any other.
- **Outdated:** code ranges whose lines changed since their revision are marked, with the current version a click away.

## Not in the first version

- Nested reply trees, or anchors that only machines can read.
- Moving remarks automatically after rebases or edits.
- Accounts, logins, or a server.
- Applying every suggestion automatically.
- CI, permissions or branch protection: they stay with the host.

## Open questions

- **Line grammar:** the exact form of replies and verdicts, time zones included, documented once with the time log's.
- **IDs:** `PR-7` with its own counter, or the task prefix?
- **Policy defaults:** how many approvals, and whether open to-dos block a merge by default.
- **Squash and rebase merges:** how the merge check compares a squashed or rebased result with the approved change.
- **Trust:** what "verified" means offline and with a forge.
- **References into other repositories:** a code range in a submodule or a sibling repository can't be pinned yet ([pinned references](../Guide/References.md#pinned-to-a-revision) name files of this repository).

The test for the format: can someone without Genbeya open the file, understand the discussion, find the cited code with Git, suggest a change, and see the outcome?
