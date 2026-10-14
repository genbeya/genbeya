import { branchesOfTask, branchNameFor, taskOfBranch } from "./task-branches";

describe("branchesOfTask", () => {
  it("finds local and remote branches that name the task, in any case and place", () => {
    const local = ["main", "GENBEYA-32-branch-links", "feature/genbeya-32", "GENBEYA-320-other", "xGENBEYA-32"];
    const remote = ["origin/GENBEYA-32-review", "origin/main"];
    expect(branchesOfTask("GENBEYA-32", local, remote)).toEqual([
      { name: "GENBEYA-32-branch-links", remote: false },
      { name: "feature/genbeya-32", remote: false },
      { name: "origin/GENBEYA-32-review", remote: true },
    ]);
  });

  it("finds none for a task without branches", () => {
    expect(branchesOfTask("GENBEYA-7", ["main", "GENBEYA-70"], [])).toEqual([]);
  });
});

describe("taskOfBranch", () => {
  const ids = new Set(["GENBEYA-32", "GENBEYA-4"]);

  it("finds the task a branch is named after", () => {
    expect(taskOfBranch("feature/genbeya-32-links", "GENBEYA", ids)).toBe("GENBEYA-32");
    expect(taskOfBranch("GENBEYA-4", "GENBEYA", ids)).toBe("GENBEYA-4");
  });

  it("skips IDs of tasks that don't exist, and parts of longer IDs", () => {
    expect(taskOfBranch("GENBEYA-99-and-GENBEYA-4", "GENBEYA", ids)).toBe("GENBEYA-4");
    expect(taskOfBranch("GENBEYA-321", "GENBEYA", ids)).toBeNull();
    expect(taskOfBranch("main", "GENBEYA", ids)).toBeNull();
  });
});

describe("branchNameFor", () => {
  it("joins the ID and a short form of the title", () => {
    expect(branchNameFor("GENBEYA-32", "Link branches to tasks by the task ID")).toBe("GENBEYA-32-link-branches-to-tasks-by-the-task-id");
    expect(branchNameFor("GENBEYA-1", "Größe & Ä — fix!")).toBe("GENBEYA-1-grosse-a-fix");
    expect(branchNameFor("GENBEYA-2", "???")).toBe("GENBEYA-2");
  });
});
