import {
  BackLink,
  Explain,
  go,
  SourceBadge,
  type TreeNode,
  TreeView,
  useAsync,
  useSession,
} from "@reelstr/ui";
import { useState } from "react";
import type { SceneRow, Story } from "./types";

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
