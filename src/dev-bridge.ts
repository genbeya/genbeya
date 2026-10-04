/** Development only: lets the renderer run in a browser against scripts/browser-bridge.ts. */
if (import.meta.env.DEV && !window.gitdesk && new URLSearchParams(location.search).has("bridge")) {
  window.gitdesk = new Proxy({} as Window["gitdesk"], {
    // Event subscriptions (onOpenRequest) have no HTTP equivalent.
    get: (_, method: string) =>
      method.startsWith("on") ? undefined : async (...args: unknown[]) => {
        const response = await fetch("http://127.0.0.1:5174/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, args }),
        });
        const reply = await response.json();
        if (reply.error) throw new Error(reply.error);
        return reply.result;
      },
  });
}

export {};
