import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter, withComponentInputBinding, withHashLocation } from "@angular/router";
import { provideRockuml } from "@rockuml/angular";
import { routes } from "./app.routes";
import { MANAGERS, SHELL, type Platform } from "./platform/platform";

export function appConfig(platform: Platform): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      // Hash URLs work under every shell's origin (gitdesk://, tauri://, http://127.0.0.1).
      provideRouter(routes, withHashLocation(), withComponentInputBinding()),
      provideRockuml({ wasm: "rockuml.wasm" }),
      { provide: MANAGERS, useValue: platform.managers },
      { provide: SHELL, useValue: platform.shell },
    ],
  };
}
