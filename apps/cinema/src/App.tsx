import { LoginGate, PaymentsProvider, Settings, useRoute, useSession, Wallet } from "@reelstr/ui";
import { Desk } from "./Desk";
import { Home, SeriesPage } from "./Home";
import { Watch } from "./Watch";

export function App() {
  return (
    <LoginGate title="Reelstr Cinema">
      <PaymentsProvider>
        <Shell />
      </PaymentsProvider>
    </LoginGate>
  );
}

function Shell() {
  const route = useRoute();
  const { pubkey, logout } = useSession();
  const [page, arg] = route;
  if (page === "watch" && arg) return <Watch cutRef={arg} />;
  return (
    <>
      <header className="bar">
        <strong>Reelstr</strong>
        <nav>
          <a href="#/">Watch</a>
          <a href="#/wallet">Wallet</a>
          <a href="#/desk">Curator desk</a>
          <a href="#/settings">Settings</a>
        </nav>
        <span className="grow" />
        <span className="muted" title={pubkey ?? ""}>
          {pubkey?.slice(0, 8)}…
        </span>
        <button type="button" className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>
      <div className="wrap">
        {page === "series" && arg ? <SeriesPage coord={arg} /> : null}
        {page === "desk" ? <Desk /> : null}
        {page === "wallet" ? <Wallet /> : null}
        {page === "settings" ? <Settings /> : null}
        {!page ? <Home /> : null}
      </div>
    </>
  );
}
