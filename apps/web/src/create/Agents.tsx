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
      <section className="hero">
        <div className="label">Generation agents</div>
        <h1>Commission a scene from a bot</h1>
        <p className="muted" style={{ maxWidth: "38rem" }}>
          Agents are bots with their own keys. You pay only after you accept the scene, in sats,
          from your wallet. The scene credits the agent as author and you as commissioner.
        </p>
        <div className="stats">
          <div className="hero-inset stat">
            <span className="label">Agents on your relays</span>
            <span className="num">{agents.data?.length ?? 0}</span>
          </div>
          <div className="hero-inset stat">
            <span className="label">Your wallet</span>
            <span className="num">{pay.wallet ? `${pay.balance} sats` : "none"}</span>
          </div>
        </div>
      </section>
      {agents.error && <p className="error">{agents.error}</p>}
      {agents.data?.length === 0 && (
        <div className="card empty">
          <strong>No agents found</strong>
          None of your relays has an agent profile yet.
        </div>
      )}
      <div className="cols">
        <div className="card">
          <h3>New request</h3>
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
        <div className="card card-soft">
          <h3>How paying works</h3>
          <ol className="steps">
            <li>
              <b>You send a signed request</b> naming the agent, your prompt and the most you will
              pay.
            </li>
            <li>
              <b>The agent generates and replies</b> with a signed scene. Nothing is published yet
              and you have paid nothing.
            </li>
            <li>
              <b>You review it.</b> If you accept, the scene is published and the agent is paid with
              a nutzap. Otherwise nothing happens.
            </li>
          </ol>
          <p className="muted">
            Open-weight models with a seed make the scene re-renderable, so a verifier can check it.
          </p>
        </div>
      </div>
      {delivery && scene && (
        <div className="card" data-testid="delivery">
          <div className="label">Delivered</div>
          <h2 style={{ margin: "0.2rem 0 0.75rem" }}>Delivered scene</h2>
          {videoUrl && (
            <div className="phone" style={{ width: "min(100%, 15rem)", margin: "0 0 1rem" }}>
              {/* biome-ignore lint/a11y/useMediaCaption: generated preview without a transcript */}
              <video className="player" controls playsInline src={videoUrl} />
            </div>
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
      <p className="muted num" style={{ fontSize: "0.8rem" }}>
        Signed in as {pubkey?.slice(0, 8)}… · kind {KIND.JOB_REQUEST}/{KIND.JOB_RESULT}{" "}
        request/result events
      </p>
    </>
  );
}
