/** Follows VS Code's theme: the app's tokens are dark unless the root says light. */
const sync = () => {
  const light = document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light");
  document.documentElement.dataset["theme"] = light ? "light" : "dark";
};

sync();
new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
