import { go, HlsPlayer, useAsync, usePayments, useSession } from "@reelstr/ui";
import {
  keyHeaders,
  type Unlock,
  unlockWithLightning,
  unlockWithNutzap,
  zapSplit,
} from "@reelstr/wallet";
import { useRef, useState } from "react";
import { Ratings, ReportButton } from "./Feedback";
import { Credits, type CutRow, type SeriesRow } from "./Home";
import { hiddenIds, isRevealed, reveal } from "./moderation";
import { loadProgress, saveProgress } from "./progress";

const tokenKey = (keyUrl: string) => `reelstr.unlock.${keyUrl}`;
const savedToken = (keyUrl: string): Unlock | null => {
  try {
    const t = localStorage.getItem(tokenKey(keyUrl));
    return t ? ({ kind: "token", token: t, paidSats: 0 } as Unlock) : null;
  } catch {
    return null;
  }
};

/** FE-7 / FE-8: full-screen vertical player, paywall sheet, auto-next, resume. */
export function Watch({ cutId }: { cutId: string }) {
  const { client, endpoints } = useSession();
  const pay = usePayments();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const cut = useAsync(async () => {
    const all = await api<CutRow[]>("/cuts");
    const c = all.find((x) => x.id === cutId);
    if (!c) throw new Error("episode not found");
    const series = (await api<SeriesRow[]>("/series")).find(
      (s) => s.curator === c.curator && s.slug === c.series_slug,
    );
    const siblings = all
      .filter((x) => x.curator === c.curator && x.series_slug === c.series_slug)
      .sort((a, b) => a.episode - b.episode);
    return {
      c,
      series,
      next: siblings.find((x) => x.episode > c.episode),
      index: siblings.findIndex((x) => x.id === c.id),
    };
  }, [cutId]);
  const last = useRef(0);
  const [unlock, setUnlock] = useState<Unlock | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState(100);
  const [tipMsg, setTipMsg] = useState("");
  const [hidden, setHidden] = useState(() => hiddenIds().has(cutId));
  const [, bump] = useState(0);

  const c = cut.data?.c;
  const warning = (c as (CutRow & { content_warning?: string | null }) | undefined)
    ?.content_warning;
  const blurred = !!warning && !isRevealed(cutId);
  const paid =
    !!c && Number(c.price) > 0 && (cut.data?.index ?? 0) >= (cut.data?.series?.free ?? 0);
  const d = c?.coord.split(":").slice(2).join(":");
  const keyUrl = c && d ? `${endpoints.keysUrl}/key/${c.curator}/${encodeURIComponent(d)}` : "";
  const have = unlock ?? (keyUrl ? savedToken(keyUrl) : null);
  const locked = paid && !have;
  const start = loadProgress()[cutId]?.t ?? 0;

  async function unlockNow(how: "nutzap" | "lightning") {
    if (!c) return;
    setBusy(true);
    setErr("");
    try {
      const price = Number(c.price);
      const u =
        how === "nutzap"
          ? await unlockWithNutzap({
              keyUrl,
              wallet: pay.wallet as NonNullable<typeof pay.wallet>,
              guard: pay.guard,
              maxSats: price,
            })
          : await unlockWithLightning({
              keyUrl,
              invoiceUrl: keyUrl.replace("/key/", "/invoice/"),
              pay: (inv, sats) => (pay.nwc as NonNullable<typeof pay.nwc>).payInvoice(inv, sats),
              guard: pay.guard,
              maxSats: price,
            });
      if (u.kind === "token") {
        try {
          localStorage.setItem(tokenKey(keyUrl), u.token);
        } catch {}
        if (how === "nutzap")
          await pay.record("out", u.paidSats, `unlock ${c.series_slug} ep ${c.episode}`);
        await pay.refresh();
      }
      setUnlock(u);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTip() {
    if (!c || !pay.nwc || !client) return;
    setTipMsg("");
    try {
      const cutEv = await client.pool.get(client.cfg.relays, { ids: [c.id] });
      if (!cutEv) throw new Error("could not load the episode event");
      pay.guard.check(tip);
      const r = await zapSplit({
        cut: cutEv as never,
        sats: tip,
        signer: client.cfg.signer,
        nwc: pay.nwc,
        pool: client.pool,
        relays: client.cfg.relays,
      });
      pay.guard.record(r.paid.reduce((a, p) => a + p.sats, 0));
      setTipMsg(
        `Sent ${r.paid.reduce((a, p) => a + p.sats, 0)} sats to ${r.paid.length} people${r.failed.length ? `; ${r.failed.length} could not be reached` : ""}.`,
      );
    } catch (e) {
      setTipMsg((e as Error).message);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "8px 12px" }}>
      <p>
        <a href={cut.data?.series ? `#/series/${encodeURIComponent(cut.data.series.coord)}` : "#/"}>
          ← {cut.data?.series?.title ?? "Back"}
        </a>
      </p>
      {cut.error && <p className="error">{cut.error}</p>}
      {hidden && (
        <div className="card" data-testid="hidden-notice">
          <p>You reported this episode, so it is hidden for you.</p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              import("./moderation").then((m) => m.unhide(cutId));
              setHidden(false);
            }}
          >
            Show it again
          </button>
        </div>
      )}
      {!hidden && blurred && (
        <div className="card" data-testid="warning">
          <h2 style={{ marginTop: 0 }}>Content warning</h2>
          <p>{warning}</p>
          <button
            type="button"
            onClick={() => {
              reveal(cutId);
              bump((n) => n + 1);
            }}
          >
            Show anyway
          </button>
        </div>
      )}
      {c && !hidden && !blurred && !c.hls_url && (
        <p className="muted">This episode has no rendered video yet.</p>
      )}
      {c?.hls_url && !locked && !hidden && !blurred && (
        <HlsPlayer
          key={`${c.id}-${have?.kind}`}
          src={c.hls_url}
          keyHeaders={have ? keyHeaders(have) : undefined}
          captions={(
            JSON.parse((c as CutRow & { captions?: string }).captions ?? "[]") as {
              url: string;
              lang: string;
            }[]
          ).map((x) => ({ src: x.url, lang: x.lang, label: x.lang }))}
          startAt={start > 0 && start < Number(c.duration) - 2 ? start : 0}
          onProgress={(t) => {
            if (t - last.current > 2) {
              last.current = t;
              saveProgress(c.id, t, {
                series: c.series_slug,
                title: `${c.series_slug} · Ep ${c.episode}`,
              });
            }
          }}
          onEnded={() => {
            saveProgress(c.id, 0);
            if (cut.data?.next) go("watch", cut.data.next.id);
          }}
        />
      )}
      {c && locked && !hidden && !blurred && (
        <div className="card" role="dialog" aria-label="Unlock episode" data-testid="paywall">
          <h2 style={{ marginTop: 0 }}>Keep watching</h2>
          <p>
            Ep {c.episode} is {c.price} sats. The first {cut.data?.series?.free ?? 0} episodes are
            free.
          </p>
          <p className="muted">
            Creators whose scenes are in this episode are paid from it; the split is public below.
          </p>
          {pay.wallet ? (
            <p>
              Balance: <strong>{pay.balance} sats</strong> · spent today {pay.guard.spent()}/
              {pay.capSats}
            </p>
          ) : (
            <p className="muted">
              Connect a wallet to unlock. <a href="#/wallet">Open wallet</a>
            </p>
          )}
          <p>
            <button
              type="button"
              disabled={busy || !pay.wallet || pay.balance < Number(c.price)}
              onClick={() => unlockNow("nutzap")}
            >
              {busy ? "Unlocking…" : `Unlock for ${c.price} sats`}
            </button>{" "}
            {pay.nwc && (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => unlockNow("lightning")}
              >
                Pay with Lightning wallet
              </button>
            )}
          </p>
          {pay.wallet && pay.balance < Number(c.price) && (
            <p className="muted">
              Balance is too low. <a href="#/wallet">Top up</a>
            </p>
          )}
          {err && <p className="error">{err}</p>}
        </div>
      )}
      {c && (
        <h2>
          Ep {c.episode} · {c.title}
        </h2>
      )}
      {cut.data?.next && (
        <p className="muted">Next: Ep {cut.data.next.episode} plays automatically.</p>
      )}
      {c && pay.nwc && (
        <div className="card" style={{ margin: "12px 0" }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div>
              <label htmlFor="tip">Tip the creators (sats)</label>
              <input
                id="tip"
                type="number"
                min="1"
                value={tip}
                onChange={(e) => setTip(Number(e.target.value))}
              />
            </div>
            <button type="button" className="ghost" onClick={sendTip}>
              Zap the split
            </button>
          </div>
          {tipMsg && <p className="muted">{tipMsg}</p>}
        </div>
      )}
      {c && !hidden && (
        <div>
          <ReportButton eventId={c.id} author={c.curator} onHidden={() => setHidden(true)} />
        </div>
      )}
      {c && !hidden && <Credits cutId={c.id} priceSats={c.price} />}
      {c && !hidden && <Ratings cutId={c.id} cutCoord={c.coord} />}
    </div>
  );
}
