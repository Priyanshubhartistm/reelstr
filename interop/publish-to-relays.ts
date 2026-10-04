import { readFileSync, writeFileSync } from "node:fs";
import { bytesToHex } from "@noble/hashes/utils.js";
import { BlossomClient } from "@reelstr/blossom";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildScene, parseImeta } from "@reelstr/protocol";

/**
 * Publish ONE clearly labelled Reelstr scene (a NIP-71 kind 34236 video event) with a throwaway key to
 * public relays, then read it back from each, to see whether other software accepts and serves it.
 *   bun interop/publish-to-relays.ts <relay> [<relay>...]
 * The video is an existing demo clip on our own Blossom. THUMB=path.jpg uploads a poster frame and adds it. The key is written to ./interop-key.txt.
 */
const OURS = process.env.OURS ?? "wss://4-194-209-138.sslip.io/reelstr/relay";
const targets = process.argv.slice(2);
if (!targets.length) throw new Error("give at least one relay url");
const pool = new RelayPool();

const src = (await pool.query([OURS], { kinds: [34236], limit: 1 }))[0];
if (!src) throw new Error("no scene on our relay to borrow a video from");
const im = src.tags
  .filter((t) => t[0] === "imeta")
  .map((t) => parseImeta(t))
  .find((m) => m.m === "video/mp4");
if (!im?.url || !im.x) throw new Error("source scene has no video imeta");

const sk = crypto.getRandomValues(new Uint8Array(32));
writeFileSync("interop-key.txt", bytesToHex(sk));
const signer = new LocalSigner(sk);
const pk = await signer.getPublicKey();
let thumbnail: string | undefined;
if (process.env.THUMB) {
  const blossom = new BlossomClient(
    new URL("blossom", `${OURS.replace(/^ws/, "http").replace(/\/relay$/, "")}/`).href,
    signer,
  );
  thumbnail = (await blossom.upload(readFileSync(process.env.THUMB), "image/jpeg")).url;
  console.log(`thumbnail ${thumbnail}`);
}
const tpl = buildScene({
  title: "Reelstr interop test (safe to ignore)",
  content:
    "A test event from the Reelstr project (open-source serialized video on Nostr). Safe to ignore or delete.",
  video: { url: im.url, sha256: im.x, duration: Number(im.duration ?? 12), thumbnail },
  story: { pubkey: pk, d: "interop-test" },
});
const ev = await signer.signEvent(tpl);
console.log(`event ${ev.id} kind ${ev.kind} by ${pk}`);
console.log(`video ${im.url}`);

for (const relay of targets) {
  let verdict: string;
  try {
    await pool.publish(ev, [relay], 1);
    const back = await pool.query([relay], { ids: [ev.id] });
    verdict = back.length ? "accepted and served back" : "accepted but NOT served back";
  } catch (e) {
    verdict = `refused: ${String((e as Error).message).slice(0, 140)}`;
  }
  console.log(`${relay}: ${verdict}`);
}
pool.close(targets);
