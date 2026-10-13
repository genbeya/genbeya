import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import { FileEditor } from "./file-editor";

async function open(path: string, content: string) {
  const harness = await openRepository();
  harness.managers.content.read.mockResolvedValue({ scope: "repo", path, content, hash: "h1" });
  const fixture = TestBed.createComponent(FileEditor);
  fixture.componentRef.setInput("path", path);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const choose = async (mode: string) => {
    [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((button) => button.textContent!.trim() === mode)!.click();
    await settle(fixture);
  };
  return { host, choose };
}

describe("FileEditor", () => {
  it("offers Edit, Split and Preview for Markdown, and shows both side by side", async () => {
    const { host, choose } = await open("docs/Guide.md", "# Guide\n\nText.\n");
    expect([...host.querySelectorAll("[role=radio]")].map((button) => button.textContent!.trim())).toEqual(["Edit", "Split", "Preview"]);
    await choose("Split");
    expect(host.querySelector(".file-body")!.classList).toContain("is-split");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(host.querySelector(".file-preview h1")?.textContent).toBe("Guide");
    // The chosen mode is remembered for the next file; the next test starts editing.
    await choose("Edit");
  });

  it("draws a Mermaid file as a diagram", async () => {
    const { host, choose } = await open("flows/login.mmd", "graph TD\n  A --> B\n");
    await choose("Preview");
    expect(host.querySelector(".cm-editor")).toBeNull();
    await vi.waitFor(() => expect(host.querySelector(".file-preview .md-diagram img")).not.toBeNull());
    await choose("Edit");
  });

  it("shows an SVG file as an image", async () => {
    const { host, choose } = await open("logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await choose("Preview");
    expect(host.querySelector<HTMLImageElement>(".svg-preview img")?.src).toMatch(/^blob:/);
    await choose("Edit");
  });

  it("only edits files without a preview", async () => {
    const { host } = await open("src/main.ts", "export {};\n");
    expect(host.querySelector("[role=radio]")).toBeNull();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(host.querySelector(".file-preview")).toBeNull();
  });
});
