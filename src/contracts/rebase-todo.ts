/** The todo list of an interactive rebase, as the rebase engine writes it and Git access runs it. */

export type TodoLine =
  | { readonly command: "pick" | "fixup" | "drop"; readonly hash: string }
  /** Amends the commit just made with `messages[message]`. */
  | { readonly command: "amend"; readonly message: number };

export interface RebaseTodo {
  readonly lines: readonly TodoLine[];
  readonly messages: readonly string[];
}
