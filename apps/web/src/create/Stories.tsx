import {
  BackLink,
  Explain,
  FilmArt,
  go,
  SourceBadge,
  type TreeNode,
  TreeView,
  useAsync,
  useSession,
} from "@reelstr/ui";
import { useState } from "react";

interface Story {
  coord: string;
  title: string;
  logline: string;
  pubkey: string;
  d: string;
}
interface SceneRow {
  id: string;
  title: string;
  content: string;
  video_sha: string;
  video_url: string;
  duration: number;
  license: string;
  author: string;
  parent_id: string | null;
  eligible: boolean;
  gen: string;
}

/** A stable colour per story, so a world always looks like itself. */
const tone = (coord: string) => {
  let h = 0;
  for (const ch of coord) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `tone-${h % 4}`;
};

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

export function StoryPage({ coord }: { coord: string }) {
  const { client, endpoints } = useSession();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const tree = useAsync(
    () => api<TreeNode[]>(`/stories/${encodeURIComponent(coord)}/tree`),
    [coord, client],
  );
  const story = useAsync(
    async () => (await api<Story[]>("/stories")).find((s) => s.coord === coord),
    [coord, client],
  );
  const [sel, setSel] = useState<TreeNode>();
  const scene = useAsync(
    async () => (sel ? await api<SceneRow>(`/scenes/${sel.id}`) : undefined),
    [sel?.id],
  );
  const gen = scene.data
    ? (JSON.parse(scene.data.gen || "{}") as {
        model?: { name: string; open: boolean };
        seed?: string;
      })
    : undefined;

  const usedCount = tree.data?.filter((n) => n.used).length ?? 0;
  return (
    <>
      <Explain title="How to read this tree">
        Each box is one short scene. A scene hangs under the one it continues, so a branch is one
        possible way the story goes. "Reply" is just the default title of a scene nobody named. Open
        a scene to watch it, or press Start a new branch to add yours.
      </Explain>
      <section className="hero">
        <BackLink href="#/stories">Stories</BackLink>
        <h1>{story.data?.title ?? "Story"}</h1>
        <p className="muted" style={{ maxWidth: "38rem" }}>
          {story.data?.logline}
        </p>
        <div className="row tight" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={() => go("compose", coord)}>
            {(tree.data?.length ?? 0) === 0 ? "Add the first scene" : "Start a new branch"}
          </button>
        </div>
        <div className="stats">
          <div className="hero-inset stat">
            <span className="label">Scenes</span>
            <span className="num">{tree.data?.length ?? 0}</span>
          </div>
          <div className="hero-inset stat">
            <span className="label">In episodes</span>
            <span className="num">{usedCount}</span>
          </div>
        </div>
      </section>

      <div className="between" style={{ margin: "0.25rem 0 0.6rem" }}>
        <span className="label">Scene tree</span>
        <span className="pill pill-fair">green = used in an episode</span>
      </div>
      {tree.error && <p className="error">{tree.error}</p>}
      {tree.data && tree.data.length > 0 && (
        <TreeView nodes={tree.data} selected={sel?.id} onSelect={setSel} />
      )}
      {tree.data?.length === 0 && (
        <div className="card empty">
          <strong>No scenes yet</strong>
          Add the first one to start the tree.
        </div>
      )}
      {sel && scene.data && (
        <div className="watch" style={{ marginTop: "0.5rem" }}>
          <div className="phone">
            {/* biome-ignore lint/a11y/useMediaCaption: raw scenes have no transcript; curated episodes get captions in the player */}
            <video
              className="player"
              controls
              playsInline
              src={scene.data.video_url || `${endpoints.blossom}/${scene.data.video_sha}.mp4`}
            />
          </div>
          <div>
            <div className="label">Scene</div>
            <h2 style={{ margin: "0.25rem 0 0.5rem" }}>{scene.data.title}</h2>
            <p>{scene.data.content}</p>
            <div className="row tight" style={{ margin: "0.75rem 0" }}>
              <span className="pill num">{Number(scene.data.duration).toFixed(1)} s</span>
              <span className="pill">{scene.data.license}</span>
              <span className="pill num">by {scene.data.author.slice(0, 8)}…</span>
              {gen?.model && (
                <span className="pill">
                  {gen.model.name} ({gen.model.open ? "open weights" : "closed"})
                </span>
              )}
              {scene.data.eligible && <span className="pill pill-fair">re-render eligible</span>}
              <SourceBadge sceneId={scene.data.id} />
            </div>
            <button type="button" onClick={() => go("compose", coord, sel.id)}>
              Fork / continue from here
            </button>
          </div>
        </div>
      )}
    </>
  );
}
