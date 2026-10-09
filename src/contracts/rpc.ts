/**
 * The wire binding of the manager contracts, shared by every transport:
 * clients turn calls into `Request`s with {@link connectManagers}, backends
 * answer them with {@link dispatch}. Failures cross as plain messages, so
 * every shell reports errors the same way.
 */
import { MANAGER_METHODS, type ManagerName, type Managers } from "./manager-contracts";

export interface Request {
  readonly manager: ManagerName;
  readonly method: string;
  readonly args: readonly unknown[];
}

export type Reply = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

export type Transport = (request: Request) => Promise<Reply>;

const isManager = (name: unknown): name is ManagerName => typeof name === "string" && Object.hasOwn(MANAGER_METHODS, name);

/** Runs a request against the managers; never throws. */
export async function dispatch(managers: Managers, request: unknown): Promise<Reply> {
  try {
    const { manager, method, args } = (request ?? {}) as Partial<Request>;
    if (!isManager(manager) || !(MANAGER_METHODS[manager] as readonly unknown[]).includes(method) || !Array.isArray(args))
      throw new Error("Unknown request.");
    const target = managers[manager] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const operation = target[method as string];
    if (!operation) throw new Error("Unknown request.");
    return { ok: true, value: (await operation.apply(target, args)) ?? null };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Typed managers whose calls travel through `transport`. */
export function connectManagers(transport: Transport): Managers {
  const connect = <K extends ManagerName>(manager: K) =>
    Object.fromEntries(
      MANAGER_METHODS[manager].map((method) => [
        method,
        async (...args: unknown[]) => {
          const reply = await transport({ manager, method, args });
          if (!reply.ok) throw new Error(reply.message);
          return reply.value;
        },
      ]),
    ) as unknown as Managers[K];
  return { workspace: connect("workspace"), content: connect("content"), versionControl: connect("versionControl") };
}
