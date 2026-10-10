/** The parts of the Deno runtime and Deno Desktop (2.9) the shell uses. */
declare namespace Deno {
  const args: string[];
  const build: { readonly os: "windows" | "darwin" | "linux" | string };
  const env: { get(key: string): string | undefined; toObject(): Record<string, string> };
  function execPath(): string;
  function exit(code?: number): never;
  function readFile(path: string | URL): Promise<Uint8Array<ArrayBuffer>>;
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;

  class BrowserWindow extends EventTarget {
    constructor(options?: { title?: string; width?: number; height?: number });
    setTitle(title: string): void;
    executeJs(script: string): Promise<unknown>;
    bind(name: string, handler: (value: never) => unknown): void;
    close(): void;
  }
}
