import { afterAll, describe, expect, test } from "bun:test";
import { Nip46Signer } from "@reelstr/nostr";
import { cleanup, startBunker, startRelay } from "@reelstr/testkit";
import { verifyEvent } from "nostr-tools/pure";

const relay = await startRelay();
afterAll(cleanup);

describe("NIP-46 remote signer (FE-1)", () => {
  test("connect with the secret, learn the user's key, sign an event the user key verifies, nip44 round trip", async () => {
    const b = await startBunker({ relay: relay.url });
    const s = await Nip46Signer.connect(b.uri);
    expect(await s.getPublicKey()).toBe(b.userPubkey);
    const ev = await s.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hi",
    });
    expect(ev.pubkey).toBe(b.userPubkey);
    expect(verifyEvent(ev)).toBe(true);
    const peer = await b.userSigner.getPublicKey();
    expect(await s.nip44Decrypt(peer, await s.nip44Encrypt(peer, "secret"))).toBe("secret");
    expect(b.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining([
        "connect",
        "get_public_key",
        "sign_event",
        "nip44_encrypt",
        "nip44_decrypt",
      ]),
    );
    await s.close?.();
    b.stop();
  }, 60_000);

  test("a wrong secret is refused and nothing is signed", async () => {
    const b = await startBunker({ relay: relay.url, secret: "right-secret" });
    const bad = b.uri.replace("right-secret", "wrong-secret");
    await expect(Nip46Signer.connect(bad)).rejects.toThrow();
    expect(b.calls.some((c) => c.method === "sign_event")).toBe(false);
    b.stop();
  }, 60_000);
});
