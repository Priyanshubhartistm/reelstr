import { go, LoginGate, useRoute, useSession } from "@reelstr/ui";
import { Composer } from "./Composer";
import { Crew } from "./Crew";
import { Earnings } from "./Earnings";
import { StoriesList, StoryPage } from "./Stories";

export function App() {
  return (
    <LoginGate title="Reelstr Studio">
      <Shell />
    </LoginGate>
  );
}

function Shell() {
  const route = useRoute();
  const { pubkey, logout } = useSession();
  const [page, arg] = route;
  return (
    <>
      <header className="bar">
        <strong>Reelstr Studio</strong>
        <nav>
          <a href="#/">Stories</a>
          <a href="#/crew">Crew</a>
          <a href="#/earnings">Earnings</a>
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
        {page === "story" && arg ? <StoryPage coord={arg} /> : null}
        {page === "compose" && arg ? (
          <Composer coord={arg} parent={route[2]} onDone={() => go("story", arg)} />
        ) : null}
        {page === "earnings" ? <Earnings /> : null}
        {page === "crew" ? <Crew /> : null}
        {!page ? <StoriesList /> : null}
      </div>
    </>
  );
}
