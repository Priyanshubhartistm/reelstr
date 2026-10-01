import { computeWeights, type Weight } from "@reelstr/protocol";
import { SceneSequencePlayer, SplitTable, useAsync, useSession } from "@reelstr/ui";
import { useMemo, useState } from "react";
import type { CutRow } from "./Home";

interface SceneRow {
  id: string;
  title: string;
  payee: string;
  video_sha: string;
  video_url: string;
  duration: number;
  author: string;
}
interface InboxItem {
  id: string;
  author: string;
  score: number;
  hops?: number;
}
interface Item {
  /** stable key: the same scene can be used twice in one episode */
  uid: string;
  id: string;
  sha: string;
  url: string;
  title: string;
  duration: number;
  inSec: number;
  outSec: number;
  payee: string;
}
interface Story {
  coord: string;
  title: string;
}

const short = (pk: string) => `${pk.slice(0, 8)}…`;

/** Curator desk: inbox, timeline editor, split preview, publish (US-K1..K4). */
export function Desk() {
  const { client, endpoints, pubkey } = useSession();
  const c = client as NonNullable<typeof client>;
  const me = pubkey as string;
  const stories = useAsync(() => c.api<Story[]>("/stories"), [c]);
  const [story, setStory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const pool = useAsync(async () => {
    if (!story) return [] as (SceneRow & { score?: number; hops?: number })[];
    const ids: InboxItem[] = showAll
      ? (await c.api<{ id: string }[]>(`/stories/${encodeURIComponent(story)}/tree`)).map((n) => ({
          id: n.id,
          author: "",
          score: 0,
        }))
      : await c.api<InboxItem[]>(`/inbox?curator=${me}&story=${encodeURIComponent(story)}`);
    const rows = await Promise.all(ids.map((i) => c.api<SceneRow>(`/scenes/${i.id}`)));
    return rows.map((r, k) => ({ ...r, score: ids[k]?.score, hops: ids[k]?.hops }));
  }, [story, showAll]);

  const [items, setItems] = useState<Item[]>([]);
  // editing a published episode: publishing creates a new version of the same episode (same d tag)
  const [editing, setEditing] = useState<{ episode: number; coord: string } | null>(null);
  // timeline slot whose scene is being replaced: the next scene chosen from the list takes its place
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null);
  const mine = useAsync(() => c.api<CutRow[]>(`/cuts?curator=${me}`), [c]);
  const [meta, setMeta] = useState({
    slug: "",
    seriesTitle: "",
    summary: "",
    title: "",
    synopsis: "",
    price: 50,
    free: 1,
    curatorPct: 20,
    hostPct: 10,
    host: "",
    warning: "",
    captionLang: "en",
  });
  const [caption, setCaption] = useState<{ url: string; sha256: string; name: string } | null>(
    null,
  );
  // a generated caption draft the creator reads and fixes before it is attached
  const [draft, setDraft] = useState<string | null>(null);
  const [bed, setBed] = useState<{ sha: string; poolPct: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const src = (s: SceneRow) => s.video_url || `${endpoints.blossom}/${s.video_sha}.mp4`;
  const itemOf = (s: SceneRow): Item => ({
    uid: crypto.randomUUID(),
    id: s.id,
    sha: s.video_sha,
    url: src(s),
    title: s.title,
    duration: Number(s.duration),
    inSec: 0,
    outSec: Number(s.duration),
    payee: s.payee,
  });
  const add = (s: SceneRow) => {
    if (replaceIdx !== null) {
      setItems((xs) => xs.map((x, k) => (k === replaceIdx ? itemOf(s) : x)));
      setReplaceIdx(null);
    } else setItems((xs) => [...xs, itemOf(s)]);
  };

  /** Load a published episode into the editor: scenes with their trims, plus everything else the Cut carried. */
  async function loadForEdit(
    cut: CutRow & {
      synopsis?: string;
      captions?: string;
      audio_bed?: string | null;
      content_warning?: string | null;
    },
  ) {
    setErr("");
    try {
      const rows = await c.api<
        { scene_id: string; sha: string; in_sec: number; out_sec: number; payee: string }[]
      >(`/cuts/${cut.id}/scenes`);
      const loaded: Item[] = [];
      for (const r of rows) {
        const sc = await c.api<SceneRow>(`/scenes/${r.scene_id}`);
        loaded.push({
          ...itemOf(sc),
          inSec: Number(r.in_sec),
          outSec: Number(r.out_sec),
          payee: r.payee,
        });
      }
      const credits = await c.api<{ pubkey: string; role: string; weight: number }[]>(
        `/cuts/${cut.id}/credits`,
      );
      const w = (role: string) => credits.find((x) => x.role === role);
      const sers =
        await c.api<
          { slug: string; curator: string; title: string; summary: string; free: number }[]
        >("/series");
      const ser = sers.find((x) => x.slug === cut.series_slug && x.curator === me);
      setItems(loaded);
      setEditing({ episode: cut.episode, coord: cut.coord });
      setMeta((m) => ({
        ...m,
        slug: cut.series_slug,
        seriesTitle: ser?.title ?? m.seriesTitle,
        summary: ser?.summary ?? m.summary,
        free: ser?.free ?? m.free,
        title: cut.title,
        synopsis: cut.synopsis ?? "",
        price: Number(cut.price),
        curatorPct: (w("curator")?.weight ?? 0) / 100,
        hostPct: (w("host")?.weight ?? 0) / 100,
        host: w("host")?.pubkey && w("host")?.pubkey !== me ? (w("host")?.pubkey as string) : "",
        warning: cut.content_warning ?? "",
      }));
      const caps = JSON.parse(cut.captions ?? "[]") as {
        url: string;
        lang: string;
        sha256?: string;
      }[];
      setCaption(
        caps[0]
          ? {
              url: caps[0].url,
              sha256: caps[0].sha256 ?? "",
              name: `existing ${caps[0].lang} captions`,
            }
          : null,
      );
      const bedRow = cut.audio_bed
        ? (JSON.parse(cut.audio_bed) as { sha256: string; poolBps: number })
        : null;
      setBed(bedRow ? { sha: bedRow.sha256, poolPct: bedRow.poolBps / 100 } : null);
      setStatus(
        `Editing episode ${cut.episode}. Publishing creates a new version; viewers keep their place and ratings.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const total = items.reduce((a, i) => a + (i.outSec - i.inSec), 0);
  const host = meta.host || me;

  const split = useMemo<{ weights: Weight[]; error?: string }>(() => {
    if (items.length === 0) return { weights: [] };
    try {
      return {
        weights: computeWeights({
          scenes: items.map((i) => ({ payee: i.payee, inSec: i.inSec, outSec: i.outSec })),
          audioBed: bed ? { payee: me, poolBps: bed.poolPct * 100 } : undefined,
          curatorBps: meta.curatorPct * 100,
          hostBps: meta.hostPct * 100,
          curator: me,
          host,
        }),
      };
    } catch (e) {
      return { weights: [], error: (e as Error).message };
    }
  }, [items, meta.curatorPct, meta.hostPct, host, bed, me]);

  const move = (from: number, to: number) =>
    setItems((xs) => {
      const n = [...xs];
      const [x] = n.splice(from, 1);
      if (x) n.splice(to, 0, x);
      return n;
    });
  const patch = (i: number, p: Partial<Item>) =>
    setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)));

  async function generateCaptions() {
    setBusy(true);
    setErr("");
    setStatus("Listening to the episode (speech to text runs on the media service)…");
    try {
      const r = await c.generateCaptions(
        items.map((i) => ({ sha256: i.sha, urls: [i.url], inSec: i.inSec, outSec: i.outSec })),
      );
      setDraft(r.vtt);
      setMeta((m) => ({ ...m, captionLang: r.language }));
      setStatus(`Draft ready: ${r.cues} lines. Read it, fix names and rare words, then use it.`);
    } catch (e) {
      setStatus("");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setErr("");
    try {
      const existing = await c.api<CutRow[]>(`/cuts?series=${meta.slug}&curator=${me}`);
      const episode = editing
        ? editing.episode
        : Math.max(0, ...existing.map((e) => e.episode)) + 1;
      setStatus("Rendering the episode (trims, joins, HLS ladder)… this can take a minute.");
      await c.publishCut({
        seriesSlug: meta.slug,
        episode,
        title: meta.title,
        synopsis: meta.synopsis,
        scenes: items.map((i) => ({
          id: i.id,
          sha256: i.sha,
          inSec: i.inSec,
          outSec: i.outSec,
          payee: i.payee,
        })),
        scenesSources: items.map((i) => ({ sha256: i.sha, urls: [i.url] })),
        audioBed: bed ? { sha256: bed.sha, payee: me, poolBps: bed.poolPct * 100 } : undefined,
        free: episode <= meta.free,
        contentWarning: meta.warning || undefined,
        captions: caption
          ? [{ url: caption.url, lang: meta.captionLang, sha256: caption.sha256 }]
          : undefined,
        price: { amount: meta.price },
        curatorBps: meta.curatorPct * 100,
        hostBps: meta.hostPct * 100,
        host,
        relay: c.cfg.relays[0],
      });
      setStatus("Updating the series…");
      await c.publishSeries({
        slug: meta.slug,
        title: meta.seriesTitle || meta.slug,
        summary: meta.summary,
        episodes: [...new Set([...existing.map((e) => e.episode), episode])].sort((a, b) => a - b),
        freeEpisodes: meta.free,
      });
      setStatus(
        editing
          ? `Published a new version of episode ${episode}.`
          : `Published episode ${episode}.`,
      );
      setItems([]);
      setEditing(null);
      setReplaceIdx(null);
    } catch (e) {
      setErr((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const tooShort = total > 0 && (total < 60 || total > 120);
  const ready = items.length > 0 && meta.slug && meta.title && !split.error && !busy;
  return (
    <>
      <h1>Curator desk</h1>
      <p className="muted">
        Pick scenes, order them into an episode, check the split, publish. Viewers only ever see
        your cut.
      </p>
      <label htmlFor="d-story">Story</label>
      <select id="d-story" value={story} onChange={(e) => setStory(e.target.value)}>
        <option value="">Choose a story…</option>
        {stories.data?.map((s) => (
          <option key={s.coord} value={s.coord}>
            {s.title}
          </option>
        ))}
      </select>
      {story && (
        <>
          <h2>
            Scenes{" "}
            <label className="check" style={{ display: "inline-flex", marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />{" "}
              include scenes already used
            </label>
          </h2>
          {pool.error && <p className="error">{pool.error}</p>}
          <div className="card">
            {pool.data?.length === 0 && (
              <p className="muted">
                Inbox is empty. Scenes from authors you don't follow need proof of work to show up.
              </p>
            )}
            {pool.data?.map((s) => (
              <div key={s.id} className="row" style={{ alignItems: "center", padding: ".3rem 0" }}>
                <span>
                  <strong>{s.title}</strong>{" "}
                  <span className="muted">
                    {Number(s.duration).toFixed(1)} s · {short(s.author)}
                  </span>
                </span>
                {s.hops !== undefined && (
                  <span className="pill">
                    {s.hops === 0 ? "you" : `${s.hops} hop${s.hops > 1 ? "s" : ""}`}
                  </span>
                )}
                <button type="button" className="ghost" onClick={() => add(s)}>
                  {replaceIdx !== null ? `Use as scene ${replaceIdx + 1}` : "Add"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Edit a published episode</h2>
      <p className="muted">
        Load one of your episodes, change or replace scenes, and publish a new version. It keeps the
        same episode number, so viewers keep their place, ratings and unlocks.
      </p>
      <div className="row">
        <select
          aria-label="Your published episodes"
          value={editing?.coord ?? ""}
          onChange={(e) => {
            const cut = mine.data?.find((x) => x.coord === e.target.value);
            if (cut) void loadForEdit(cut);
            else {
              setEditing(null);
              setItems([]);
            }
          }}
        >
          <option value="">New episode</option>
          {mine.data?.map((x) => (
            <option key={x.coord} value={x.coord}>
              {x.series_slug} · Ep {x.episode} · {x.title}
            </option>
          ))}
        </select>
      </div>

      <h2>
        {editing ? `Editing episode ${editing.episode}` : "Episode timeline"}{" "}
        <span className="muted">{total.toFixed(1)} s</span>
      </h2>
      {items.length === 0 && (
        <p className="muted">Add scenes above, then drag to reorder and set trims.</p>
      )}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <ul style={{ flex: 2, minWidth: 280, listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((it, i) => (
            <li
              key={it.uid}
              className="card"
              style={{ marginBottom: 8, opacity: drag === i ? 0.5 : 1 }}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) move(drag, i);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <div className="row" style={{ alignItems: "center" }}>
                <strong>
                  {i + 1}. {it.title}
                </strong>
                <span className="muted">{(it.outSec - it.inSec).toFixed(2)} s</span>
                <span>
                  <button
                    type="button"
                    className="ghost"
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>{" "}
                  <button
                    type="button"
                    className="ghost"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, i + 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>{" "}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}
                  >
                    Remove
                  </button>{" "}
                  <button
                    type="button"
                    className="ghost"
                    aria-pressed={replaceIdx === i}
                    onClick={() => setReplaceIdx(replaceIdx === i ? null : i)}
                  >
                    {replaceIdx === i ? "Cancel replace" : "Replace"}
                  </button>
                </span>
              </div>
              <div className="row">
                <div>
                  <label htmlFor={`in${i}`}>In (s)</label>
                  <input
                    id={`in${i}`}
                    type="number"
                    step="0.001"
                    min="0"
                    max={it.outSec - 0.1}
                    value={it.inSec}
                    onChange={(e) => patch(i, { inSec: Math.max(0, Number(e.target.value)) })}
                  />
                </div>
                <div>
                  <label htmlFor={`out${i}`}>Out (s)</label>
                  <input
                    id={`out${i}`}
                    type="number"
                    step="0.001"
                    min={it.inSec + 0.1}
                    max={it.duration}
                    value={it.outSec}
                    onChange={(e) =>
                      patch(i, { outSec: Math.min(it.duration, Number(e.target.value)) })
                    }
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <SceneSequencePlayer
          autoPlay={false}
          maxWidth={260}
          clips={items.map((i) => ({ src: i.url, inSec: i.inSec, outSec: i.outSec }))}
        />
      </div>
      {tooShort && (
        <p className="muted">Episodes are usually 60 to 120 s; this one is {total.toFixed(0)} s.</p>
      )}

      <h2>Score (optional)</h2>
      <input
        type="file"
        accept="audio/*,video/*"
        aria-label="Audio bed"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return setBed(null);
          const d = await c.blossom.upload(
            new Uint8Array(await f.arrayBuffer()),
            f.type || "audio/mp4",
          );
          setBed({ sha: d.sha256, poolPct: 10 });
        }}
      />
      {bed && (
        <p className="muted">
          Bed uploaded. It takes{" "}
          <input
            style={{ width: 70 }}
            type="number"
            min="0"
            max="100"
            value={bed.poolPct}
            onChange={(e) => setBed({ ...bed, poolPct: Number(e.target.value) })}
          />{" "}
          % of the creator pool, paid to you.
        </p>
      )}

      <h2>Episode and series</h2>
      <div className="card">
        <div className="row">
          <div>
            <label htmlFor="m-slug">Series slug</label>
            <input
              id="m-slug"
              placeholder="the-vault"
              value={meta.slug}
              onChange={(e) =>
                setMeta({ ...meta, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
              }
            />
          </div>
          <div>
            <label htmlFor="m-st">Series title</label>
            <input
              id="m-st"
              value={meta.seriesTitle}
              onChange={(e) => setMeta({ ...meta, seriesTitle: e.target.value })}
            />
          </div>
        </div>
        <label htmlFor="m-sum">Series synopsis</label>
        <input
          id="m-sum"
          value={meta.summary}
          onChange={(e) => setMeta({ ...meta, summary: e.target.value })}
        />
        <div className="row">
          <div>
            <label htmlFor="m-t">Episode title</label>
            <input
              id="m-t"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="m-p">Price (sats)</label>
            <input
              id="m-p"
              type="number"
              min="0"
              value={meta.price}
              onChange={(e) => setMeta({ ...meta, price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="m-f">Free episodes</label>
            <input
              id="m-f"
              type="number"
              min="0"
              value={meta.free}
              onChange={(e) => setMeta({ ...meta, free: Number(e.target.value) })}
            />
          </div>
        </div>
        <label htmlFor="m-syn">Episode synopsis</label>
        <input
          id="m-syn"
          value={meta.synopsis}
          onChange={(e) => setMeta({ ...meta, synopsis: e.target.value })}
        />
        <label htmlFor="m-cap">Captions (WebVTT file, optional)</label>
        <div className="row">
          <input
            id="m-cap"
            type="file"
            accept=".vtt,text/vtt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return setCaption(null);
              const text = await f.text();
              if (!text.trimStart().startsWith("WEBVTT"))
                return setErr("That does not look like a WebVTT file (it must start with WEBVTT).");
              setErr("");
              const d = await c.blossom.upload(new TextEncoder().encode(text), "text/vtt");
              setCaption({ url: d.url, sha256: d.sha256, name: f.name });
            }}
          />
          <input
            aria-label="Caption language"
            style={{ maxWidth: 90 }}
            value={meta.captionLang}
            onChange={(e) => setMeta({ ...meta, captionLang: e.target.value.trim() })}
          />
        </div>
        {caption && <p className="muted">Uploaded {caption.name}.</p>}
        <p>
          <button
            type="button"
            className="ghost"
            disabled={busy || items.length === 0}
            onClick={generateCaptions}
          >
            Generate captions (draft)
          </button>
        </p>
        {draft !== null && (
          <>
            <label htmlFor="m-draft">Caption draft (edit before using)</label>
            <textarea
              id="m-draft"
              rows={8}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ fontFamily: "monospace" }}
            />
            <p>
              <button
                type="button"
                disabled={busy || !draft.trimStart().startsWith("WEBVTT")}
                onClick={async () => {
                  const d = await c.blossom.upload(new TextEncoder().encode(draft), "text/vtt");
                  setCaption({ url: d.url, sha256: d.sha256, name: "generated captions" });
                  setDraft(null);
                }}
              >
                Use these captions
              </button>
            </p>
          </>
        )}
        <label htmlFor="m-cw">Content warning (optional)</label>
        <input
          id="m-cw"
          placeholder="e.g. violence, flashing lights: viewers must opt in to watch"
          value={meta.warning}
          onChange={(e) => setMeta({ ...meta, warning: e.target.value })}
        />
        <div className="row">
          <div>
            <label htmlFor="m-c">Your share %</label>
            <input
              id="m-c"
              type="number"
              min="0"
              max="100"
              value={meta.curatorPct}
              onChange={(e) => setMeta({ ...meta, curatorPct: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="m-h">Host share %</label>
            <input
              id="m-h"
              type="number"
              min="0"
              max="100"
              value={meta.hostPct}
              onChange={(e) => setMeta({ ...meta, hostPct: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="m-hk">Host pubkey (default: you)</label>
            <input
              id="m-hk"
              value={meta.host}
              onChange={(e) => setMeta({ ...meta, host: e.target.value.trim() })}
            />
          </div>
        </div>
      </div>

      <h2>Payout split</h2>
      <p className="muted">
        Creators are paid by the seconds of their scenes you kept (after trims). This is exactly
        what the signed episode will declare.
      </p>
      {split.error && <p className="error">{split.error}</p>}
      {split.weights.length > 0 && <SplitTable weights={split.weights} priceSats={meta.price} />}
      <p>
        <button type="button" disabled={!ready} onClick={publish}>
          {busy
            ? "Publishing…"
            : editing
              ? "Render and publish new version"
              : "Render and publish episode"}
        </button>
      </p>
      {status && <p className="ok">{status}</p>}
      {err && <p className="error">{err}</p>}
    </>
  );
}
