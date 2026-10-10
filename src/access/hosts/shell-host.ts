/** A POSIX machine reached through a {@link ShellSession}: WSL distributions and SSH servers. */
import { posixPaths } from "../../utilities/native-path";
import type { RunOptions } from "../ports";
import { HostError, type EntryKind, type Host, type HostErrorCode } from "./host";
import { exportVariables, quote, type ShellSession } from "./shell-session";
import type { TerminalCommand } from "./terminal-commands";

/** Exit codes of the file scripts below. */
const FAILURES: Partial<Record<number, HostErrorCode>> = { 3: "SYMLINK", 4: "ENOENT", 5: "NOTFILE", 6: "TOOLARGE", 7: "EXISTS" };

/** Encodes bytes as a POSIX printf format, so file content travels inside the script. */
export function printfFormat(data: Uint8Array): string {
  let format = "";
  data.forEach((byte, i) => {
    // A leading "-" would be parsed as an option by some printf builtins.
    const plain = byte >= 0x20 && byte < 0x7f && byte !== 0x5c && byte !== 0x27 && byte !== 0x25 && (i > 0 || byte !== 0x2d);
    format += plain ? String.fromCharCode(byte) : "\\" + byte.toString(8).padStart(3, "0");
  });
  return format;
}

export class ShellHost implements Host {
  readonly paths = posixPaths;

  constructor(
    private readonly session: ShellSession,
    private readonly terminal: (path: string) => TerminalCommand,
  ) {}

  run(command: string, args: readonly string[], { cwd, timeout, env }: RunOptions) {
    // Each request runs in a subshell of its own, so the variables stay with this command.
    const variables = env && Object.keys(env).length ? `${exportVariables(env)} && ` : "";
    return this.session.exec(`cd ${quote(cwd)} && ${variables}exec ${[command, ...args].map(quote).join(" ")}`, timeout);
  }

  /** Runs a file script with positional parameters; maps its exit code to an error. */
  private async file(relative: string, params: readonly string[], body: string): Promise<Uint8Array> {
    const reply = await this.session.exec(`set -- ${params.map(quote).join(" ")}; ${body}`);
    if (reply.code === 0) return reply.stdout;
    const code = FAILURES[reply.code];
    throw new HostError(code ?? "FAILED", relative, code ? undefined : reply.stderr.trim() || undefined);
  }

  read(root: string, relative: string, limit: number) {
    return this.file(
      relative,
      [root, relative, String(limit)],
      `gd_check "$1" "$2" || exit $?; f=$1/$2; [ -e "$f" ] || exit 4; [ -f "$f" ] || exit 5; ` +
        `n=$(wc -c <"$f"); [ $n -le "$3" ] || exit 6; cat "$f"`,
    );
  }

  async readMany(root: string, relatives: readonly string[], limit: number) {
    if (!relatives.length) return [];
    const out = await this.file(
      root,
      [root, String(limit), ...relatives],
      // Exactly the announced size is sent (cut or zero-padded) even if a file
      // changes in between, so the framing never slips.
      `r=$1; l=$2; shift 2; for p; do f=$r/$p; ` +
        `if gd_check "$r" "$p" && [ -f "$f" ] && n=$(wc -c <"$f") && [ $n -le $l ]; ` +
        `then printf '%s\\n' $n; { head -c "$n" "$f"; head -c "$n" /dev/zero; } | head -c "$n"; ` +
        `else printf -- '-1\\n'; fi; done`,
    );
    const files: (Uint8Array | null)[] = [];
    let offset = 0;
    for (let remaining = relatives.length; remaining > 0; remaining--) {
      const end = out.indexOf(10, offset);
      const size = Number(new TextDecoder().decode(out.subarray(offset, end)));
      offset = end + 1;
      if (size < 0) files.push(null);
      else {
        files.push(out.slice(offset, offset + size));
        offset += size;
      }
    }
    return files;
  }

  async write(root: string, relative: string, data: Uint8Array, exclusive: boolean) {
    await this.file(
      relative,
      [root, relative, exclusive ? "1" : "0"],
      `gd_check "$1" "$2" || exit $?; f=$1/$2; mkdir -p -- "$(dirname -- "$f")" || exit 1; ` +
        `gd_check "$1" "$2" || exit $?; if [ "$3" = 1 ]; then [ -e "$f" ] && exit 7; set -C; fi; ` +
        `printf '${printfFormat(data)}' >"$f"`,
    );
  }

  async kind(root: string, relative: string): Promise<EntryKind> {
    const out = await this.file(
      relative,
      [root, relative],
      `gd_check "$1" "$2" || exit $?; f=$1/$2; if [ -d "$f" ]; then echo dir; elif [ -f "$f" ]; then echo file; fi`,
    );
    const kind = new TextDecoder().decode(out).trim();
    return kind === "dir" || kind === "file" ? kind : null;
  }

  async remove(root: string, relative: string) {
    await this.file(
      relative,
      [root, relative],
      `gd_check "$1" "$2" || exit $?; f=$1/$2; [ -e "$f" ] || exit 4; [ -f "$f" ] || exit 5; rm -f -- "$f"`,
    );
  }

  async move(root: string, from: string, to: string) {
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    await this.file(
      to,
      [root, from, to, caseOnly ? "1" : "0"],
      // A rename by case only on a case-insensitive file system finds the
      // target as the source itself; it goes through a temporary name.
      `gd_check "$1" "$2" || exit $?; gd_check "$1" "$3" || exit $?; f=$1/$2; t=$1/$3; [ -e "$f" ] || exit 4; ` +
        `if [ -e "$t" ]; then { [ "$4" = 1 ] && [ "$f" -ef "$t" ]; } || exit 7; m=$f.gitdesk-$$; mv -- "$f" "$m" && mv -- "$m" "$t"; ` +
        `else mkdir -p -- "$(dirname -- "$t")" && mv -- "$f" "$t"; fi`,
    );
  }

  async terminalCommand(path: string) {
    return this.terminal(path);
  }

  dispose() {
    this.session.dispose();
  }
}
