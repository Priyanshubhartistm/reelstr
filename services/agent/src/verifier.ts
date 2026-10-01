import type { RelayPool, Signer } from "@reelstr/nostr";
import {
  KIND,
  manifestEligibleForVerification,
  parseScene,
  validateEvent,
} from "@reelstr/protocol";
import type { AdapterRegistry } from "./adapters";
import { verificationTemplate, verifyScene } from "./verify";

/**
 * Follows relays for scenes with a re-renderable manifest, runs `verifyScene`, and publishes the
 * signed NIP-32 verdict. Clients decide which verifiers to trust; this one only reports.
 * ponytail: sequential queue, one scene at a time; add a worker pool if the scene rate needs it.
 */
export class Verifier {
  private subs: { close: () => void }[] = [];
  private seen = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private o: {
      signer: Signer;
      pool: RelayPool;
      relays: string[];
      adapters: AdapterRegistry;
      threshold?: number;
      onLog?: (l: string) => void;
    },
  ) {}

  start(sinceSec = 3600) {
    const since = Math.floor(Date.now() / 1000) - sinceSec;
    this.subs.push(
      this.o.pool.subscribe(this.o.relays, { kinds: [KIND.SCENE], since }, (e) =>
        this.enqueue(e),
      ) as never,
    );
  }

  stop() {
    for (const s of this.subs) s.close();
  }

  /** Resolves when everything queued so far has been verified and published. */
  idle() {
    return this.queue;
  }

  enqueue(scene: Parameters<typeof parseScene>[0] & { id: string }) {
    if (this.seen.has(scene.id)) return;
    this.seen.add(scene.id);
    // ineligible scenes get no label: silence is the honest answer for "not checkable"
    if (!validateEvent(scene as never, { verifySig: true }).ok) return;
    if (!manifestEligibleForVerification(scene)) return;
    this.queue = this.queue.then(() => this.verify(scene)).catch(() => {});
  }

  private async verify(scene: Parameters<typeof parseScene>[0] & { id: string }) {
    const r = await verifyScene(scene, { adapters: this.o.adapters, threshold: this.o.threshold });
    if (r.verdict === "error") return void this.o.onLog?.(`verify ${scene.id}: ${r.reason}`);
    if (r.verdict === "ineligible") return;
    const ev = await this.o.signer.signEvent(
      verificationTemplate({ id: scene.id, videoSha: parseScene(scene).videoSha }, r),
    );
    await this.o.pool.publish(ev, this.o.relays);
    this.o.onLog?.(`verified ${scene.id}: ${r.verdict} (${r.reason})`);
  }
}
