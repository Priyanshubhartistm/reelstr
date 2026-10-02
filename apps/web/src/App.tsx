import {
  AppShell,
  go,
  LoginGate,
  type NavItem,
  PaymentsProvider,
  Settings,
  UpdateNotice,
  useRoute,
  useSession,
  Wallet,
} from "@reelstr/ui";
import { useEffect } from "react";
import { Agents } from "./create/Agents";
import { Composer } from "./create/Composer";
import { Crew } from "./create/Crew";
import { Earnings } from "./create/Earnings";
import { StoriesList, StoryPage } from "./create/Stories";
import { Landing } from "./Landing";
import { Desk } from "./watch/Desk";
import { Home, SeriesPage } from "./watch/Home";
import { Watch } from "./watch/Watch";

/** Watch is for viewers; the rest is for people who make things. One sign-in, one wallet, one app. */
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

export function App() {
  const { client } = useSession();
  const [page] = useRoute();
  // the public page is for people who are not signed in yet; everything else asks for a key
  return (
    <>
      <UpdateNotice />
      {!client && (!page || page === "about") ? (
        <Landing />
      ) : (
        <LoginGate title="Sign in">
          <PaymentsProvider>
            <Shell />
          </PaymentsProvider>
        </LoginGate>
      )}
    </>
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
