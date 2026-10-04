import { type ReactNode, useEffect } from "react";
import { Wordmark } from "./brand";
import { useRoute } from "./hooks";
import { usePayments } from "./payments";
import { useSession } from "./session";
import { TestnetBadge } from "./testnet";

export interface NavItem {
  href: string;
  label: string;
  /** first route segment this item owns; "" is the home route */
  route: string;
  /** other first segments that should also light this item up */
  also?: string[];
}

/**
 * One header for every page of an app: wordmark, destinations, wallet balance, who you are.
 * Below 760 px the destinations move to a pill strip pinned to the bottom, where a thumb reaches.
 */
export function AppShell({ items, children }: { items: NavItem[]; children: ReactNode }) {
  const [page] = useRoute();
  const { pubkey, logout } = useSession();
  const pay = usePayments();
  const here = page ?? "";
  // the tab strip and browser history say where you are
  const label = items.find((i) => i.route === here || i.also?.includes(here))?.label;
  useEffect(() => {
    document.title = label ? `${label} · Reelstr` : "Reelstr";
  }, [label]);
  const active = (i: NavItem) => i.route === here || !!i.also?.includes(here);
  const links = items.map((i) => (
    <a key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined}>
      {i.label}
    </a>
  ));
  return (
    <>
      <a className="skip btn" href="#main">
        Skip to content
      </a>
      <header className="bar">
        <a className="brand" href="#/">
          <Wordmark />
        </a>
        <TestnetBadge />
        <nav aria-label="Primary">{links}</nav>
        <span className="grow" />
        {pay.wallet && (
          <a className="chip" href="#/wallet" aria-label={`Balance: ${pay.balance} sats`}>
            <span className="num">{pay.balance}</span>
            <span className="muted">sats</span>
          </a>
        )}
        <span className="chip who num" title={pubkey ?? ""}>
          {pubkey?.slice(0, 8)}…
        </span>
        <button type="button" className="ghost signout" onClick={logout}>
          Sign out
        </button>
      </header>
      <nav className="bottomnav" aria-label="Primary, mobile">
        {links}
      </nav>
      <main id="main" className="wrap">
        {children}
      </main>
    </>
  );
}
