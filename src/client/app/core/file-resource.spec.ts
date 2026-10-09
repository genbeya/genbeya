import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../testing/component-harness";
import { snapshot } from "../testing/fake-platform";
import { fileResource, stripFrontmatter } from "./file-resource";

@Component({ template: "" })
class Host {
  readonly path = signal<string | null>("docs/A.md");
  readonly editing = signal(false);
  readonly resource = fileResource("content", this.path, this.editing);
}

const file = (content: string, hash: string) => ({ scope: "content" as const, path: "docs/A.md", content, hash });

describe("fileResource", () => {
  it("loads the file and follows changes on disk", async () => {
    const { managers, session } = await openRepository();
    managers.content.read.mockResolvedValue(file("one", "h1"));
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const { resource } = fixture.componentInstance;
    expect(resource.file()?.content).toBe("one");

    managers.content.read.mockResolvedValue(file("two", "h2"));
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2" }));
    await session.refresh();
    await settle(fixture);
    expect(resource.file()?.content).toBe("two");
  });

  it("reports changes on disk instead of replacing the file while editing", async () => {
    const { managers, session } = await openRepository();
    managers.content.read.mockResolvedValue(file("one", "h1"));
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    fixture.componentInstance.editing.set(true);
    managers.content.read.mockResolvedValue(file("two", "h2"));
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2" }));
    await session.refresh();
    await settle(fixture);
    const { resource } = fixture.componentInstance;
    expect(resource.file()?.content).toBe("one");
    expect(resource.changedOnDisk()).toBe(true);
    await resource.reload();
    expect(resource.file()?.content).toBe("two");
    expect(resource.changedOnDisk()).toBe(false);
  });

  it("keeps a saved version that a read started before the save would overwrite", async () => {
    const { managers, session } = await openRepository();
    managers.content.read.mockResolvedValue(file("one", "h1"));
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const { resource } = fixture.componentInstance;
    let answer!: (value: unknown) => void;
    managers.content.read.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2" }));
    await session.refresh();
    await settle(fixture);
    resource.set(file("saved", "h3"));
    answer(file("two", "h2"));
    await settle(fixture);
    expect(resource.file()?.content).toBe("saved");
  });

  it("reports files that cannot be read", async () => {
    const { managers } = await openRepository();
    managers.content.read.mockRejectedValue(new Error("docs/A.md does not exist."));
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    expect(fixture.componentInstance.resource.error()).toBe("docs/A.md does not exist.");
  });
});

it("strips YAML frontmatter", () => {
  expect(stripFrontmatter("---\na: 1\n---\n# Title\n")).toBe("# Title\n");
  expect(stripFrontmatter("# Title\n")).toBe("# Title\n");
});
