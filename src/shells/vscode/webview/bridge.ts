/** The webview's side of the message channel to the extension. */
import type { FromWebview, ToWebview } from "./protocol";

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type Request = Extract<FromWebview, { id: number }>;
type RequestOf<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;

export class Bridge {
  private readonly api = acquireVsCodeApi();
  private next = 0;
  private readonly pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();

  constructor(receive: (message: Exclude<ToWebview, { type: "reply" }>) => void) {
    window.addEventListener("message", (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type !== "reply") return receive(message);
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) request?.reject(new Error(message.error));
      else request?.resolve(message.value ?? "");
    });
    this.post({ type: "ready" });
  }

  /** What the webview keeps across reloads and restarts of VS Code: its document, the board's choices. */
  get state(): unknown {
    return this.api.getState();
  }

  set state(state: unknown) {
    this.api.setState(state);
  }

  post(message: Exclude<FromWebview, Request>): void {
    this.api.postMessage(message);
  }

  /** Asks the extension for an image or a file; resolves to its reply. */
  request<T extends Request["type"]>(request: RequestOf<T> & { type: T }): Promise<string> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.api.postMessage({ ...request, id } as Request);
    });
  }
}
