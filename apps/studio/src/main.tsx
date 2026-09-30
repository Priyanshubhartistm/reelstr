import { SessionProvider } from "@reelstr/ui";
import "@reelstr/ui/src/theme.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
);
