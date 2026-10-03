import type { Weight } from "@reelstr/protocol";
import {
  BackLink,
  Explain,
  FilmArt,
  go,
  SplitTable,
  TestnetGuide,
  useAsync,
  useSession,
} from "@reelstr/ui";
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

/** A stable colour per series, so the same show always looks like itself. */
const tone = (coord: string) => {
  let h = 0;
  for (const ch of coord) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `tone-${h % 4}`;
};

export function Home() {
  const { client } = useSession();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const series = useAsync(() => api<SeriesRow[]>("/series"), [client]);
  const progress = Object.entries(loadProgress())
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 6);
  const n = series.data?.length ?? 0;
  // the first episode of the first series with a free one: the button that puts a video on screen
  const lead = series.data?.find((x) => x.free > 0) ?? series.data?.[0];
  const leadEps = useAsync(
    async () =>
      lead ? await api<CutRow[]>(`/series/${encodeURIComponent(lead.coord)}/episodes`) : [],
    [lead?.coord],
  );
  const first = [...(leadEps.data ?? [])].sort((x, y) => x.episode - y.episode)[0];
  return (
    <>
      <section className="hero">
        <FilmArt />
        <div className="label">Reelstr Cinema</div>
        <h1>Stories anyone can fork, one short episode at a time.</h1>
        <p className="muted" style={{ maxWidth: "38rem" }}>
          Every episode lists who made which scene and what share each person earns. The first
          episodes are free; after that you pay in sats, and the split is public.
        </p>
        <div className="row tight" style={{ marginTop: "1.25rem" }}>
          {first && lead ? (
            <a
              className="btn btn-primary"
              href={`#/watch/${encodeURIComponent(first.coord)}`}
              style={{ color: "var(--primary-fg)" }}
              data-testid="watch-now"
            >
              ▶ Watch {lead.title}, episode {first.episode}
            </a>
          ) : (
            <a className="btn btn-primary" href="#series" style={{ color: "var(--primary-fg)" }}>
              Browse series
            </a>
          )}
          <a className="btn btn-plain" href="#series">
            All series
          </a>
          <a className="btn btn-plain" href="#/wallet">
            Get sats
          </a>
        </div>
        {series.data && (
          <div className="stats">
            <div className="hero-inset stat">
              <span className="label">Series</span>
              <span className="num">{n}</span>
            </div>
            <div className="hero-inset stat">
              <span className="label">Free episodes</span>
              <span className="num">{series.data.reduce((a, s) => a + s.free, 0)}</span>
            </div>
          </div>
        )}
      </section>

      {progress.length > 0 && (
        <>
          <div className="label">Continue watching</div>
          <div className="grid" style={{ marginTop: "0.6rem" }}>
            {progress.map(([id, p]) => (
              <a
                key={id}
                className="card card-inset"
                style={{ textDecoration: "none", margin: 0 }}
                href={`#/watch/${encodeURIComponent(id)}`}
              >
                <strong>{p.title ?? "Episode"}</strong>
                <div className="muted num" style={{ fontSize: "0.85rem" }}>
                  {Math.floor(p.t)} s in
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      <div id="series" className="label" style={{ margin: "1.5rem 0 0.6rem" }}>
        Pick a series to watch
      </div>
      {series.error && <p className="error">{series.error}</p>}
      {!series.data && !series.error && (
        <div className="grid" role="status" aria-label="Loading series">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      )}
      <div className="grid">
        {series.data?.map((s) => (
          <a
            key={s.coord}
            className={`cover ${tone(s.coord)}`}
            href={`#/series/${encodeURIComponent(s.coord)}`}
          >
            <div>
              <div className="cover-title">{s.title}</div>
              <p>{s.summary}</p>
            </div>
            <div className="between">
              <span className="pill pill-fair">{s.free} free</span>
              <span className="label" style={{ color: "inherit", opacity: 0.7 }}>
                {s.curator.slice(0, 6)}
              </span>
            </div>
          </a>
        ))}
      </div>
      {series.data?.length === 0 && (
        <div className="card empty">
          <strong>No series yet</strong>
          Curators publish them from the Curator desk.
        </div>
      )}

      <TestnetGuide />
      <Explain
        title="What is Reelstr?"
        steps={[
          "People post short video scenes that continue one shared story. Anyone can add a scene or branch off one.",
          "A curator picks scenes and cuts them into an episode.",
          "Watch the first episodes free. Then pay a few sats to keep going.",
          "Every payment is split between everyone whose scene is in the episode, and the split is public.",
        ]}
      >
        Think of a serial show that anyone can write for, where the writers get paid directly. No
        company sits in the middle. The videos in this demo are placeholders, not real AI output.
      </Explain>
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
      <div className="card">
        <div className="scroll">
          <SplitTable weights={weights} priceSats={priceSats} />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Seconds used:{" "}
          {c.data
            .filter((x) => x.role === "creator")
            .map((x) => `${x.pubkey.slice(0, 6)}… ${x.seconds.toFixed(1)}s`)
            .join(" · ")}
        </p>
      </div>
    </>
  );
}
export { go };
