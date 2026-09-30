import type { NostrEvent } from "@reelstr/nostr";
import { useAsync, useSession } from "@reelstr/ui";
import { useState } from "react";

const MAX_BYTES = 200 * 1024 * 1024;

/** FE-2 / FE-3: upload a clip, fill the manifest, pick a parent, publish. Fork/continue pre-fills from the parent. */
export function Composer({
  coord,
  parent,
  onDone,
}: {
  coord: string;
  parent?: string;
  onDone: () => void;
}) {
  const { client } = useSession();
  const c = client as NonNullable<typeof client>;
  const parentEv = useAsync(
    async () =>
      parent ? ((await c.pool.get(c.cfg.relays, { ids: [parent] })) as NostrEvent | null) : null,
    [parent],
  );
  const [file, setFile] = useState<File>();
  const [f, setF] = useState({
    title: "",
    prompt: "",
    model: "",
    open: true,
    seed: "",
    refs: "",
    loras: "",
    license: "CC-BY-SA-4.0",
    fit: "crop" as "crop" | "letterbox",
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const root = coord.split(":");
  const hashes = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  async function publish() {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      if (file.size > MAX_BYTES) throw new Error("file is over 200 MB");
      setMsg("Uploading and normalizing (1080×1920, 30 fps, −14 LUFS)…");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const gen = {
        model: f.model ? { name: f.model, open: f.open } : undefined,
        seed: f.seed || undefined,
        refs: hashes(f.refs),
        loras: hashes(f.loras),
      };
      const base = {
        bytes,
        contentType: file.type || "video/mp4",
        title: f.title,
        prompt: f.prompt,
        fit: f.fit,
      };
      if (parentEv.data)
        await c.forkScene(parentEv.data, { ...base, gen: gen.model ? gen : undefined });
      else
        await c.publishScene({
          ...base,
          story: { pubkey: root[1] as string, d: root.slice(2).join(":") },
          license: f.license,
          gen,
        });
      setMsg("Published.");
      setTimeout(onDone, 600);
    } catch (e) {
      setErr((e as Error).message);
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        <a href={`#/story/${encodeURIComponent(coord)}`}>← Story</a>
      </p>
      <h1>{parent ? "Fork or continue" : "New scene"}</h1>
      {parent && (
        <p className="muted">
          Following scene <code>{parent.slice(0, 10)}…</code>. Its story, license and generation
          manifest carry over, and the original creator is credited automatically.
        </p>
      )}
      <div className="card">
        <label htmlFor="c-file">Clip (MP4 or MOV, up to 20 s, up to 200 MB)</label>
        <input
          id="c-file"
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          onChange={(e) => setFile(e.target.files?.[0])}
        />
        <div className="row">
          <div>
            <label htmlFor="c-title">Title</label>
            <input
              id="c-title"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="c-fit">If not vertical</label>
            <select
              id="c-fit"
              value={f.fit}
              onChange={(e) => setF({ ...f, fit: e.target.value as "crop" | "letterbox" })}
            >
              <option value="crop">Crop to fill</option>
              <option value="letterbox">Letterbox</option>
            </select>
          </div>
        </div>
        <label htmlFor="c-prompt">Prompt / description / dialogue</label>
        <textarea
          id="c-prompt"
          rows={3}
          value={f.prompt}
          onChange={(e) => setF({ ...f, prompt: e.target.value })}
        />
        <h2>Manifest</h2>
        <p className="muted">
          Open-weight models with a seed and hashed references make a scene re-renderable.
        </p>
        <div className="row">
          <div>
            <label htmlFor="c-model">Model</label>
            <input
              id="c-model"
              placeholder="wan-2.2-t2v"
              value={f.model}
              onChange={(e) => setF({ ...f, model: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="c-seed">Seed</label>
            <input
              id="c-seed"
              value={f.seed}
              onChange={(e) => setF({ ...f, seed: e.target.value })}
            />
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={f.open}
            onChange={(e) => setF({ ...f, open: e.target.checked })}
          />{" "}
          Open-weight model
        </label>
        <label htmlFor="c-refs">Reference image SHA-256s (comma separated)</label>
        <input id="c-refs" value={f.refs} onChange={(e) => setF({ ...f, refs: e.target.value })} />
        <label htmlFor="c-loras">LoRA SHA-256s (comma separated)</label>
        <input
          id="c-loras"
          value={f.loras}
          onChange={(e) => setF({ ...f, loras: e.target.value })}
        />
        {!parent && (
          <>
            <label htmlFor="c-license">License</label>
            <select
              id="c-license"
              value={f.license}
              onChange={(e) => setF({ ...f, license: e.target.value })}
            >
              <option>CC-BY-SA-4.0</option>
              <option>CC-BY-4.0</option>
              <option>CC0-1.0</option>
              <option value="All-Rights-Reserved">All rights reserved (not forkable)</option>
            </select>
            <p className="muted">
              A license covers the human-authored layer: your script, selection and edit. Raw AI
              output may not be copyrightable.
            </p>
          </>
        )}
        <p>
          <button
            type="button"
            disabled={busy || !file || !f.title || !f.prompt || (!!parent && !parentEv.data)}
            onClick={publish}
          >
            {busy ? "Working…" : parent ? "Publish fork" : "Publish scene"}
          </button>
        </p>
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </div>
    </>
  );
}
