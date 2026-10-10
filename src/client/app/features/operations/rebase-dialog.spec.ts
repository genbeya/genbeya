import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { RebaseCommit } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { problemOf, RebaseDialog, type RebaseRequest, type Row, squashMessage, withSquashMessages } from "./rebase-dialog";

const commit = (hash: string, message: string): RebaseCommit => ({
  hash: hash.repeat(40),
  subject: message,
  message,
  author: "Ann",
  date: "2026-01-01T00:00:00Z",
  merge: false,
});
const [one, two, three] = [commit("a", "One"), commit("b", "Two"), commit("c", "Three")];

async function render(request: Partial<RebaseRequest> = {}) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DIALOG_DATA,
        useValue: { plan: { base: "f".repeat(40), commits: [one, two, three], pushed: [] }, branch: "main", dirty: false, ...request },
      },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(RebaseDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const choose = async (index: number, action: string) => {
    const select = element.querySelectorAll<HTMLSelectElement>("select")[index]!;
    select.value = action;
    select.dispatchEvent(new Event("change"));
    await settle(fixture);
  };
  const submit = () => element.querySelector("form")!.dispatchEvent(new Event("submit"));
  return { fixture, element, close, choose, submit };
}

describe("RebaseDialog", () => {
  it("lists the commits oldest first and picks them all by default", async () => {
    const { element, submit, close } = await render();
    expect([...element.querySelectorAll(".rebase-subject")].map((subject) => subject.textContent)).toEqual(["One", "Two", "Three"]);
    submit();
    expect(close).toHaveBeenCalledWith([one, two, three].map(({ hash }) => ({ hash, action: "pick" })));
  });

  it("squashes with the joined message, which can be edited", async () => {
    const { element, choose, submit, close, fixture } = await render();
    await choose(1, "squash");
    const message = element.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(message.value).toBe("One\n\nTwo");
    message.value = "One and two";
    message.dispatchEvent(new Event("input"));
    await choose(2, "drop");
    await settle(fixture);
    submit();
    expect(close).toHaveBeenCalledWith([
      { hash: one.hash, action: "pick" },
      { hash: two.hash, action: "squash", message: "One and two" },
      { hash: three.hash, action: "drop" },
    ]);
  });

  it("keeps an unwritten squash message joined from the rows as they are now, and leaves it to the backend", async () => {
    const { element, choose, submit, close, fixture } = await render();
    await choose(1, "squash");
    const message = () => element.querySelectorAll<HTMLTextAreaElement>("textarea");
    expect(message()[0]!.value).toBe("One\n\nTwo");
    // The commit it joins is reworded, then the squash moves below another commit.
    await choose(0, "reword");
    message()[0]!.value = "Better";
    message()[0]!.dispatchEvent(new Event("input"));
    await settle(fixture);
    expect(message()[1]!.value).toBe("Better\n\nTwo");
    (fixture.componentInstance as unknown as { move(event: object): void }).move({ previousIndex: 1, currentIndex: 2 });
    await settle(fixture);
    expect(message()[1]!.value).toBe("Three\n\nTwo");
    submit();
    expect(close).toHaveBeenCalledWith([
      { hash: one.hash, action: "reword", message: "Better" },
      { hash: three.hash, action: "pick" },
      { hash: two.hash, action: "squash" },
    ]);
  });

  it("refuses to squash the first commit, and warns about pushed commits", async () => {
    const { element, choose, submit, close } = await render({
      plan: { base: "f".repeat(40), commits: [one, two, three], pushed: ["origin/main"] },
    });
    expect(element.querySelector(".rebase-warning")!.textContent).toContain("origin/main");
    await choose(0, "fixup");
    expect(element.querySelector(".dialog-error")!.textContent).toContain("can't be squashed");
    submit();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("rebase rows", () => {
  const row = (base: RebaseCommit, action: Row["action"], message = base.message): Row => ({ commit: base, action, message });

  it("joins a squash with the message of the commit it joins, skipping drops and fixups", () => {
    expect(squashMessage([row(one, "reword", "Better"), row(two, "drop"), row(three, "squash")], 2)).toBe("Better\n\nThree");
    expect(squashMessage([row(one, "pick"), row(two, "fixup"), row(three, "squash")], 2)).toBe("One\n\nThree");
  });

  it("joins every unwritten squash message in order, keeping written ones", () => {
    const rows = withSquashMessages([row(one, "pick"), row(two, "squash", ""), row(three, "squash", "")]);
    expect(rows.map((each) => each.message)).toEqual(["One", "One\n\nTwo", "One\n\nTwo\n\nThree"]);
    expect(withSquashMessages([row(one, "pick"), { ...row(two, "squash", "Mine"), edited: true }])[1]!.message).toBe("Mine");
  });

  it("needs a kept commit first and messages for rewords", () => {
    expect(problemOf([row(one, "drop"), row(two, "squash")])).toMatch(/can't be squashed/);
    expect(problemOf([row(one, "reword", " ")])).toBe("Reworded commits need a message.");
    expect(problemOf([row(one, "pick"), row(two, "fixup")])).toBeNull();
  });
});
