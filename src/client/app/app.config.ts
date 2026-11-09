import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter, withComponentInputBinding, withHashLocation } from "@angular/router";
import { provideRockuml } from "@rockuml/angular";
import { routes } from "./app.routes";
import { DEMO, MANAGERS, SHELL, type Platform } from "./platform/platform";
import { LAYOUT_STORAGE } from "./ui/remembered";

export function appConfig(platform: Platform): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      // Hash URLs work under every shell's origin (genbeya://, tauri://, http://127.0.0.1).
      provideRouter(routes, withHashLocation(), withComponentInputBinding()),
      // Next to the scripts, wherever the page is: genbeya.fyi serves Genbeya on GitHub at addresses of any depth.
      provideRockuml({ wasm: new URL("rockuml.wasm", import.meta.url) }),
      { provide: MANAGERS, useValue: platform.managers },
      { provide: SHELL, useValue: platform.shell },
      ...(platform.storage ? [{ provide: LAYOUT_STORAGE, useValue: platform.storage }] : []),
      ...(platform.demo ? [{ provide: DEMO, useValue: platform.demo }] : []),
    ],
  };
}
