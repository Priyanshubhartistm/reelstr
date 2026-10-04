import {
  AppShell,
  go,
  loadHls,
  type NavItem,
  PaymentsProvider,
  Settings,
  useRoute,
  Wallet,
} from "@reelstr/ui";
import { useEffect } from "react";
import { Agents } from "./pages/agents/Agents";
import { Crew } from "./pages/crew/Crew";
import { Desk } from "./pages/desk/Desk";
import { Earnings } from "./pages/earnings/Earnings";
import { Composer } from "./pages/stories/Composer";
import { StoriesList } from "./pages/stories/StoriesList";
import { StoryPage } from "./pages/stories/StoryPage";
import { Home } from "./pages/watch/Home";
import { SeriesPage } from "./pages/watch/SeriesPage";
import { Watch } from "./pages/watch/Watch";

const NAV: NavItem[] = [
  { href: "#/", label: "Watch", route: "", also: ["series", "watch", "signin"] },
  { href: "#/stories", label: "Stories", route: "stories", also: ["story", "compose"] },
  { href: "#/desk", label: "Curator desk", route: "desk" },
  { href: "#/agents", label: "Agents", route: "agents" },
  { href: "#/crew", label: "Crew", route: "crew" },
  { href: "#/earnings", label: "Earnings", route: "earnings" },
  { href: "#/wallet", label: "Wallet", route: "wallet" },
  { href: "#/settings", label: "Settings", route: "settings" },
];

/** Everything behind the sign-in: loaded as its own chunk, so the landing page and the gate stay small. */
export default function Signed() {
  // fetch the video library in the background so the first play is not waiting on it
  useEffect(() => {
    const id = setTimeout(() => void loadHls(), 1500);
    return () => clearTimeout(id);
  }, []);
  return (
    <PaymentsProvider>
      <Shell />
    </PaymentsProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [page, arg] = route;
  // arriving from the sign-in page: land on the home screen
  useEffect(() => {
    // check the live address, not the route this effect closed over: if you already moved on, stay there
    if (page === "signin" && window.location.hash.replace(/^#\/?/, "") === "signin") go("");
  }, [page]);
  return (
    <AppShell items={NAV}>
      {page === "watch" && arg ? <Watch cutRef={arg} /> : null}
      {page === "series" && arg ? <SeriesPage coord={arg} /> : null}
      {page === "desk" ? <Desk /> : null}
      {page === "stories" ? <StoriesList /> : null}
      {page === "story" && arg ? <StoryPage coord={arg} /> : null}
      {page === "compose" && arg ? (
        <Composer coord={arg} parent={route[2]} onDone={() => go("story", arg)} />
      ) : null}
      {page === "agents" ? <Agents coord={arg} /> : null}
      {page === "crew" ? <Crew /> : null}
      {page === "earnings" ? <Earnings /> : null}
      {page === "wallet" ? <Wallet /> : null}
      {page === "settings" ? <Settings /> : null}
      {!page || page === "about" || page === "signin" ? <Home /> : null}
    </AppShell>
  );
}
