import { TestBed } from "@angular/core/testing";
import { openRepository } from "../../testing/component-harness";
import { MovePageDialog } from "./move-page-dialog";
import { WikiActions } from "./wiki-actions";

describe("WikiActions.movePage", () => {
  it("moves the page as chosen in the dialog, with or without its links, and opens it", async () => {
    const { dialogs, managers, router } = await openRepository();
    dialogs.open.mockResolvedValue({ to: "docs/Manual.md", updateLinks: true });
    managers.content.movePage.mockResolvedValue("docs/Manual.md");
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    await TestBed.inject(WikiActions).movePage("docs/Guide.md");
    expect(dialogs.open).toHaveBeenCalledWith(MovePageDialog, { path: "docs/Guide.md" });
    expect(managers.content.movePage).toHaveBeenCalledWith("w1", "docs/Guide.md", "docs/Manual.md", { updateLinks: true });
    expect(navigate).toHaveBeenCalledWith(["/wiki"], { queryParams: { page: "docs/Manual.md", anchor: undefined }, replaceUrl: true });
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { dialogs, managers } = await openRepository();
    dialogs.open.mockResolvedValue(undefined);
    await TestBed.inject(WikiActions).movePage("docs/Guide.md");
    expect(managers.content.movePage).not.toHaveBeenCalled();
  });
});
