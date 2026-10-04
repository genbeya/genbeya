import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { HostError, type EntryKind, type Host, type RunOptions } from "./host.js";

export const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Encodes bytes as a POSIX printf format, so file content travels inside the script. */
export function printfFormat(data: Buffer): string {
  const parts: string[] = [];
  data.forEach((byte, i) =>
    parts.push(
      // A leading "-" would be parsed as an option by some printf builtins.
      byte >= 0x20 && byte < 0x7f && byte !== 0x5c && byte !== 0x27 && byte !== 0x25 && (i || byte !== 0x2d)
        ? String.fromCharCode(byte)
        : "\\" + byte.toString(8).padStart(3, "0"),
    ),
  );
  return parts.join("");
}

const BOOTSTRAP = `
T=$(mktemp -d 2>/dev/null || mktemp -d -t gitdesk) || exit 1
trap 'rm -rf "$T"' EXIT
export GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0
gd_check() { ( set -f; c=$1; IFS=/; for s in $2; do c=$c/$s; if [ -L "$c" ]; then exit 3; fi; done ) }
printf '\\nGDK-READY\\n'
`;

interface Reply {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * One long-lived `sh` on the target machine (through `wsl.exe` or `ssh`).
 * Requests run one at a time in a subshell; their output is staged in temp
 * files and returned with a length-prefixed header, so binary output is safe
 * and one connection serves every operation.
 */
export class ShellSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private notify: (() => void) | null = null;
  private diagnostics = "";
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly label: string,
  ) {}

  exec(script: string, timeout = 60_000): Promise<Reply> {
    const result = this.queue.then(() => this.send(script, timeout));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Closes the session for good; queued requests fail instead of reconnecting. */
  dispose() {
    this.disposed = true;
    this.reset();
  }

  private reset() {
    this.child?.kill();
    this.child = null;
  }

  private async send(script: string, timeout: number): Promise<Reply> {
    if (this.disposed) throw new Error(`The connection to ${this.label} is closed.`);
    await this.connect();
    const deadline = Date.now() + timeout;
    this.child!.stdin.write(
      `( ${script}\n) </dev/null >"$T/o" 2>"$T/e"; r=$?; ` +
        `printf 'GDK %s %s %s\\n' "$r" $(wc -c <"$T/o") $(wc -c <"$T/e"); cat "$T/o" "$T/e"\n`,
    );
    try {
      const header = /^GDK (\d+) (\d+) (\d+)$/.exec(await this.line(deadline));
      if (!header) throw new Error(`Unexpected reply from ${this.label}.`);
      const stdout = await this.take(Number(header[2]), deadline);
      const stderr = await this.take(Number(header[3]), deadline);
      return { code: Number(header[1]), stdout, stderr: stderr.toString("utf8") };
    } catch (error) {
      // The stream is out of step once a request fails; start over next time.
      this.reset();
      throw error;
    }
  }

  private connect() {
    if (this.child) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  private async start() {
    this.buffer = Buffer.alloc(0);
    this.diagnostics = "";
    const child = spawn(this.command, this.args, { windowsHide: true });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.notify?.();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.diagnostics = (this.diagnostics + chunk.toString("utf8")).slice(-4000);
    });
    const ended = () => {
      if (this.child === child) this.child = null;
      this.notify?.();
    };
    child.on("exit", ended);
    child.on("error", (error) => {
      this.diagnostics ||= error.message;
      ended();
    });
    child.stdin.on("error", () => undefined);
    child.stdin.write(BOOTSTRAP);
    const deadline = Date.now() + 30_000;
    try {
      // Login scripts may print banners; skip everything before the marker.
      while ((await this.line(deadline, child)) !== "GDK-READY");
    } catch (error) {
      if (this.child === child) this.reset();
      throw error;
    }
  }

  private async wait(deadline: number, child = this.child) {
    if (!child || child !== this.child)
      throw new Error(
        `Lost the connection to ${this.label}.` +
          (this.diagnostics.trim() ? ` ${this.diagnostics.trim()}` : ""),
      );
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`${this.label} did not respond in time.`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      this.notify = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.notify = null;
  }

  private async line(deadline: number, child = this.child) {
    let end: number;
    while ((end = this.buffer.indexOf(10)) < 0) await this.wait(deadline, child);
    const text = this.buffer.subarray(0, end).toString("utf8").replace(/\r$/, "");
    this.buffer = this.buffer.subarray(end + 1);
    return text;
  }

  private async take(length: number, deadline: number) {
    while (this.buffer.length < length) await this.wait(deadline);
    const data = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return Buffer.from(data);
  }
}

const FAILURES: Record<number, ConstructorParameters<typeof HostError>[0]> = {
  3: "SYMLINK",
  4: "ENOENT",
  5: "NOTFILE",
  6: "TOOLARGE",
  7: "EXISTS",
};

/** A POSIX machine reached through a {@link ShellSession}. */
export class ShellHost implements Host {
  readonly posix = true;

  constructor(private readonly session: ShellSession) {}

  join(root: string, relative: string) {
    return path.posix.join(root, relative);
  }

  async run(command: string, args: string[], { cwd, timeout }: RunOptions) {
    return this.session.exec(
      `cd ${quote(cwd)} && exec ${[command, ...args].map(quote).join(" ")}`,
      timeout,
    );
  }

  /** Runs a file script with positional parameters; maps exit codes to errors. */
  private async file(relative: string, params: string[], body: string) {
    const reply = await this.session.exec(
      `set -- ${params.map(quote).join(" ")}; ${body}`,
    );
    if (reply.code === 0) return reply.stdout;
    throw new HostError(
      FAILURES[reply.code] ?? "FAILED",
      relative,
      FAILURES[reply.code] ? undefined : reply.stderr.trim() || undefined,
    );
  }

  read(root: string, relative: string, limit: number) {
    return this.file(
      relative,
      [root, relative, String(limit)],
      `gd_check "$1" "$2" || exit $?; f=$1/$2; [ -e "$f" ] || exit 4; [ -f "$f" ] || exit 5; ` +
        `n=$(wc -c <"$f"); [ $n -le "$3" ] || exit 6; cat "$f"`,
    );
  }

  async readMany(root: string, relatives: string[], limit: number) {
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
    const files: (Buffer | null)[] = [];
    let offset = 0;
    for (let i = 0; i < relatives.length; i++) {
      const end = out.indexOf(10, offset);
      const size = Number(out.subarray(offset, end).toString());
      offset = end + 1;
      if (size < 0) files.push(null);
      else {
        files.push(out.subarray(offset, offset + size));
        offset += size;
      }
    }
    return files;
  }

  async write(root: string, relative: string, data: Buffer, exclusive: boolean) {
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
    const kind = out.toString().trim();
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
    await this.file(
      to,
      [root, from, to],
      `gd_check "$1" "$2" || exit $?; gd_check "$1" "$3" || exit $?; f=$1/$2; t=$1/$3; ` +
        `[ -e "$f" ] || exit 4; [ -e "$t" ] && exit 7; mkdir -p -- "$(dirname -- "$t")" && mv -- "$f" "$t"`,
    );
  }

  dispose() {
    this.session.dispose();
  }
}
