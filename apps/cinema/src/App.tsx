import {
  AppShell,
  LoginGate,
  type NavItem,
  PaymentsProvider,
  Settings,
  useRoute,
  Wallet,
} from "@reelstr/ui";
import { Desk } from "./Desk";
import { Home, SeriesPage } from "./Home";
import { Watch } from "./Watch";

const NAV: NavItem[] = [
  { href: "#/", label: "Watch", route: "", also: ["series", "watch"] },
  { href: "#/wallet", label: "Wallet", route: "wallet" },
  { href: "#/desk", label: "Curator desk", route: "desk" },
  { href: "#/settings", label: "Settings", route: "settings" },
];

export function App() {
  return (
    <LoginGate title="Cinema">
      <PaymentsProvider>
        <Shell />
      </PaymentsProvider>
    </LoginGate>
  );
}

function Shell() {
  const [page, arg] = useRoute();
  return (
    <AppShell items={NAV}>
      {page === "watch" && arg ? <Watch cutRef={arg} /> : null}
      {page === "series" && arg ? <SeriesPage coord={arg} /> : null}
      {page === "desk" ? <Desk /> : null}
      {page === "wallet" ? <Wallet /> : null}
      {page === "settings" ? <Settings /> : null}
      {!page ? <Home /> : null}
    </AppShell>
  );
}
