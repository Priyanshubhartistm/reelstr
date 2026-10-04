import { FilmArt, useAsync, useSession } from "@reelstr/ui";
import { useState } from "react";
import { tone } from "../../lib/tone";
import type { Story } from "./types";

export function StoriesList() {
  const { client } = useSession();
  const stories = useAsync(
    () => (client as NonNullable<typeof client>).api<Story[]>("/stories"),
    [client],
  );
  const [form, setForm] = useState({ d: "", title: "", logline: "", cast: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const d = slug(form.d || form.title);
      await (client as NonNullable<typeof client>).createStory({
        d,
        title: form.title,
        logline: form.logline,
        cast: form.cast
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      });
      setForm({ d: "", title: "", logline: "", cast: "" });
      setTimeout(stories.reload, 500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const n = stories.data?.length ?? 0;
  return (
    <>
      <section className="hero">
        <FilmArt />
        <div className="label">Reelstr Studio</div>
        <h1>Build a world. Add the next scene.</h1>
        <p className="muted" style={{ maxWidth: "38rem" }}>
          A story is a logline, a cast and a style. Anyone can add a scene to it or branch from one,
          and curators cut the best branches into episodes that pay everyone who made a scene.
        </p>
        <div className="stats">
          <div className="hero-inset stat">
            <span className="label">Stories</span>
            <span className="num">{n}</span>
          </div>
        </div>
      </section>

      <div className="label" style={{ margin: "1.5rem 0 0.6rem" }}>
        Stories
      </div>
      {stories.error && <p className="error">{stories.error}</p>}
      {!stories.data && !stories.error && (
        <div className="grid" role="status" aria-label="Loading stories">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      )}
      <div className="grid">
        {stories.data?.map((s) => (
          <a
            key={s.coord}
            className={`cover ${tone(s.coord)}`}
            href={`#/story/${encodeURIComponent(s.coord)}`}
          >
            <div>
              <div className="cover-title">{s.title}</div>
              <p>{s.logline}</p>
            </div>
            <div className="between">
              <span className="pill">Open the tree</span>
              <span className="label" style={{ color: "inherit", opacity: 0.7 }}>
                {s.pubkey.slice(0, 6)}
              </span>
            </div>
          </a>
        ))}
      </div>
      {stories.data?.length === 0 && (
        <div className="card empty">
          <strong>No stories yet</strong>
          Start one below.
        </div>
      )}

      <div className="cols" style={{ marginTop: "1.5rem" }}>
        <div className="card card-soft">
          <h3>How it works</h3>
          <ol className="steps">
            <li>
              <b>Start a story.</b> A title, a logline and the characters.
            </li>
            <li>
              <b>Add scenes.</b> Upload a 10 to 15 second clip, or commission a bot. Branch from any
              scene.
            </li>
            <li>
              <b>Curators cut episodes.</b> Scenes used in an episode earn their share of each
              unlock.
            </li>
          </ol>
        </div>
        <div className="card">
          <h3>New story</h3>
          <label htmlFor="st-title">Title</label>
          <input
            id="st-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <label htmlFor="st-logline">Logline</label>
          <input
            id="st-logline"
            value={form.logline}
            onChange={(e) => setForm({ ...form, logline: e.target.value })}
          />
          <label htmlFor="st-cast">Cast (one character per line)</label>
          <textarea
            id="st-cast"
            rows={3}
            value={form.cast}
            onChange={(e) => setForm({ ...form, cast: e.target.value })}
          />
          <p>
            <button type="button" disabled={busy || !form.title || !form.logline} onClick={create}>
              {busy ? "Publishing…" : "Create story"}
            </button>
          </p>
          {err && <p className="error">{err}</p>}
        </div>
      </div>
    </>
  );
}
