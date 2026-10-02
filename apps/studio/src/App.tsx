import {
  AppShell,
  go,
  LoginGate,
  type NavItem,
  PaymentsProvider,
  Settings,
  useRoute,
  Wallet,
} from "@reelstr/ui";
import { Agents } from "./Agents";
import { Composer } from "./Composer";
import { Crew } from "./Crew";
import { Earnings } from "./Earnings";
import { StoriesList, StoryPage } from "./Stories";

export function App() {
  return (
    <LoginGate title="Studio">
      <PaymentsProvider>
        <Shell />
      </PaymentsProvider>
    </LoginGate>
  );
}

const NAV: NavItem[] = [
  { href: "#/", label: "Stories", route: "", also: ["story", "compose"] },
  { href: "#/agents", label: "Agents", route: "agents" },
  { href: "#/crew", label: "Crew", route: "crew" },
  { href: "#/wallet", label: "Wallet", route: "wallet" },
  { href: "#/earnings", label: "Earnings", route: "earnings" },
  { href: "#/settings", label: "Settings", route: "settings" },
];

function Shell() {
  const route = useRoute();
  const [page, arg] = route;
  return (
    <AppShell items={NAV}>
      {page === "story" && arg ? <StoryPage coord={arg} /> : null}
      {page === "compose" && arg ? (
        <Composer coord={arg} parent={route[2]} onDone={() => go("story", arg)} />
      ) : null}
      {page === "earnings" ? <Earnings /> : null}
      {page === "crew" ? <Crew /> : null}
      {page === "wallet" ? <Wallet /> : null}
      {page === "settings" ? <Settings /> : null}
      {page === "agents" ? <Agents coord={arg} /> : null}
      {!page ? <StoriesList /> : null}
    </AppShell>
  );
}
