import type { NostrEvent } from "@reelstr/nostr";
import { KIND, parseAgentProfile, parseJobResult } from "@reelstr/protocol";
import { useAsync, usePayments, useSession } from "@reelstr/ui";
import { acceptResult, awaitResult, requestJob } from "@reelstr/wallet";
import { useState } from "react";

interface AgentRow {
  pubkey: string;
  name: string;
  models: string[];
  priceSats: number;
}

/** NP-5: commission a scene from a generation agent and pay it on acceptance. */
export function Agents({ coord }: { coord?: string }) {
  const { client, pubkey } = useSession();
  const c = client as NonNullable<typeof client>;
  const pay = usePayments();
  const agents = useAsync(async (): Promise<AgentRow[]> => {
    const profiles = await c.pool.query(c.cfg.relays, { kinds: [0], "#t": ["reelstr"] });
    const latest = new Map<string, NostrEvent>();
    for (const p of profiles)
      if (!latest.has(p.pubkey) || (latest.get(p.pubkey)?.created_at ?? 0) < p.created_at)
        latest.set(p.pubkey, p);
    return [...latest.values()].flatMap((e) => {
      const a = parseAgentProfile(e);
      return a
        ? [{ pubkey: e.pubkey, name: a.name, models: a.models, priceSats: a.priceSats }]
        : [];
    });
  }, [c]);
  const stories = useAsync(() => c.api<{ coord: string; title: string }[]>("/stories"), [c]);
  const [agent, setAgent] = useState("");
  const [story, setStory] = useState(coord ?? "");
  const [f, setF] = useState({ prompt: "", model: "", seed: "", duration: 12, bid: 0 });
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [delivery, setDelivery] = useState<{ result: NostrEvent; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = agents.data?.find((a) => a.pubkey === agent);
  const bid = f.bid || chosen?.priceSats || 0;

  async function order() {
    if (!chosen) return;
    setBusy(true);
    setErr("");
    setDelivery(null);
    try {
      const r = { signer: c.cfg.signer, pool: c.pool, relays: c.cfg.relays };
      const root = story.split(":");
      setStatus("Sent. Waiting for the agent to generate the scene…");
      const job = await requestJob(r, {
        agent: chosen.pubkey,
        prompt: f.prompt,
        story: { pubkey: root[1] as string, d: root.slice(2).join(":") },
        model: f.model || (chosen.models[0] as string),
        seed: f.seed || undefined,
        durationSec: f.duration,
        bidSats: bid,
      });
      const result = await awaitResult(r, job.id, chosen.pubkey, 600_000);
      setDelivery({ result, title: f.prompt.slice(0, 60) });
      setStatus("Delivered. Review it, then accept to publish it and pay the agent.");
    } catch (e) {
      setErr((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!delivery || !pay.wallet) return;
    setBusy(true);
    setErr("");
    try {
      const r = { signer: c.cfg.signer, pool: c.pool, relays: c.cfg.relays };
      pay.guard.check(bid);
      await acceptResult(r, delivery.result, pay.wallet, bid);
      pay.guard.record(bid);
      await pay.record("out", bid, `agent job ${delivery.title}`);
      await pay.refresh();
      setStatus(`Accepted. The scene is published and ${bid} sats went to the agent.`);
      setDelivery(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scene = delivery
    ? (JSON.parse(parseJobResult(delivery.result).content) as NostrEvent)
    : null;
  const videoUrl = scene?.tags
    .find((t) => t[0] === "imeta" && t.includes("m video/mp4"))
    ?.find((p) => p.startsWith("url "))
    ?.slice(4);
  return (
    <>
      <h1>Agents</h1>
      <p className="muted">
        Generation agents are bots with their own keys. You pay only after you accept the scene, in
        sats, from your wallet. The scene credits the agent as author and you as commissioner.
      </p>
      {agents.error && <p className="error">{agents.error}</p>}
      {agents.data?.length === 0 && <p className="muted">No agents found on your relays.</p>}
      <div className="card">
        <label htmlFor="ag-agent">Agent</label>
        <select
          id="ag-agent"
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value);
            setF({ ...f, model: "" });
          }}
        >
          <option value="">Choose…</option>
          {agents.data?.map((a) => (
            <option key={a.pubkey} value={a.pubkey}>
              {a.name} · {a.priceSats} sats · {a.models.join(", ")}
            </option>
          ))}
        </select>
        <label htmlFor="ag-story">Story</label>
        <select id="ag-story" value={story} onChange={(e) => setStory(e.target.value)}>
          <option value="">Choose…</option>
          {stories.data?.map((s) => (
            <option key={s.coord} value={s.coord}>
              {s.title}
            </option>
          ))}
        </select>
        <label htmlFor="ag-prompt">Prompt</label>
        <textarea
          id="ag-prompt"
          rows={3}
          value={f.prompt}
          onChange={(e) => setF({ ...f, prompt: e.target.value })}
        />
        <div className="row">
          <div>
            <label htmlFor="ag-model">Model</label>
            <select
              id="ag-model"
              value={f.model || chosen?.models[0] || ""}
              onChange={(e) => setF({ ...f, model: e.target.value })}
            >
              {(chosen?.models ?? []).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ag-seed">Seed (optional)</label>
            <input
              id="ag-seed"
              value={f.seed}
              onChange={(e) => setF({ ...f, seed: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ag-dur">Seconds</label>
            <input
              id="ag-dur"
              type="number"
              min="4"
              max="20"
              value={f.duration}
              onChange={(e) => setF({ ...f, duration: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="ag-bid">Bid (sats)</label>
            <input
              id="ag-bid"
              type="number"
              min="0"
              placeholder={String(chosen?.priceSats ?? 0)}
              value={f.bid || ""}
              onChange={(e) => setF({ ...f, bid: Number(e.target.value) })}
            />
          </div>
        </div>
        <p>
          <button type="button" disabled={busy || !chosen || !story || !f.prompt} onClick={order}>
            {busy ? "Working…" : "Request scene"}
          </button>
        </p>
      </div>
      {delivery && scene && (
        <div className="card" style={{ marginTop: 12 }} data-testid="delivery">
          <h2 style={{ marginTop: 0 }}>Delivered scene</h2>
          {videoUrl && (
            // biome-ignore lint/a11y/useMediaCaption: generated preview without a transcript
            <video
              className="player"
              style={{ maxWidth: 240 }}
              controls
              playsInline
              src={videoUrl}
            />
          )}
          <p>
            {pay.wallet ? (
              <>Wallet: {pay.balance} sats.</>
            ) : (
              <span className="muted">
                Connect a wallet first (open Cinema's wallet page or set a mint).
              </span>
            )}
          </p>
          <button
            type="button"
            disabled={busy || !pay.wallet || pay.balance < bid}
            onClick={accept}
          >
            Accept and pay {bid} sats
          </button>
        </div>
      )}
      {status && <p className="ok">{status}</p>}
      {err && <p className="error">{err}</p>}
      <p className="muted">
        Signed in as {pubkey?.slice(0, 8)}… · kind {KIND.JOB_REQUEST}/{KIND.JOB_RESULT}{" "}
        request/result events
      </p>
    </>
  );
}
