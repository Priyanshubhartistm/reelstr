import { Explain, FilmArt, TestnetGuide, useAsync, useSession } from "@reelstr/ui";
import { loadProgress } from "../../lib/progress";
import { tone } from "../../lib/tone";
import type { CutRow, SeriesRow } from "./types";

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
