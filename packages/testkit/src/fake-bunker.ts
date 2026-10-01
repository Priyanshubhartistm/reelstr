import { bytesToHex } from "@noble/hashes/utils.js";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import type { EventTemplate } from "@reelstr/protocol";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

/**
 * A minimal NIP-46 remote signer for tests. The user key lives here, never in the page.
 * Methods: connect, get_public_key, sign_event, ping, nip44_encrypt, nip44_decrypt.
 * Only a client that proves the connect secret gets answers.
 */
export async function startBunker(o: { relay: string; userKey?: Uint8Array; secret?: string }) {
  const userKey = o.userKey ?? generateSecretKey();
  const user = new LocalSigner(userKey);
  const bunkerKey = generateSecretKey();
  const bunker = new LocalSigner(bunkerKey);
  const bunkerPub = getPublicKey(bunkerKey);
  const secret = o.secret ?? bytesToHex(generateSecretKey()).slice(0, 16);
  const pool = new RelayPool();
  const authorized = new Set<string>();
  const calls: { method: string; from: string }[] = [];

  const reply = async (to: string, id: string, result: string, error?: string) => {
    const ev = await bunker.signEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", to]],
      content: await bunker.nip44Encrypt(
        to,
        JSON.stringify({ id, result, ...(error ? { error } : {}) }),
      ),
    });
    await pool.publish(ev, [o.relay]);
  };

  const sub = pool.subscribe(
    [o.relay],
    { kinds: [24133], "#p": [bunkerPub], since: Math.floor(Date.now() / 1000) - 5 },
    async (e) => {
      try {
        const req = JSON.parse(await bunker.nip44Decrypt(e.pubkey, e.content)) as {
          id: string;
          method: string;
          params: string[];
        };
        calls.push({ method: req.method, from: e.pubkey });
        if (req.method === "connect") {
          if (req.params[1] !== secret) return await reply(e.pubkey, req.id, "", "invalid secret");
          authorized.add(e.pubkey);
          return await reply(e.pubkey, req.id, "ack");
        }
        if (!authorized.has(e.pubkey)) return await reply(e.pubkey, req.id, "", "not connected");
        switch (req.method) {
          case "ping":
            return await reply(e.pubkey, req.id, "pong");
          case "get_public_key":
            return await reply(e.pubkey, req.id, await user.getPublicKey());
          case "sign_event": {
            const t = JSON.parse(req.params[0] as string) as EventTemplate;
            return await reply(e.pubkey, req.id, JSON.stringify(await user.signEvent(t)));
          }
          case "nip44_encrypt":
            return await reply(
              e.pubkey,
              req.id,
              await user.nip44Encrypt(req.params[0] as string, req.params[1] as string),
            );
          case "nip44_decrypt":
            return await reply(
              e.pubkey,
              req.id,
              await user.nip44Decrypt(req.params[0] as string, req.params[1] as string),
            );
          default:
            return await reply(e.pubkey, req.id, "", `unsupported method ${req.method}`);
        }
      } catch {}
    },
  );
  await new Promise((r) => setTimeout(r, 300));

  return {
    uri: `bunker://${bunkerPub}?relay=${encodeURIComponent(o.relay)}&secret=${secret}`,
    userPubkey: await user.getPublicKey(),
    userSigner: user,
    calls,
    stop: () => {
      sub.close();
      pool.close([o.relay]);
    },
  };
}
