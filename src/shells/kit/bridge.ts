/**
 * The kit's side of the channel to its host: the host sets
 * `window.genbeyaKitHost` before the kit loads, the kit sets
 * `window.genbeyaKit` once it has started. Messages are JSON strings, which
 * every web view can carry.
 */
import { checkFromKit, parseToKit, ProtocolError, type FromKit, type ToKit } from "./protocol";

declare global {
  interface Window {
    genbeyaKitHost?: { post(message: string): void };
    genbeyaKit?: { receive(message: string): void };
  }
}

type Request = Extract<FromKit, { id: number }>;
type RequestOf<T extends Request["type"]> = Omit<Extract<Request, { type: T }>, "id">;

export class KitBridge {
  private next = 0;
  private readonly pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>();

  constructor(receive: (message: Exclude<ToKit, { type: "reply" }>) => void) {
    window.genbeyaKit = {
      receive: (json: string) => {
        let message: ToKit;
        try {
          message = parseToKit(json);
        } catch (error) {
          return this.post({ type: "error", message: error instanceof ProtocolError ? error.message : String(error) });
        }
        if (message.type !== "reply") return receive(message);
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) request?.reject(new Error(message.error));
        else request?.resolve(message.value ?? "");
      },
    };
  }

  post(message: Exclude<FromKit, Request>): void {
    this.send(message);
  }

  /** Asks the host for an image, a file or the plan's history; resolves to its reply. */
  request<T extends Request["type"]>(request: RequestOf<T> & { type: T }): Promise<string> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ ...request, id } as unknown as Request);
    });
  }

  private send(message: FromKit) {
    // Every message is one of the protocol's: a slip here is a bug, not something to send.
    window.genbeyaKitHost?.post(JSON.stringify(checkFromKit(message)));
  }
}
