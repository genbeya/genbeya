import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app/app";
import { appConfig } from "./app/app.config";
import { connectPlatform } from "./app/platform/connect";

connectPlatform()
  .then((platform) => bootstrapApplication(App, appConfig(platform)))
  .catch((error: unknown) => {
    document.body.textContent = error instanceof Error ? error.message : String(error);
    document.body.className = "startup-error";
  });
