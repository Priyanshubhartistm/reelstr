import { describe, expect, test } from "bun:test";
import * as nip19 from "nostr-tools/nip19";
import { LocalSigner, parsePubkey } from "../src";

describe("parsePubkey", () => {
  test("hex, uppercase hex and npub give the same key; junk gives null", async () => {
    const hex = await LocalSigner.generate().getPublicKey();
    expect(parsePubkey(hex)).toBe(hex);
    expect(parsePubkey(` ${hex.toUpperCase()} `)).toBe(hex);
    expect(parsePubkey(nip19.npubEncode(hex))).toBe(hex);
    expect(parsePubkey("nsec1qqqq")).toBeNull();
    expect(parsePubkey(nip19.nsecEncode(new Uint8Array(32).fill(1)))).toBeNull();
    expect(parsePubkey("hello")).toBeNull();
    expect(parsePubkey("")).toBeNull();
  });
});
