import { afterAll, describe, expect, test } from "bun:test";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildScene, KIND, validateEvent } from "@reelstr/protocol";
import { cleanup, startCrewRelay, startRelay } from "@reelstr/testkit";
import { CrewRoom, releaseDraft } from "../src";

const crew = await startCrewRelay();
const pub = await startRelay();
const pool = new RelayPool();
afterAll(() => {
  pool.close([pub.url]);
  cleanup();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const draftTemplate = (author: string, n: string) =>
  buildScene({
    title: n,
    content: `draft ${n}`,
    video: {
      url: `https://x/${n}.mp4`,
      sha256: n
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, "a"),
      duration: 12,
    },
    story: { pubkey: author, d: "s" },
  });

describe("crew rooms (NP-4, FE-12)", () => {
  test("drafts stay in the room; members see them and chat; outsiders see nothing; release publishes publicly", async () => {
    const alice = LocalSigner.generate();
    const bob = LocalSigner.generate();
    const eve = LocalSigner.generate();
    const [pa, pb] = [await alice.getPublicKey(), await bob.getPublicKey()];
    const group = `room${Math.floor(Math.random() * 1e9)}`;

    const a = await CrewRoom.join(crew.url, group, alice);
    await a.create("Heist crew");
    await a.invite(pb);
    await a.say("welcome to the crew room");
    const draft = await a.postDraft(draftTemplate(pa, "a"));
    await sleep(300);

    // a member reads chat and drafts, and can write too
    const b = await CrewRoom.join(crew.url, group, bob);
    expect((await b.messages()).map((m) => m.text)).toEqual(["welcome to the crew room"]);
    expect((await b.drafts()).map((d) => d.id)).toEqual([draft.id]);
    await b.say("on it");
    // messages in the same second have no defined order on Nostr (sorted by id), so compare as a set
    expect((await a.messages()).map((m) => `${m.from}:${m.text}`).sort()).toEqual(
      [`${pa}:welcome to the crew room`, `${pb}:on it`].sort(),
    );

    // an outsider cannot post or read
    const e = await CrewRoom.join(crew.url, group, eve);
    await expect(e.say("let me in")).rejects.toThrow();
    expect(await e.drafts()).toEqual([]);
    expect(await e.messages()).toEqual([]);

    // nothing leaked to the public relay
    expect(await pool.query([pub.url], { kinds: [KIND.SCENE] })).toEqual([]);

    // release: the author re-signs without the room tag and publishes publicly
    const released = await releaseDraft(draft as never, {
      signer: alice,
      publish: (ev) => pool.publish(ev, [pub.url]),
    });
    expect(released.id).not.toBe(draft.id);
    expect(released.tags.some((t) => t[0] === "h")).toBe(false);
    expect(validateEvent(released, { verifySig: true }).ok).toBe(true);
    expect((await pool.query([pub.url], { kinds: [KIND.SCENE] })).map((x) => x.id)).toEqual([
      released.id,
    ]);
    // the room keeps its draft; released content is the same clip
    expect((await a.drafts()).length).toBe(1);

    // only the author may release
    await expect(
      releaseDraft(draft as never, { signer: bob, publish: async () => {} }),
    ).rejects.toThrow(/only the author/);
    a.close();
    b.close();
    e.close();
  }, 60_000);

  test("a broken draft is refused before it reaches a public relay; non-scene events cannot be drafts", async () => {
    const alice = LocalSigner.generate();
    const pa = await alice.getPublicKey();
    const tpl = draftTemplate(pa, "b");
    tpl.tags = tpl.tags.filter((t) => t[0] !== "license");
    const bad = await alice.signEvent({ ...tpl, created_at: Math.floor(Date.now() / 1000) });
    let published = 0;
    await expect(
      releaseDraft(bad as never, { signer: alice, publish: async () => void published++ }),
    ).rejects.toThrow(/not publishable/);
    expect(published).toBe(0);
    const room = await CrewRoom.join(crew.url, `r${Math.floor(Math.random() * 1e9)}`, alice);
    await expect(room.postDraft({ kind: 1, tags: [], content: "x" })).rejects.toThrow(
      /only Scene drafts/,
    );
    room.close();
  }, 30_000);
});
