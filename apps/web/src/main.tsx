import { SessionProvider } from "@reelstr/ui";
import "@reelstr/ui/src/theme.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

// Android shell (Capacitor): the hardware back button walks the in-app history, and exits only at the start.
// The plugin is reached through the global the native shell injects, so the web build needs no Capacitor import.
type AppPlugin = { addListener(e: string, f: () => void): void; exitApp(): void };
const app = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor
  ?.Plugins?.App;
app?.addListener("backButton", () =>
  window.history.length > 1 ? window.history.back() : app.exitApp(),
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
