import type { RelayPool, Signer } from "@reelstr/nostr";
import type { ProofStore, WireProof } from "./cashu";

export const WALLET_KIND = 17375;
export const TOKEN_KIND = 7375;
export const HISTORY_KIND = 7376;

const now = () => Math.floor(Date.now() / 1000);

/**
 * NIP-60: the wallet lives on relays as self-encrypted events, so balance and history follow the
 * user across devices (FE-9). Token events hold a full proof set; a new one lists the ids it
 * replaces in `del` and a NIP-09 deletion is sent for them.
 */
export class Nip60Store implements ProofStore {
  private known: string[] = [];
  constructor(
    private readonly pool: RelayPool,
    private readonly relays: string[],
    private readonly signer: Signer,
    readonly mintUrl: string,
  ) {}

  private async enc(v: unknown) {
    return this.signer.nip44Encrypt(await this.signer.getPublicKey(), JSON.stringify(v));
  }
  private async dec<T>(c: string): Promise<T> {
    return JSON.parse(await this.signer.nip44Decrypt(await this.signer.getPublicKey(), c)) as T;
  }

  async load(): Promise<WireProof[]> {
    const me = await this.signer.getPublicKey();
    const events = await this.pool.query(this.relays, { kinds: [TOKEN_KIND], authors: [me] });
    const parsed: { id: string; mint: string; proofs: WireProof[]; del: string[]; at: number }[] =
      [];
    for (const e of events) {
      try {
        const c = await this.dec<{ mint: string; proofs: WireProof[]; del?: string[] }>(e.content);
        parsed.push({
          id: e.id,
          mint: c.mint,
          proofs: c.proofs,
          del: c.del ?? [],
          at: e.created_at,
        });
      } catch {}
    }
    const replaced = new Set(parsed.flatMap((p) => p.del));
    const live = parsed.filter((p) => !replaced.has(p.id) && p.mint === this.mintUrl);
    this.known = live.map((p) => p.id);
    const seen = new Map<string, WireProof>();
    for (const p of live.sort((a, b) => a.at - b.at))
      for (const pr of p.proofs) seen.set(pr.secret, pr);
    return [...seen.values()];
  }

  async save(proofs: WireProof[]): Promise<void> {
    const old = this.known;
    const ev = await this.signer.signEvent({
      kind: TOKEN_KIND,
      created_at: now(),
      tags: [],
      content: await this.enc({ mint: this.mintUrl, unit: "sat", proofs, del: old }),
    });
    await this.pool.publish(ev, this.relays);
    this.known = [ev.id];
    if (old.length) {
      const del = await this.signer.signEvent({
        kind: 5,
        created_at: now(),
        tags: [...old.map((i) => ["e", i]), ["k", String(TOKEN_KIND)]],
        content: "spent",
      });
      await this.pool.publish(del, this.relays).catch(() => {});
    }
  }

  /** Wallet settings: the mint list and the P2PK key nutzaps to this user are locked to. */
  async saveMeta(meta: { privkey: string; mints: string[] }) {
    const ev = await this.signer.signEvent({
      kind: WALLET_KIND,
      created_at: now(),
      tags: [],
      content: await this.enc([["privkey", meta.privkey], ...meta.mints.map((m) => ["mint", m])]),
    });
    await this.pool.publish(ev, this.relays);
  }
  async loadMeta(): Promise<{ privkey: string; mints: string[] } | null> {
    const [e] = (
      await this.pool.query(this.relays, {
        kinds: [WALLET_KIND],
        authors: [await this.signer.getPublicKey()],
      })
    ).sort((a, b) => b.created_at - a.created_at);
    if (!e) return null;
    const rows = await this.dec<string[][]>(e.content);
    return {
      privkey: rows.find((r) => r[0] === "privkey")?.[1] ?? "",
      mints: rows.filter((r) => r[0] === "mint").map((r) => r[1] as string),
    };
  }

  async record(direction: "in" | "out", sats: number, note = "") {
    const ev = await this.signer.signEvent({
      kind: HISTORY_KIND,
      created_at: now(),
      tags: [],
      content: await this.enc([
        ["direction", direction],
        ["amount", String(sats)],
        ["note", note],
      ]),
    });
    await this.pool.publish(ev, this.relays);
  }
  async history(): Promise<{ direction: string; sats: number; note: string; at: number }[]> {
    const events = await this.pool.query(this.relays, {
      kinds: [HISTORY_KIND],
      authors: [await this.signer.getPublicKey()],
    });
    const out = [];
    for (const e of events) {
      try {
        const rows = await this.dec<string[][]>(e.content);
        out.push({
          direction: rows.find((r) => r[0] === "direction")?.[1] ?? "",
          sats: Number(rows.find((r) => r[0] === "amount")?.[1]),
          note: rows.find((r) => r[0] === "note")?.[1] ?? "",
          at: e.created_at,
        });
      } catch {}
    }
    return out.sort((a, b) => b.at - a.at);
  }
}
