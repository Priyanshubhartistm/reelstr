import type { ReelstrClient } from "@reelstr/app-core";
import type { NostrEvent, RelayPool, Signer } from "@reelstr/nostr";
import {
  buildAgentProfile,
  buildJobResult,
  isForkable,
  type JobRequest,
  KIND,
  parseJobRequest,
  parseScene,
  validateEvent,
} from "@reelstr/protocol";
import {
  buildNutzapInfo,
  type CashuWallet,
  parseNutzap,
  redeemNutzap,
  verifyNutzap,
} from "@reelstr/wallet";
import type { AdapterRegistry } from "./adapters";

export interface AgentOpts {
  signer: Signer;
  pool: RelayPool;
  relays: string[];
  adapters: AdapterRegistry;
  /** minimum bid the agent accepts, in sats */
  priceSats: number;
  /** uploads and normalizes clips; the agent's own identity signs with `signer` */
  client: ReelstrClient;
  /** holds the agent's earnings */
  wallet: CashuWallet;
  /** P2PK key nutzaps to this agent are locked to */
  lockPrivkey: string;
  lockPubkey: string;
  mints: string[];
  name?: string;
  /**
   * Take jobs for closed-weight models (Veo, Kling). Off by default: their scenes cannot be re-rendered by
   * a verifier, so they never earn Source Verified. The manifest says so honestly either way.
   */
  allowClosed?: boolean;
  onLog?: (line: string) => void;
}

export interface PaidJob {
  jobId: string;
  resultId: string;
  sats: number;
  at: number;
}

const rand = () => String(Math.floor(Math.random() * 2 ** 31));

/**
 * A scene-generating agent with its own keypair (NP-6). It takes jobs addressed to it, generates
 * with an open-weight adapter, and returns a signed Scene (not published) inside a job result.
 * It is paid only after the requester accepts: a nutzap naming the result (PY-4, no escrow).
 */
export class Agent {
  readonly paid: PaidJob[] = [];
  readonly results = new Map<string, NostrEvent>();
  private readonly inflight = new Set<string>();
  private readonly redeemed = new Set<string>();
  private subs: { close: () => void }[] = [];
  pubkey = "";

  constructor(private readonly o: AgentOpts) {}

  private log(s: string) {
    this.o.onLog?.(s);
  }

  /** Announce: bot profile (kind 0) and where to send nutzaps (kind 10019). */
  async announce() {
    this.pubkey = await this.o.signer.getPublicKey();
    const now = Math.floor(Date.now() / 1000);
    const profile = await this.o.signer.signEvent(
      buildAgentProfile({
        name: this.o.name ?? "reelstr-agent",
        about: "Generates Reelstr scenes from open-weight models on request",
        models: [...this.o.adapters.keys()],
        priceSats: this.o.priceSats,
        createdAt: now,
      }),
    );
    const info = await this.o.signer.signEvent(
      buildNutzapInfo({
        p2pk: this.o.lockPubkey,
        mints: this.o.mints,
        relays: this.o.relays,
        createdAt: now,
      }),
    );
    await this.o.pool.publish(profile, this.o.relays);
    await this.o.pool.publish(info, this.o.relays);
  }

  /** Start listening for jobs and payments. Also picks up jobs posted in the last `sinceSec` seconds. */
  async start(sinceSec = 60) {
    if (!this.pubkey) await this.announce();
    const since = Math.floor(Date.now() / 1000) - sinceSec;
    this.subs.push(
      this.o.pool.subscribe(
        this.o.relays,
        { kinds: [KIND.JOB_REQUEST], "#p": [this.pubkey], since },
        (e) => void this.onJob(e),
      ) as never,
      this.o.pool.subscribe(
        this.o.relays,
        { kinds: [KIND.NUTZAP], "#p": [this.pubkey], since },
        (e) => void this.onNutzap(e),
      ) as never,
    );
  }

  stop() {
    for (const s of this.subs) s.close();
    this.subs = [];
  }

  /** Why this job will not be taken, or null. Nothing is generated (or paid for) before this passes. */
  async refusal(e: NostrEvent, j: JobRequest): Promise<string | null> {
    const v = validateEvent(e, { verifySig: true });
    if (!v.ok) return `invalid request: ${v.errors.join("; ")}`;
    if (j.agent !== this.pubkey) return "job is not addressed to this agent";
    if (j.bidSats < this.o.priceSats)
      return `bid ${j.bidSats} sats is below this agent's price of ${this.o.priceSats}`;
    const a = this.o.adapters.get(j.model);
    if (!a)
      return `model ${j.model} is not offered here (have: ${[...this.o.adapters.keys()].join(", ")})`;
    if (!a.open && !this.o.allowClosed)
      return `model ${j.model} is closed-weight, so its scenes would not be re-renderable`;
    if (j.parentId) {
      const parent = await this.o.pool.get(this.o.relays, { ids: [j.parentId] });
      if (!parent) return "parent scene not found on the relays";
      if (!isForkable(parseScene(parent).license))
        return "parent scene's license does not allow forking";
    }
    return null;
  }

  async onJob(e: NostrEvent): Promise<"done" | "refused" | "skipped"> {
    if (this.inflight.has(e.id)) return "skipped";
    this.inflight.add(e.id);
    try {
      const existing = await this.o.pool.get(this.o.relays, {
        kinds: [KIND.JOB_RESULT],
        authors: [this.pubkey],
        "#e": [e.id],
      });
      if (existing) {
        this.results.set(e.id, existing);
        return "skipped"; // already answered (restart, or a relay replayed the request)
      }
      const j = parseJobRequest(e);
      const why = await this.refusal(e, j);
      if (why) {
        this.log(`refused ${e.id.slice(0, 8)}: ${why}`);
        await this.reply(e, j, "error", why);
        return "refused";
      }
      try {
        const adapter = this.o.adapters.get(j.model) as NonNullable<
          ReturnType<AdapterRegistry["get"]>
        >;
        const seed = j.seed ?? rand(); // a seed is always recorded, or the scene could never be re-rendered
        const bytes = await adapter.generate({
          prompt: j.prompt,
          seed,
          refs: j.refs,
          loras: j.loras,
          durationSec: j.durationSec,
        });
        const root = j.storyCoord.split(":");
        const { template } = await this.o.client.prepareScene({
          bytes,
          title: j.prompt.slice(0, 60),
          prompt: j.prompt,
          story: { pubkey: root[1] as string, d: root.slice(2).join(":") },
          parent: j.parentId ? { id: j.parentId } : undefined,
          license: j.license,
          gen: { model: { name: j.model, open: adapter.open }, seed, refs: j.refs, loras: j.loras },
          commissioner: { pubkey: j.requester },
        });
        const scene = await this.o.signer.signEvent(template);
        const res = await this.reply(e, j, "success", JSON.stringify(scene), scene.id);
        this.log(`delivered ${e.id.slice(0, 8)} as scene ${scene.id.slice(0, 8)}`);
        this.results.set(e.id, res);
        return "done";
      } catch (err) {
        await this.reply(e, j, "error", `generation failed: ${(err as Error).message}`);
        return "refused";
      }
    } finally {
      this.inflight.delete(e.id);
    }
  }

  private async reply(
    job: NostrEvent,
    j: JobRequest,
    status: "success" | "error",
    content: string,
    sceneId?: string,
  ) {
    const ev = await this.o.signer.signEvent(
      buildJobResult({ jobId: job.id, requester: j.requester, status, content, sceneId }),
    );
    await this.o.pool.publish(ev, this.o.relays);
    return ev;
  }

  /** A nutzap naming one of our results: check it, redeem it, record it. */
  async onNutzap(e: NostrEvent): Promise<"paid" | "ignored" | "rejected"> {
    const z = (() => {
      try {
        return parseNutzap(e);
      } catch {
        return null;
      }
    })();
    if (!z?.eventId || this.redeemed.has(e.id)) return "ignored";
    const result = await this.o.pool.get(this.o.relays, { ids: [z.eventId] });
    if (!result || result.kind !== KIND.JOB_RESULT || result.pubkey !== this.pubkey)
      return "ignored";
    const jobId = result.tags.find((t) => t[0] === "e" && t[3] === "request")?.[1] ?? "";
    const job = await this.o.pool.get(this.o.relays, { ids: [jobId] });
    if (!job) return "ignored";
    const j = parseJobRequest(job);
    if (e.pubkey !== j.requester) {
      this.log(`nutzap ${e.id.slice(0, 8)} is from ${e.pubkey.slice(0, 8)}, not the requester`);
      return "rejected";
    }
    if (this.paid.some((p) => p.resultId === result.id)) return "ignored"; // one payment per delivery
    try {
      await verifyNutzap(e, {
        recipient: this.pubkey,
        lockPubkey: this.o.lockPubkey,
        acceptedMints: this.o.mints,
        minSats: j.bidSats,
      });
      const got = await redeemNutzap(e, this.o.wallet, this.o.lockPrivkey);
      this.redeemed.add(e.id);
      this.paid.push({ jobId, resultId: result.id, sats: got, at: Math.floor(Date.now() / 1000) });
      this.log(`paid ${got} sats for ${jobId.slice(0, 8)}`);
      return "paid";
    } catch (err) {
      this.log(`nutzap rejected: ${(err as Error).message}`);
      return "rejected";
    }
  }
}
