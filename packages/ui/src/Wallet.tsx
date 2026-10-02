import { useState } from "react";
import { usePayments } from "./payments";
import { FaucetCard, TESTNET } from "./testnet";

/** FE-9: balance, top-up, spending cap, history. */
export function Wallet() {
  const p = usePayments();
  const [amount, setAmount] = useState(100);
  const [mint, setMint] = useState(p.mintUrl);
  const [nwc, setNwc] = useState(p.nwcUri);
  const [busy, setBusy] = useState(false);
  const topUpNow = async () => {
    setBusy(true);
    try {
      await p.topUp(amount);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="hero">
        <div className="label">Your wallet</div>
        {p.wallet ? (
          <h1 className="figure" data-testid="balance">
            <span>{p.balance}</span> <small>sats</small>
          </h1>
        ) : (
          <h1>Wallet</h1>
        )}
        <p className="muted" style={{ maxWidth: "36rem" }}>
          A Cashu wallet stored on relays (NIP-60), so your balance follows you across devices. You
          can also connect a Lightning wallet through NWC.
          {!p.persistedOnRelays &&
            p.wallet &&
            " Your signer does not support NIP-44, so this wallet is only kept in this tab."}
        </p>
        {p.error && <p className="error">{p.error}</p>}
        {p.wallet && (
          <div className="row" style={{ alignItems: "flex-end", marginTop: "0.5rem" }}>
            <div style={{ flex: "2 1 12rem" }}>
              <label htmlFor="w-amt">Top up (sats)</label>
              <input
                id="w-amt"
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
              <button
                type="button"
                style={{ width: "100%" }}
                disabled={busy || amount < 1}
                onClick={topUpNow}
              >
                {busy ? "Waiting for payment…" : p.nwc ? "Top up with NWC wallet" : "Get invoice"}
              </button>
            </div>
          </div>
        )}
        {p.invoice && (
          <>
            <p>Pay this invoice with any Lightning wallet:</p>
            <code className="nsec" data-testid="invoice">
              {p.invoice}
            </code>
          </>
        )}
      </section>

      <div className="cols">
        <div>
          {p.wallet && <FaucetCard />}
          {p.wallet && FIAT_DEMO && !TESTNET && <FiatDemo topUp={p.topUp} />}
          {p.wallet && (
            <div className="card">
              <h3>Spending</h3>
              <label htmlFor="w-cap">Daily spending cap (sats)</label>
              <input
                id="w-cap"
                type="number"
                min="0"
                value={p.capSats}
                onChange={(e) => p.setCapSats(Number(e.target.value))}
              />
              <p className="muted">
                Spent today: <span className="num">{p.guard.spent()}</span> sats. Unlocks stop when
                the cap would be exceeded.
              </p>
            </div>
          )}
          {p.history.length > 0 && (
            <div className="card">
              <h3>History</h3>
              {p.history.map((h) => (
                <div
                  key={`${h.at}${h.note}${h.sats}${h.direction}`}
                  className="ep"
                  style={{ gap: "0.75rem" }}
                >
                  <span
                    className={`pill ${h.direction === "in" ? "pill-fair" : ""} num`}
                    style={{ minWidth: "5.5rem", justifyContent: "center" }}
                  >
                    {h.direction === "in" ? "+" : "−"}
                    {h.sats} sats
                  </span>
                  <div className="ep-main">
                    <div style={{ fontWeight: 500 }}>{h.note}</div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {new Date(h.at * 1000).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="card">
            <h3>Cashu mint</h3>
            <label htmlFor="w-mint">Cashu mint URL</label>
            <input
              id="w-mint"
              value={mint}
              placeholder="https://mint.example"
              onChange={(e) => setMint(e.target.value)}
            />
            <p>
              <button
                type="button"
                disabled={!mint || mint === p.mintUrl}
                onClick={() => p.setMintUrl(mint.trim())}
              >
                Use this mint
              </button>
            </p>
            <p className="muted">
              A mint holds your funds and could lose them. Only keep small amounts here.
            </p>
          </div>
          <div className="card">
            <h3>Lightning wallet (NWC)</h3>
            <label htmlFor="w-nwc">Connection string</label>
            <input
              id="w-nwc"
              type="password"
              placeholder="nostr+walletconnect://…"
              value={nwc}
              onChange={(e) => setNwc(e.target.value)}
            />
            <p>
              <button type="button" className="ghost" onClick={() => p.setNwcUri(nwc.trim())}>
                {p.nwc ? "Update" : "Connect"}
              </button>{" "}
              {p.nwc && <span className="ok">connected</span>}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

const FIAT_DEMO = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  ?.VITE_FIAT_DEMO;
/** Rate shown by the demo partner: 1 INR = 1 sat. A real on-ramp supplies its own quote and checkout. */
const DEMO_SATS_PER_INR = 1;

/**
 * Stand-in for a fiat on-ramp partner (PRD R3 "explore partner"). It moves no money: it asks the
 * wallet to top up the same way the invoice flow does, so the flow around it can be shown.
 */
function FiatDemo({ topUp }: { topUp: (sats: number) => Promise<unknown> }) {
  const [inr, setInr] = useState(100);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card" data-testid="fiat-demo">
      <h3>Pay by card or UPI</h3>
      <p className="muted">
        Demo partner: nothing is charged. A real on-ramp would take payment here and credit the
        sats.
      </p>
      <label htmlFor="f-inr">Amount (INR)</label>
      <input
        id="f-inr"
        type="number"
        min="1"
        value={inr}
        onChange={(e) => setInr(Number(e.target.value))}
      />
      <p>
        You get {inr * DEMO_SATS_PER_INR} sats.{" "}
        <button
          type="button"
          disabled={busy || inr < 1}
          onClick={async () => {
            setBusy(true);
            try {
              await topUp(inr * DEMO_SATS_PER_INR);
            } catch {
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Processing…" : `Pay ₹${inr} (demo)`}
        </button>
      </p>
    </div>
  );
}
