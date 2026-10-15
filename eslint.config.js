// @ts-check
import eslint from "@eslint/js";
import angular from "angular-eslint";
import tseslint from "typescript-eslint";

/**
 * Layer rules (iDesign): clients call managers only through the contracts;
 * managers use engines and resource access; engines and resource access never
 * call upwards or sideways into each other. Everything below the shells is
 * runtime-neutral, so it can run on Node, Deno and in the Tauri webview.
 */
const layer = (forbidden, message) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        ...forbidden.map((name) => ({ group: [`**/${name}/**`, `**/${name}`], message })),
        { group: ["node:*"], message: "Runtime APIs belong in src/platforms; this layer must run anywhere." },
      ],
    },
  ],
});

export default tseslint.config(
  { ignores: ["dist/", "out-tsc/", ".angular/", ".claude/", "release*/", ".vscode-test/", "src/shells/tauri/src-tauri/", "node_modules/"] },
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.strict, ...tseslint.configs.stylistic],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-extraneous-class": "off",
      // noUncheckedIndexedAccess is on; `!` marks an invariant the code relies on.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/client/**/*.ts"],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // Components are elements (gd-tree), or attributes on native elements (button[gd-menu-item]).
      "@angular-eslint/component-selector": ["error", { type: ["element", "attribute"], prefix: "gd", style: "kebab-case" }],
      "@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: "gd", style: "camelCase" }],
      "@angular-eslint/prefer-on-push-component-change-detection": "error",
      "@angular-eslint/prefer-signals": "error",
      ...layer(["managers", "engines", "access", "platforms", "shells"], "The client talks to managers only through src/contracts."),
    },
  },
  {
    // Features and their building blocks reach the platform through core services.
    files: ["src/client/app/{features,ui,markdown,editor}/**/*.ts"],
    rules: layer(
      ["managers", "engines", "access", "platforms", "shells", "platform"],
      "Features use core services; only core talks to the platform connectors.",
    ),
  },
  {
    // The Tauri and web demo connectors are the places the client composes an in-page backend, as is the demo's experiment with real repositories.
    files: [
      "src/client/app/platform/tauri-connector.ts",
      "src/client/app/platform/demo-connector.ts",
      "src/client/app/platform/real-repositories/*.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/client/**/*.html"],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    files: ["src/contracts/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: layer(["client", "managers", "engines", "access", "utilities", "platforms", "shells"], "Contracts depend on nothing."),
  },
  {
    files: ["src/utilities/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: layer(["client", "managers", "engines", "access", "platforms", "shells"], "Utilities depend only on contracts."),
  },
  {
    files: ["src/engines/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: layer(["client", "managers", "access", "platforms", "shells"], "Engines are pure: no resource access, no managers."),
  },
  {
    files: ["src/access/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: layer(["client", "managers", "engines", "platforms", "shells"], "Resource access never calls upwards."),
  },
  {
    files: ["src/managers/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: layer(["client", "platforms", "shells"], "Managers get runtime adapters injected by the shells."),
  },
);
