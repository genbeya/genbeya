import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { AGENT_TARGETS, type AgentFile, type AgentTarget } from "../../../../contracts/model";
import { messageOf, Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";

const DESCRIPTIONS: Readonly<Record<AgentTarget, { title: string; hint: string }>> = {
  claudeSkill: {
    title: "Skill for Claude Code",
    hint: "Claude Code loads it when a task calls for it; GitHub Copilot, Cursor and OpenCode read it too.",
  },
  agentsSkill: {
    title: "Skill for other agents",
    hint: "The shared skill folder of Codex, Gemini CLI, GitHub Copilot, Cursor, OpenCode and others.",
  },
  agents: {
    title: "Instructions for all agents",
    hint: "Codex, Copilot, Cursor and most other agents read it in every session. GitDesk adds a marked section.",
  },
  claude: {
    title: "Instructions for Claude Code",
    hint: "Imports AGENTS.md when that is added too, and holds the GitDesk section otherwise.",
  },
  copilot: { title: "Instructions for GitHub Copilot", hint: "Only needed for Copilot setups that do not read AGENTS.md." },
};

const STATES: Readonly<Record<AgentFile["state"], string>> = { missing: "Not added", current: "Up to date", outdated: "Outdated" };

/** Added unless the repository already has some of the files. */
const DEFAULT_TARGETS: readonly AgentTarget[] = ["claudeSkill", "agentsSkill", "agents", "claude"];

const files = (count: number) => (count === 1 ? "1 agent file" : `${count} agent files`);

/** The files that teach coding agents to use GitDesk: which to add, their state, and what they say. */
@Component({
  selector: "gd-agent-files",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "settings-card" },
  template: `
    @for (file of files(); track file.target) {
      <div class="agent-file">
        <input
          #box
          type="checkbox"
          [id]="'agent-' + file.target"
          [attr.data-path]="file.path"
          [checked]="selected().includes(file.target)"
          (change)="choose(file.target, box.checked)"
        />
        <div class="setting-label">
          <label [for]="'agent-' + file.target"
            >{{ descriptions[file.target].title }} <code class="selectable">{{ file.path }}</code></label
          >
          <small>{{ descriptions[file.target].hint }}</small>
          @if (file.ignored) {
            <small class="agent-warning">Ignored by .gitignore, so it would not be committed.</small>
          }
        </div>
        <span class="agent-state" [class]="'is-' + file.state">{{ states[file.state] }}</span>
        <details class="agent-preview">
          <summary>Preview</summary>
          <pre class="selectable">{{ file.text }}</pre>
        </details>
      </div>
    }
    @if (error(); as error) {
      <p class="agent-error">{{ error }}</p>
    }
    <div class="agent-actions">
      <small class="grow">Files are written to the checkout. Review and commit them in Changes, like code.</small>
      <button type="button" class="btn btn-primary btn-m" [disabled]="!action().enabled" (click)="add()">{{ action().label }}</button>
    </div>
  `,
})
export class AgentFiles {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly notifications = inject(Notifications);
  protected readonly descriptions = DESCRIPTIONS;
  protected readonly states = STATES;
  /** Null until the first answer shows which files the repository has. */
  private readonly selection = signal<readonly AgentTarget[] | null>(null);
  protected readonly selected = computed(() => this.selection() ?? DEFAULT_TARGETS);
  protected readonly files = signal<readonly AgentFile[]>([]);
  protected readonly error = signal<string | null>(null);
  private request = 0;
  /**
   * What the files' states depend on: the settings, the checked-out commit
   * and uncommitted changes to the files. Other snapshots change none of it.
   */
  private readonly inputs = computed(() => {
    const snapshot = this.session.snapshot();
    if (!snapshot) return "";
    const paths = this.files().map((file) => file.path);
    // Untracked folders show as one change, such as ".claude/".
    const touches = (path: string) => paths.some((file) => file === path || (path.endsWith("/") && file.startsWith(path)));
    const changes = snapshot.changes.filter((change) => touches(change.path));
    return JSON.stringify([snapshot.settingsHash, snapshot.settings, snapshot.head.commit, changes]);
  });

  protected readonly action = computed(() => {
    const chosen = this.files().filter((file) => this.selected().includes(file.target));
    if (this.error() || !chosen.length) return { label: "Add to repository", enabled: false };
    if (chosen.some((file) => file.state === "missing")) return { label: "Add to repository", enabled: true };
    if (chosen.some((file) => file.state === "outdated")) return { label: "Update", enabled: true };
    return { label: "Up to date", enabled: false };
  });

  constructor() {
    // The choice changes what the files say about each other.
    effect(() => {
      this.inputs();
      const targets = this.selected();
      untracked(() => void this.load(targets));
    });
  }

  protected choose(target: AgentTarget, chosen: boolean) {
    const selected = this.selected();
    this.selection.set(AGENT_TARGETS.filter((other) => (other === target ? chosen : selected.includes(other))));
  }

  protected async add() {
    const written = await this.session.run(() => this.api.content.addAgentFiles(this.selected()));
    if (!written) return;
    const created = written.filter((file) => file.result === "created").length;
    const updated = written.filter((file) => file.result === "updated").length;
    const verb = !updated ? "Added" : !created ? "Updated" : "Added and updated";
    this.notifications.success(
      created + updated ? `${verb} ${files(created + updated)}. Review and commit them in Changes.` : "The agent files are up to date.",
    );
    // Ignored files leave the snapshot as it was.
    await this.load(this.selected());
  }

  private async load(targets: readonly AgentTarget[]) {
    const ticket = ++this.request;
    try {
      const files = await this.api.content.agentFiles(targets);
      if (ticket !== this.request) return;
      this.files.set(files);
      this.error.set(null);
      if (this.selection() === null) {
        const present = files.filter((file) => file.state !== "missing").map((file) => file.target);
        this.selection.set(present.length ? present : DEFAULT_TARGETS);
      }
    } catch (failure) {
      if (ticket === this.request) this.error.set(messageOf(failure));
    }
  }
}
