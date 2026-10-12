/**
 * Builds the demo's repository: the sample project's commits (made as
 * Genbeya, as `workspace.createSample` makes them), the demo's own history
 * on top, a remote that has it all, and the sample's last change left to
 * commit.
 */
import { MemoryRepository, type Identity } from "../../access/memory/memory-repository";
import type { DemoEngine } from "../../engines/demo-engine";
import type { SampleEngine, SampleFile } from "../../engines/sample-engine";

const SAMPLE_AUTHOR: Identity = { name: "Genbeya", email: "sample@genbeya.invalid" };
const HOUR = 3_600_000;
export const DEMO_REMOTE = "origin";

export interface DemoRepositoryOptions {
  /** Who the visitor commits as. */
  readonly identity: Identity;
  readonly now: () => Date;
}

/** The sample's repository alone, as a new user creates it from the welcome screen. */
export function createSampleRepository(sample: SampleEngine, options: DemoRepositoryOptions): MemoryRepository {
  const repository = new MemoryRepository(options);
  for (const step of sample.steps()) {
    for (const file of step.files) repository.write(file.path, file.content);
    if (step.message) commit(repository, step.files, step.message, SAMPLE_AUTHOR);
  }
  return repository;
}

/** The repository the demo opens with. */
export function createDemoRepository(
  engines: { sample: SampleEngine; demo: DemoEngine },
  options: DemoRepositoryOptions,
): MemoryRepository {
  // Commits are dated in the past while the history is built.
  let building: Date | null = null;
  const repository = new MemoryRepository({ identity: options.identity, now: () => building ?? options.now() });
  const ago = (hours: number) => new Date(options.now().getTime() - hours * HOUR);
  const steps = engines.sample.steps();
  const committed = steps.filter((step) => step.message);
  committed.forEach((step, index) => {
    building = ago(engines.demo.sampleHoursAgo(index));
    commit(repository, step.files, step.message!, SAMPLE_AUTHOR);
  });

  // A clone records the remote's default branch.
  repository.sync.set(DEMO_REMOTE, engines.demo.remoteUrl);
  repository.remotes.get(DEMO_REMOTE)!.head = "main";
  repository.remoteHeads.set(DEMO_REMOTE, "main");
  const committedFile = (path: string) => committed.flatMap((step) => step.files).findLast((file) => file.path === path)!.content;
  for (const step of engines.demo.steps(committedFile("README.md"), committedFile("docs/Architecture/Forecast-source.md"))) {
    switch (step.kind) {
      case "tag":
        repository.createTag(step.name, repository.headCommit()!, step.message);
        break;
      case "branch":
        repository.createBranch(step.name, repository.headCommit()!);
        break;
      case "switch":
        repository.switchTo({ branch: step.branch });
        break;
      case "push":
        repository.sync.push({ branch: step.branch, remote: DEMO_REMOTE, remoteBranch: step.branch, setUpstream: true });
        break;
      case "commit": {
        building = ago(step.hoursAgo);
        const signature = repository.signature(step.author);
        if (!step.remote) {
          commit(repository, step.files, step.message, step.author);
          break;
        }
        // A commit someone else pushed: only the remote has it until a fetch.
        const server = repository.remotes.get(DEMO_REMOTE)!;
        const tip = server.branches.get(step.remote.branch)!;
        const tree = new Map(repository.treeOf(tip));
        for (const file of step.files) tree.set(file.path, file.content);
        server.branches.set(step.remote.branch, repository.writeCommit(tree, [tip], step.message, signature, signature).hash);
      }
    }
  }
  building = null;
  // The sample's last step is a change to commit.
  for (const step of steps.filter((entry) => !entry.message)) for (const file of step.files) repository.write(file.path, file.content);
  return repository;
}

/** Writes files into the working tree and commits them as `author`. */
function commit(repository: MemoryRepository, files: readonly SampleFile[], message: string, author: Identity): void {
  for (const file of files) repository.write(file.path, file.content);
  repository.add(files.map((file) => file.path));
  repository.commit(message, false, author);
}
