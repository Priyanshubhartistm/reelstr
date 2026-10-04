import { BackLink, useAsync, useSession } from "@reelstr/ui";
import { hiddenIds } from "../../lib/moderation";
import { Credits } from "./Credits";
import { Stars } from "./Feedback";
import type { CutRow, SeriesRow } from "./types";

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
    const ids = (eps.data ?? []).map((e) => e.coord);
    return ids.length
      ? await api<{ cut_coord: string; count: number; average: number }[]>(
          `/ratings?cuts=${ids.map(encodeURIComponent).join(",")}`,
        )
      : [];
  }, [eps.data?.length]);
  const rated = new Map((ratings.data ?? []).map((r) => [r.cut_coord, r]));
  const shown = eps.data?.filter((e) => !hidden.has(e.id)) ?? [];
  const mins = Math.round(shown.reduce((a, e) => a + Number(e.duration), 0));
  return (
    <>
      <section className="hero">
        <BackLink href="#/">All series</BackLink>
        <h1>{s.data?.title}</h1>
        <p className="muted" style={{ maxWidth: "38rem" }}>
          {s.data?.summary}
        </p>
        <div className="stats">
          <div className="hero-inset stat">
            <span className="label">Episodes</span>
            <span className="num">{shown.length}</span>
          </div>
          <div className="hero-inset stat">
            <span className="label">Free</span>
            <span className="num">{s.data?.free ?? 0}</span>
          </div>
          <div className="hero-inset stat">
            <span className="label">Runtime</span>
            <span className="num">{mins} s</span>
          </div>
        </div>
      </section>
      {eps.error && <p className="error">{eps.error}</p>}
      <div className="card" aria-busy={!eps.data}>
        {!eps.data && !eps.error && (
          <>
            <div className="skeleton line" style={{ height: "2.6rem" }} />
            <div className="skeleton line" style={{ height: "2.6rem" }} />
          </>
        )}
        {shown.map((e, i) => (
          <div key={e.id} className="ep">
            <span className="ep-no" aria-hidden="true">
              {e.episode}
            </span>
            <div className="ep-main">
              <a className="ep-title" href={`#/watch/${encodeURIComponent(e.coord)}`}>
                <strong>Ep {e.episode}</strong> · {e.title}
              </a>
              <span className="muted num" style={{ fontSize: "0.8rem" }}>
                {Math.round(Number(e.duration))} s
              </span>
            </div>
            {rated.get(e.coord) ? (
              <span style={{ whiteSpace: "nowrap" }}>
                <Stars value={rated.get(e.coord)?.average ?? 0} />{" "}
                <span className="muted">({rated.get(e.coord)?.count})</span>
              </span>
            ) : (
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                unrated
              </span>
            )}
            <span className={`pill ${i < (s.data?.free ?? 0) ? "pill-fair" : ""}`}>
              {i < (s.data?.free ?? 0) ? "free" : `${e.price} sats`}
            </span>
          </div>
        ))}
        {eps.data && shown.length === 0 && (
          <div className="empty">
            <strong>No episodes yet</strong>
            The curator has not published one.
          </div>
        )}
      </div>
      {eps.data?.[0] && <Credits cutId={eps.data[0].id} priceSats={eps.data[0].price} />}
    </>
  );
}
