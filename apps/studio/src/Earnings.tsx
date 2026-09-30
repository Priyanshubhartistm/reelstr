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
      <h1>Earnings</h1>
      <p className="muted">Numbers come from signed payout receipts, not from zap receipts.</p>
      {e.error && <p className="error">{e.error}</p>}
      {e.data && (
        <div className="grid">
          <div className="card">
            <div className="muted">Seconds in published episodes</div>
            <h1>{e.data.secondsUsed.toFixed(1)}</h1>
          </div>
          <div className="card">
            <div className="muted">Episodes featured</div>
            <h1>{e.data.episodes}</h1>
          </div>
          <div className="card">
            <div className="muted">Sats paid to you</div>
            <h1>{Math.floor(e.data.receivedMsats / 1000)}</h1>
          </div>
        </div>
      )}
    </>
  );
}
