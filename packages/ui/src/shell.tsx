import { type ReactNode, useEffect, useState } from "react";
import { useRoute } from "./hooks";
import { usePayments } from "./payments";
import { useSession } from "./session";

export interface NavItem {
  href: string;
  label: string;
  /** first route segment this item owns; "" is the home route */
  route: string;
  /** other first segments that should also light this item up */
  also?: string[];
}

/** The one way back: a pill that always names where it goes. Same look on every page, light or dark. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="back" href={href}>
      <span aria-hidden="true">←</span>
      {children}
    </a>
  );
}

/** The mark: a pine tile with a play triangle, same two colours as the rest of the system. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" role="img" aria-label="Reelstr">
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="9"
        fill="var(--hero)"
        stroke="var(--ink)"
        strokeWidth="2.5"
      />
      <path
        d="M12.5 9.5 23 16l-10.5 6.5z"
        fill="var(--primary)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Flat decoration for hero panels: three vertical frames, the same ink strokes as everything else. */
export function FilmArt() {
  return (
    <svg className="film-art" viewBox="0 0 220 200" aria-hidden="true">
      <g stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round">
        <rect
          x="10"
          y="40"
          width="82"
          height="146"
          rx="14"
          fill="var(--accent)"
          transform="rotate(-9 51 113)"
        />
        <rect
          x="128"
          y="34"
          width="82"
          height="146"
          rx="14"
          fill="var(--secondary)"
          transform="rotate(8 169 107)"
        />
        <rect x="66" y="10" width="88" height="160" rx="15" fill="var(--primary)" />
        <path d="M96 62 128 90 96 118z" fill="var(--card)" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <>
      <BrandMark />
      <span>
        reel<b>str</b>
      </span>
    </>
  );
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

/**
 * A tab that stays open keeps running the code it loaded. When a newer version has been deployed,
 * say so and offer the reload, instead of leaving people on a stale screen that no longer matches.
 * Checked when the tab becomes visible again and every five minutes: the page's fingerprinted script
 * name is compared with the one the server serves now.
 */
export function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = Array.from(document.scripts)
      .map((s) => s.src)
      .find((src) => /\/assets\/index-[\w-]+\.js/.test(src));
    if (!mine) return; // dev server: nothing is fingerprinted
    const check = async () => {
      try {
        const html = await (
          await fetch(`${location.pathname}?v=${Date.now()}`, { cache: "no-store" })
        ).text();
        const now = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
        if (now && !mine.endsWith(now)) setStale(true);
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="update" role="status">
      A new version of Reelstr is available.
      <button type="button" className="sm" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
