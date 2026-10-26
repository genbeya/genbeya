# Pinned references

> [!NOTE]
> Proposal, not built yet. Task: [[GENBEYA-42]].

A [file reference](../Guide/References.md#files-and-lines) always shows the file as it is in the checkout now. A **pinned reference** names a revision as well, and shows the lines as they were in that commit:

```markdown
[[src/auth/login.ts#L42-L48@3f9c0e1d2b7a4c58e6f1a9b0d3c7e2f4a8b6c1d0]]
![[src/auth/login.ts#L42-L48@v0.1.0]]
```

[Pull requests](Pull-requests.md) need it, since review remarks are about the code a reviewer saw, not about whatever the lines hold later. It is useful on its own as well: a page can embed code as it was in a release, and a task can point at the lines a bug was found in.

## Behaviour

- **Revision:** a full commit ID, or any name Git resolves, such as a tag. Genbeya writes full commit IDs when it creates a pinned reference (from a pull request, or by copying a link to a selection in **History**), since branch names move and short IDs can become ambiguous. It shows them shortened.
- **Shown as** the path, the lines and the short revision. Clicking opens the file at that revision, read-only, with the lines selected.
- **Embeds** (`![[…@rev]]`) show the lines of that revision, highlighted by the file's language, under a link to them.
- **Outdated:** when the lines differ from the checkout, the reference says so and offers the current version. Genbeya doesn't try to move the lines to where the code went; when the code moved, a person writes a new reference.
- **Missing revision:** a commit that is not in the clone (not fetched yet, or gone after a force push) shows dashed with a tooltip, like a missing file.
- **Unchanged:** references without `@` keep showing the checkout, saved but uncommitted edits included.

Reading a file at a revision already exists, for **History** and for comparing images, so this is mostly a matter of the link engine and the reference renderer.

## Open questions

- **Grammar:** paths can contain `@` (`node_modules/@types/…`). Reading the revision only after the line range (`#L42-L48@rev`) is unambiguous, but leaves whole files without a way to pin them. Options: `#@rev` for a whole file, or a different separator.
- Does a pinned reference to a wiki page (`[[Page@v0.1.0]]`) make sense, to show a page as it was?
