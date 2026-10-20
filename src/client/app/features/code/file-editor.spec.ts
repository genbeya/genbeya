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
    // The preview renders asynchronously, after the editor.
    await vi.waitFor(() => expect(host.querySelector(".file-preview h1")?.textContent).toBe("Guide"));
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

  it("shows a raster image without reading its text, with its pixel size and file size", async () => {
    const harness = await openRepository();
    harness.managers.content.image.mockResolvedValue("data:image/png;base64,iVBORw0K");
    const fixture = TestBed.createComponent(FileEditor);
    fixture.componentRef.setInput("path", "assets/icon.png");
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(harness.managers.content.image).toHaveBeenCalledWith("w1", "repo", "assets/icon.png");
    expect(harness.managers.content.read).not.toHaveBeenCalled();
    const image = host.querySelector<HTMLImageElement>(".file-preview img")!;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,iVBORw0K");
    expect(image.alt).toBe("icon.png");
    // No editing: no modes, no editor, nothing to save.
    expect(host.querySelector("[role=radio]")).toBeNull();
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect([...host.querySelectorAll("button")].some((button) => button.textContent!.includes("Save"))).toBe(false);
    expect(host.querySelector(".file-facts")!.textContent).toBe("6 B");
    Object.defineProperties(image, { naturalWidth: { value: 96 }, naturalHeight: { value: 64 } });
    image.dispatchEvent(new Event("load"));
    await settle(fixture);
    expect(host.querySelector(".file-facts")!.textContent).toBe("96 × 64 px · 6 B");
  });

  it("says why an image can't be shown", async () => {
    const harness = await openRepository();
    harness.managers.content.image.mockRejectedValue(new Error("assets/huge.png is too large to open."));
    const fixture = TestBed.createComponent(FileEditor);
    fixture.componentRef.setInput("path", "assets/huge.png");
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("assets/huge.png is too large to open.");
  });

  it("keeps Edit, Split and Preview for SVG, which is text", async () => {
    const { host } = await open("logo.svg", "<svg></svg>");
    expect([...host.querySelectorAll("[role=radio]")].map((button) => button.textContent!.trim())).toEqual(["Edit", "Split", "Preview"]);
    expect(host.querySelector(".file-facts")).toBeNull();
  });

  it("only edits files without a preview", async () => {
    const { host } = await open("src/main.ts", "export {};\n");
    expect(host.querySelector("[role=radio]")).toBeNull();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(host.querySelector(".file-preview")).toBeNull();
  });
});
