import { afterAll, describe, expect, test } from "bun:test";
import { LocalSigner, Nip46Signer } from "@reelstr/nostr";
import { buildStory, validateEvent } from "@reelstr/protocol";
import { getPublicKey } from "nostr-tools/pure";
import { cleanup, startNakBunker, startRelay } from "../src";

// Our NIP-46 client against a bunker we did NOT write: fiatjaf's `nak bunker`. Skipped if nak is missing.
const relay = await startRelay();
const sk = new Uint8Array(32).fill(7);
const bunker = await startNakBunker({ relay: relay.url, secHex: Buffer.from(sk).toString("hex") });
afterAll(() => {
  bunker?.stop();
  cleanup();
});

describe.skipIf(!bunker)("NIP-46 against the real nak bunker", () => {
  test("connects, reports the user's key, and signs valid Reelstr events", async () => {
    const signer = await Nip46Signer.connect((bunker as NonNullable<typeof bunker>).uri);
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
    const ev = await signer.signEvent(
      buildStory({ d: "nak", title: "Signed by nak", logline: "x" }),
    );
    expect(ev.pubkey).toBe(getPublicKey(sk));
    expect(validateEvent(ev as never, { verifySig: true })).toMatchObject({ ok: true });
    await signer.close();
  }, 60_000);

  test("NIP-44 through the bunker interoperates with a local key", async () => {
    const signer = await Nip46Signer.connect((bunker as NonNullable<typeof bunker>).uri);
    const peer = LocalSigner.generate();
    const peerPk = await peer.getPublicKey();
    const ct = await signer.nip44Encrypt(peerPk, "hello from nak");
    expect(await peer.nip44Decrypt(await signer.getPublicKey(), ct)).toBe("hello from nak");
    const back = await peer.nip44Encrypt(await signer.getPublicKey(), "and back");
    expect(await signer.nip44Decrypt(peerPk, back)).toBe("and back");
    await signer.close();
  }, 60_000);
});
