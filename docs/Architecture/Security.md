# Security

The renderer displays content from repositories you may not fully trust, so it gets as little power as possible.

- **Sandboxed renderer**: context isolation, no Node integration, sandbox on. The preload script exposes a fixed list of methods and nothing else.
- **Validated IPC**: the main process accepts calls only from the app's own page and checks every argument again in the engine. Each call names the workspace it was made for, so a request racing a repository switch fails instead of touching the new repository.
- **Own origin**: production assets load from `gitdesk://app`, which can only serve files from the bundled renderer.
- **No navigation**: navigation, pop-ups and permission requests are blocked. Web links open in the system browser, only for `http`, `https` and `mailto`.
- **Markdown**: raw HTML is not rendered; Mermaid runs with `securityLevel: strict`; PlantUML and repository SVGs render as images.
- **Remote content**: remote images never load implicitly. Diagram source goes to a PlantUML server only if you configured one.
- **Git**: commands run without a shell, with hooks disabled, terminal prompts off and literal pathspecs.
