import type { Weight } from "@reelstr/protocol";
import { go, SplitTable, useAsync, useSession } from "@reelstr/ui";
import { Stars } from "./Feedback";
import { hiddenIds } from "./moderation";
import { loadProgress } from "./progress";

export interface SeriesRow {
  coord: string;
  title: string;
  summary: string;
  free: number;
  curator: string;
  slug: string;
}
export interface CutRow {
  id: string;
  coord: string;
  episode: number;
  title: string;
  duration: number;
  price: number;
  hls_url: string | null;
  curator: string;
  series_slug: string;
}

export function Home() {
  const { client } = useSession();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const series = useAsync(() => api<SeriesRow[]>("/series"), [client]);
  const progress = Object.entries(loadProgress())
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 6);
  return (
    <>
      <h1>Watch</h1>
      {progress.length > 0 && (
        <>
          <h2>Continue watching</h2>
          <div className="grid">
            {progress.map(([id, p]) => (
              <a key={id} className="card" href={`#/watch/${id}`}>
                <strong>{p.title ?? "Episode"}</strong>
                <div className="muted">{Math.floor(p.t)} s in</div>
              </a>
            ))}
          </div>
        </>
      )}
      <h2>Series</h2>
      {series.error && <p className="error">{series.error}</p>}
      <div className="grid">
        {series.data?.map((s) => (
          <a key={s.coord} className="card" href={`#/series/${encodeURIComponent(s.coord)}`}>
            <strong>{s.title}</strong>
            <p className="muted">{s.summary}</p>
            <span className="pill">{s.free} free</span>
          </a>
        ))}
        {series.data?.length === 0 && (
          <p className="muted">No series yet. Curators publish them from the Curator desk.</p>
        )}
      </div>
    </>
  );
}

export function SeriesPage({ coord }: { coord: string }) {
  const { client } = useSession();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const s = useAsync(
    async () => (await api<SeriesRow[]>("/series")).find((x) => x.coord === coord),
    [coord],
  );
  const eps = useAsync(
    () => api<CutRow[]>(`/series/${encodeURIComponent(coord)}/episodes`),
    [coord],
  );
  const hidden = hiddenIds();
  const ratings = useAsync(async () => {
    const ids = (eps.data ?? []).map((e) => e.id);
    return ids.length
      ? await api<{ cut_id: string; count: number; average: number }[]>(
          `/ratings?cuts=${ids.join(",")}`,
        )
      : [];
  }, [eps.data?.length]);
  const rated = new Map((ratings.data ?? []).map((r) => [r.cut_id, r]));
  return (
    <>
      <p>
        <a href="#/">← Series</a>
      </p>
      <h1>{s.data?.title}</h1>
      <p className="muted">{s.data?.summary}</p>
      {eps.error && <p className="error">{eps.error}</p>}
      <div className="card">
        {eps.data
          ?.filter((e) => !hidden.has(e.id))
          .map((e, i) => (
            <div key={e.id} className="row" style={{ alignItems: "center", padding: ".4rem 0" }}>
              <a href={`#/watch/${e.id}`}>
                <strong>Ep {e.episode}</strong> · {e.title}
              </a>
              <span className="muted">{Math.round(Number(e.duration))} s</span>
              {rated.get(e.id) ? (
                <span>
                  <Stars value={rated.get(e.id)?.average ?? 0} />{" "}
                  <span className="muted">({rated.get(e.id)?.count})</span>
                </span>
              ) : (
                <span className="muted">unrated</span>
              )}
              <span className="pill">{i < (s.data?.free ?? 0) ? "free" : `${e.price} sats`}</span>
            </div>
          ))}
      </div>
      {eps.data?.[0] && <Credits cutId={eps.data[0].id} priceSats={eps.data[0].price} />}
    </>
  );
}

/** FE-10: every recipient, seconds used and share. Totals equal 100% of the Cut's weights. */
export function Credits({ cutId, priceSats }: { cutId: string; priceSats: number }) {
  const { client } = useSession();
  const c = useAsync(
    () =>
      (client as NonNullable<typeof client>).api<
        { pubkey: string; role: string; weight: number; seconds: number }[]
      >(`/cuts/${cutId}/credits`),
    [cutId],
  );
  if (!c.data?.length) return null;
  const weights: Weight[] = c.data.map((x) => ({
    pubkey: x.pubkey,
    role: x.role as Weight["role"],
    weight: x.weight,
  }));
  return (
    <>
      <h2>Credits and split</h2>
      <p className="muted">Declared in the curator's signed episode event. Anyone can check it.</p>
      <SplitTable weights={weights} priceSats={priceSats} />
      <p className="muted">
        Seconds used:{" "}
        {c.data
          .filter((x) => x.role === "creator")
          .map((x) => `${x.pubkey.slice(0, 6)}… ${x.seconds.toFixed(1)}s`)
          .join(" · ")}
      </p>
    </>
  );
}
export { go };
