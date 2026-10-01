import { type NostrEvent, type Signer, withPow } from "@reelstr/nostr";
import { type EventLike, KIND, parseScene, validateEvent } from "@reelstr/protocol";
import type { VerifiedEvent } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";

const now = () => Math.floor(Date.now() / 1000);
/** the signer returns a signed event; nostr-tools wants it branded as verified */
const asVerified = (e: NostrEvent) => e as VerifiedEvent;

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  at: number;
}

/** A NIP-29 closed room on a crew relay (FE-12, NP-4). Connects with NIP-42 auth as the signer. */
export class CrewRoom {
  private relay: Relay | null = null;
  private constructor(
    readonly url: string,
    readonly groupId: string,
    private readonly signer: Signer,
  ) {}

  static async join(url: string, groupId: string, signer: Signer): Promise<CrewRoom> {
    const room = new CrewRoom(url, groupId, signer);
    await room.connect();
    return room;
  }

  private async connect() {
    const r = await Relay.connect(this.url);
    // NIP-42: answer the relay's challenge whenever it arrives, and nostr-tools retries the request
    r.onauth = async (evt) => asVerified(await this.signer.signEvent(evt));
    this.relay = r;
  }

  private rel(): Relay {
    if (!this.relay) throw new Error("not connected");
    return this.relay;
  }

  private async send(kind: number, tags: string[][], content = ""): Promise<NostrEvent> {
    const ev = await this.signer.signEvent({
      kind,
      created_at: now(),
      tags: [["h", this.groupId], ...tags],
      content,
    });
    await this.rel().publish(ev);
    return ev;
  }

  /** Create the room; the creator becomes its admin. */
  create(name: string) {
    return this.send(9007, []).then(async (ev) => {
      await this.send(9002, [["name", name], ["private"], ["closed"]]);
      return ev;
    });
  }
  /** Admin: add a person to the crew. */
  invite(pubkey: string) {
    return this.send(9000, [["p", pubkey, "member"]]);
  }
  remove(pubkey: string) {
    return this.send(9001, [["p", pubkey]]);
  }
  /** Ask to join (admins or an invite code decide). */
  requestJoin() {
    return this.send(9021, []);
  }
  say(text: string) {
    return this.send(9, [], text);
  }

  /** Publish a draft scene into the room only. The `h` tag keeps it inside the group. */
  async postDraft(template: {
    kind: number;
    tags: string[][];
    content: string;
  }): Promise<NostrEvent> {
    if (template.kind !== KIND.SCENE)
      throw new Error("only Scene drafts can be posted to a crew room");
    return this.send(
      template.kind,
      template.tags.filter((t) => t[0] !== "h"),
      template.content,
    );
  }

  /** Run a REQ. A private room answers "auth-required" until we prove who we are (NIP-42), so answer and retry once. */
  private async fetch(filter: Record<string, unknown>, retried = false): Promise<NostrEvent[]> {
    const out: NostrEvent[] = [];
    const closedWith = await new Promise<string | null>((resolve) => {
      const done = setTimeout(() => resolve(null), 5000);
      const sub = this.rel().subscribe([{ ...filter, "#h": [this.groupId] } as never], {
        onevent: (e) => out.push(e),
        oneose: () => {
          clearTimeout(done);
          sub.close();
          resolve(null);
        },
        onclose: (reason) => {
          clearTimeout(done);
          resolve(reason ?? null);
        },
      });
    });
    if (closedWith?.startsWith("auth-required") && !retried) {
      await this.rel().auth(async (evt) => asVerified(await this.signer.signEvent(evt)));
      return this.fetch(filter, true);
    }
    if (closedWith && !closedWith.startsWith("auth-required") && out.length === 0) return [];
    return out;
  }

  async messages(): Promise<ChatMessage[]> {
    return (await this.fetch({ kinds: [9] }))
      .map((e) => ({ id: e.id, from: e.pubkey, text: e.content, at: e.created_at }))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }
  async drafts(): Promise<NostrEvent[]> {
    return (await this.fetch({ kinds: [KIND.SCENE] })).sort((a, b) => a.created_at - b.created_at);
  }

  /** Live chat and draft notifications. */
  watch(onEvent: (e: NostrEvent) => void) {
    const sub = this.rel().subscribe(
      [{ kinds: [9, KIND.SCENE], "#h": [this.groupId], since: now() - 1 } as never],
      { onevent: onEvent },
    );
    return () => sub.close();
  }

  close() {
    this.relay?.close();
  }
}

/**
 * Release a draft: re-sign it without the `h` tag and publish to the public relays. The blobs are
 * already content-addressed, so the released scene is the same clip with a new event id. The draft
 * is validated first, so a broken draft never reaches a public relay.
 */
export async function releaseDraft(
  draft: EventLike & { id: string },
  o: {
    signer: Signer;
    publish: (ev: NostrEvent) => Promise<unknown>;
    /** override the parent, e.g. when an earlier draft was itself released under a new id */
    parentId?: string;
    /**
     * NIP-13 bits the public relays require. Release signs a NEW event (new id), so any proof of
     * work mined into the draft no longer counts and must be redone for the released copy.
     */
    powBits?: number;
  },
): Promise<NostrEvent> {
  const who = await o.signer.getPublicKey();
  if (draft.pubkey !== who) throw new Error("only the author can release their own draft");
  const tags = draft.tags
    .filter((t) => t[0] !== "h" && t[0] !== "nonce") // the old nonce is meaningless for the new id
    .map((t) =>
      o.parentId && t[0] === "e" && t[3] === "parent" ? ["e", o.parentId, t[2] ?? "", "parent"] : t,
    );
  const tpl = { kind: draft.kind, created_at: now(), tags, content: draft.content };
  const ev = await o.signer.signEvent(o.powBits ? await withPow(tpl, o.powBits, who) : tpl);
  const v = validateEvent(ev, { verifySig: true });
  if (!v.ok) throw new Error(`draft is not publishable: ${v.errors.join("; ")}`);
  parseScene(ev); // throws if it is not a well-formed scene
  await o.publish(ev);
  return ev;
}
