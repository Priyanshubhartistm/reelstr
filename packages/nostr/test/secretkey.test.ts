import { describe, expect, test } from "bun:test";
import * as nip19 from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { LocalSigner, parseSecretKey } from "../src";

const sk = generateSecretKey();
const nsec = nip19.nsecEncode(sk);
const hex = Buffer.from(sk).toString("hex");
const pk = getPublicKey(sk);

describe("parseSecretKey", () => {
  test("accepts nsec, hex, and what people really paste", async () => {
    for (const v of [
      nsec,
      hex,
      hex.toUpperCase(),
      ` ${nsec}\n`,
      `"${nsec}"`,
      `nostr:${nsec}`,
      nsec.replace(/^(.{40})/, "$1\n"),
      nsec.toUpperCase(),
    ])
      expect(await parseSecretKey(v).getPublicKey()).toBe(pk);
    expect(parseSecretKey(nsec)).toBeInstanceOf(LocalSigner);
  });

  test("says what is wrong, in words", () => {
    expect(() => parseSecretKey("")).toThrow(/Paste your secret key/);
    expect(() => parseSecretKey(nip19.npubEncode(pk))).toThrow(/public key \(npub\)/);
    expect(() => parseSecretKey(nsec.slice(0, 33))).toThrow(
      /33 characters and a secret key has 63/,
    );
    expect(() => parseSecretKey(`${nsec.slice(0, 20)}x${nsec.slice(21)}`)).toThrow(/not valid/);
    expect(() => parseSecretKey("hello world this is not a key")).toThrow(
      /does not look like a secret key/,
    );
  });
});
