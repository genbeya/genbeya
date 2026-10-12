# MIT No Attribution License for the files Genbeya writes

Genbeya is licensed under the Functional Source License, Version 1.1, ALv2 Future License ([LICENSE.md](LICENSE.md)). As an exception, the following are licensed under the MIT No Attribution License (MIT-0) below, so that you may use, change and share the files Genbeya writes into your repositories however you like, without keeping any notice:

1. The text Genbeya creates or updates in a repository it works with. Whatever you or others write into these files stays yours or theirs.
   - The agent skill: `.claude/skills/genbeya/SKILL.md` and `.agents/skills/genbeya/SKILL.md`.
   - The Genbeya block, from `<!-- genbeya:begin -->` to `<!-- genbeya:end -->`, in `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md`.
   - The sample project (`genbeya-sample`), including the history the web demo adds to it.
   - New `.genbeya.yml` settings files.
   - Task description templates (`tasks/.templates/<type>.md`, in the configured task folder).
   - The `.genbeya-content` file on a content branch.
2. The source files of Genbeya that hold that text. In these files the exception covers the text they write into repositories (the templates and the strings they are assembled from), not the other code in them. Each of them says so in a comment at its top.
   - `src/engines/agent-instructions.ts`: the agent skill and the section of the Genbeya block.
   - `src/engines/agent-engine.ts`: the marker lines of the Genbeya block.
   - `src/engines/sample-engine.ts`: the sample project.
   - `src/engines/demo-engine.ts`: the history the web demo adds to the sample project.
   - `src/engines/task-engine.ts`: new task description templates.
   - `src/engines/settings-engine.ts`: the defaults of new `.genbeya.yml` settings files.
   - `src/access/content/content-store.ts`: the `.genbeya-content` file.
3. This repository's own copies of the generated agent files: `.claude/skills/genbeya/`, `.agents/skills/genbeya/` and the Genbeya block in `AGENTS.md` and `CLAUDE.md`.

Everything else in this repository is licensed under [LICENSE.md](LICENSE.md).

---

MIT No Attribution

Copyright 2026 Emanuel Knecht

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
