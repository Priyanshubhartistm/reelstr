import { go, type TreeNode, TreeView, useAsync, useSession } from "@reelstr/ui";
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

  return (
    <>
      <h1>Stories</h1>
      <p className="muted">
        A story is a world: a logline, a cast, a style. Anyone can add scenes to it.
      </p>
      {stories.error && <p className="error">{stories.error}</p>}
      <div className="grid">
        {stories.data?.map((s) => (
          <a key={s.coord} className="card" href={`#/story/${encodeURIComponent(s.coord)}`}>
            <strong>{s.title}</strong>
            <p className="muted">{s.logline}</p>
          </a>
        ))}
        {stories.data?.length === 0 && <p className="muted">No stories yet. Start one below.</p>}
      </div>
      <h2>New story</h2>
      <div className="card">
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
    </>
  );
}

export function StoryPage({ coord }: { coord: string }) {
  const { client, endpoints, pubkey } = useSession();
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
  const mine = pubkey && coord.split(":")[1] === pubkey;

  return (
    <>
      <p>
        <a href="#/">← Stories</a>
      </p>
      <h1>{story.data?.title ?? "Story"}</h1>
      <p className="muted">{story.data?.logline}</p>
      <p>
        <button type="button" onClick={() => go("compose", coord)}>
          {mine ? "Add the first scene" : "Start a new branch"}
        </button>{" "}
        <span className="pill">{tree.data?.length ?? 0} scenes</span>{" "}
        <span className="pill">green = used in an episode</span>
      </p>
      {tree.error && <p className="error">{tree.error}</p>}
      {tree.data && tree.data.length > 0 && (
        <TreeView nodes={tree.data} selected={sel?.id} onSelect={setSel} />
      )}
      {sel && scene.data && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row">
            <div>
              <h2 style={{ marginTop: 0 }}>{scene.data.title}</h2>
              <p>{scene.data.content}</p>
              <p className="muted">
                {Number(scene.data.duration).toFixed(1)} s · {scene.data.license} · by{" "}
                {scene.data.author.slice(0, 8)}…
                {gen?.model && (
                  <>
                    {" "}
                    · {gen.model.name} ({gen.model.open ? "open weights" : "closed"})
                  </>
                )}
                {scene.data.eligible && (
                  <>
                    {" "}
                    · <span className="ok">re-render eligible</span>
                  </>
                )}
              </p>
              <button type="button" onClick={() => go("compose", coord, sel.id)}>
                Fork / continue from here
              </button>
            </div>
            {/* biome-ignore lint/a11y/useMediaCaption: raw scenes have no transcript; curated episodes get captions in the player */}
            <video
              className="player"
              style={{ maxWidth: 240 }}
              controls
              playsInline
              src={scene.data.video_url || `${endpoints.blossom}/${scene.data.video_sha}.mp4`}
            />
          </div>
        </div>
      )}
    </>
  );
}
