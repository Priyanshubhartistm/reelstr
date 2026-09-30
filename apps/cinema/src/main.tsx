import { SessionProvider } from "@reelstr/ui";
import "@reelstr/ui/src/theme.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
