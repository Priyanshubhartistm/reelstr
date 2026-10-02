import { useAsync, useSession } from "@reelstr/ui";

/** US-C5: how many seconds of my scenes are in published episodes, and what was actually paid. */
export function Earnings() {
  const { client, pubkey } = useSession();
  const e = useAsync(
    () =>
      (client as NonNullable<typeof client>).api<{
        secondsUsed: number;
        episodes: number;
        receivedMsats: number;
      }>(`/earnings/${pubkey}`),
    [pubkey],
  );
  return (
    <>
      <section className="hero">
        <div className="label">Earnings</div>
        <h1 className="figure" style={{ marginTop: "0.5rem" }}>
          <span>{e.data ? Math.floor(e.data.receivedMsats / 1000) : 0}</span>{" "}
          <small>sats paid to you</small>
        </h1>
        <p className="muted" style={{ maxWidth: "36rem", marginTop: "0.9rem" }}>
          Numbers come from signed payout receipts, not from zap receipts.
        </p>
        {e.data && (
          <div className="stats">
            <div className="hero-inset stat">
              <span className="label">Seconds in episodes</span>
              <span className="num">{e.data.secondsUsed.toFixed(1)}</span>
            </div>
            <div className="hero-inset stat">
              <span className="label">Episodes featured</span>
              <span className="num">{e.data.episodes}</span>
            </div>
          </div>
        )}
      </section>
      {e.error && <p className="error">{e.error}</p>}
      {e.data && e.data.episodes === 0 && (
        <div className="card empty">
          <strong>Nothing yet</strong>
          Scenes you make earn when a curator puts them in an episode and viewers unlock it.
        </div>
      )}
    </>
  );
}
