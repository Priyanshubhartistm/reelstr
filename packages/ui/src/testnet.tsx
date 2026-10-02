import { useEffect, useState } from "react";
import { usePayments } from "./payments";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
/** Built with VITE_TESTNET=1: every sat here is a free test sat from a development mint, worth nothing. */
export const TESTNET = !!env.VITE_TESTNET;
export const FAUCET_SATS = 500;
const COOLDOWN_SEC = 60;
const KEY = "reelstr.faucet.at";

const lastClaim = () => {
  try {
    return Number(localStorage.getItem(KEY) ?? 0);
  } catch {
    return 0;
  }
};

/**
 * The faucet: a click mints test sats at the development mint (its Lightning side is a fake that settles
 * at once). The wait between claims is a courtesy for people sharing a screen, not a security control:
 * test sats are free by design.
 */
export function useFaucet() {
  const p = usePayments();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(() =>
    Math.max(0, COOLDOWN_SEC - (Date.now() / 1000 - lastClaim())),
  );
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(
      () => setLeft(Math.max(0, COOLDOWN_SEC - (Date.now() / 1000 - lastClaim()))),
      500,
    );
    return () => clearInterval(id);
  }, [left]);
  const claim = async () => {
    if (busy || left > 0 || !p.wallet) return;
    setBusy(true);
    setError("");
    try {
      await p.topUp(FAUCET_SATS);
      try {
        localStorage.setItem(KEY, String(Math.floor(Date.now() / 1000)));
      } catch {}
      setLeft(COOLDOWN_SEC);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { claim, busy, error, waitSec: Math.ceil(left), ready: !!p.wallet && left <= 0 && !busy };
}

/** A small pill in the header so nobody mistakes this for real money. */
export function TestnetBadge() {
  if (!TESTNET) return null;
  return (
    <a
      className="pill pill-accent testnet-badge"
      href="#/wallet"
      title="Test sats only. Nothing here has real value."
    >
      Testnet
    </a>
  );
}

/** The wallet's faucet card. */
export function FaucetCard() {
  const f = useFaucet();
  const p = usePayments();
  if (!TESTNET) return null;
  return (
    <div className="card card-soft" data-testid="faucet">
      <div className="label">Testnet faucet</div>
      <h3>Get {FAUCET_SATS} free test sats</h3>
      <p className="muted">
        Test sats come from a development mint and have no value. Take some, unlock an episode, and
        tip a creator to see the whole flow.
      </p>
      <button type="button" disabled={!f.ready} onClick={f.claim}>
        {f.busy
          ? "Minting…"
          : f.waitSec > 0
            ? `Again in ${f.waitSec} s`
            : `Get ${FAUCET_SATS} test sats`}
      </button>
      {f.error && <p className="error">{f.error}</p>}
      {p.balance > 0 && (
        <div className="next" data-testid="faucet-next">
          <div className="label">You have sats. What now?</div>
          <ol className="guide">
            <li>
              <a href="#series">Open a series</a> and watch the free episodes.
            </li>
            <li>When a paid episode asks for sats, press Unlock. Your balance drops.</li>
            <li>
              Check <a href="#/earnings">Earnings</a> to see who was paid.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

/** The same faucet, as one button where it is needed (the paywall). */
export function FaucetButton({ children }: { children?: string }) {
  const f = useFaucet();
  if (!TESTNET) return null;
  return (
    <>
      <button type="button" disabled={!f.ready} onClick={f.claim}>
        {f.busy
          ? "Minting…"
          : f.waitSec > 0
            ? `Again in ${f.waitSec} s`
            : (children ?? `Get ${FAUCET_SATS} test sats`)}
      </button>
      {f.error && <p className="error">{f.error}</p>}
    </>
  );
}

const GUIDE = "reelstr.guide.closed";
/** Four steps for someone seeing the demo for the first time. Dismissible, and remembered. */
export function TestnetGuide() {
  const p = usePayments();
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(GUIDE) === "1";
    } catch {
      return false;
    }
  });
  if (!TESTNET || closed) return null;
  const steps: [string, string, string, boolean][] = [
    ["1", "Get test sats", "#/wallet", p.balance > 0],
    ["2", "Watch a free episode", "#series", false],
    ["3", "Unlock a paid one and see who gets paid", "#series", false],
    ["4", "Fork a scene and publish your own", "#/stories", false],
  ];
  return (
    <div className="card card-soft" data-testid="guide">
      <div className="between">
        <div>
          <div className="label">Testnet demo</div>
          <h3 style={{ margin: "0.1rem 0 0" }}>Try it in four steps</h3>
        </div>
        <button
          type="button"
          className="ghost sm"
          onClick={() => {
            try {
              localStorage.setItem(GUIDE, "1");
            } catch {}
            setClosed(true);
          }}
        >
          Hide
        </button>
      </div>
      <ol className="guide">
        {steps.map(([n, t, href, done]) => (
          <li key={n} className={done ? "done" : ""}>
            <a href={href}>{t}</a>
            {done && <span className="pill pill-fair">done</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
