/** Renderer entry for Deno Desktop: window.gitdesk over the `gitdesk` binding. */
import type {} from "../../src/api";
import { rendererApi } from "../renderer-api";

declare const bindings: { gitdesk(request: { method: string; args: unknown[] }): Promise<unknown> };

window.gitdesk = rendererApi((method, args) => bindings.gitdesk({ method, args }));
