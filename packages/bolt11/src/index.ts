import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";

export interface Invoice {
  network: string;
  /** whole sats; undefined for zero-amount invoices */
  sats?: number;
  /** exact amount in millisatoshis */
  msats?: number;
  timestamp: number;
  expirySec: number;
  paymentHash: string;
  description?: string;
  paymentSecret?: string;
  /** node pubkey recovered from the signature (33-byte compressed hex) */
  payee: string;
}

// msat per unit: 1 BTC = 1e11 msat; m = 1e-3 BTC = 1e8 msat, u = 1e5, n = 100, p = 0.1
const MSAT_PER: Record<string, number> = { m: 1e8, u: 1e5, n: 100, p: 0.1 };

const toWords = (bytes: Uint8Array) => bech32.toWords(bytes);
/** n as big-endian 5-bit words; fixed width when `len` is given, else as short as possible. */
const intWords = (n: number, len?: number) => {
  let width = len ?? 1;
  while (len === undefined && 32 ** width <= n) width++;
  const w: number[] = [];
  for (let i = width - 1; i >= 0; i--) w.push(Math.floor(n / 32 ** i) % 32);
  return w;
};
const wordsToInt = (w: number[]) => w.reduce((a, x) => a * 32 + x, 0);

/** sha256(hrp || 5-bit data zero-padded to bytes): the message every BOLT11 signature covers. */
function signingHash(hrp: string, dataWords: number[]): Uint8Array {
  const bits =
    dataWords.map((w) => w.toString(2).padStart(5, "0")).join("") +
    "0".repeat((8 - ((dataWords.length * 5) % 8)) % 8);
  const bytes = Uint8Array.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  return sha256(new Uint8Array([...new TextEncoder().encode(hrp), ...bytes]));
}

/** Decode a BOLT11 invoice (does not verify the signature; callers that need it must). */
export function decodeInvoice(invoice: string): Invoice {
  const { prefix, words } = bech32.decode(invoice.toLowerCase() as `${string}1${string}`, 2048);
  const m = prefix.match(/^ln(bc|tb|tbs|bcrt)(\d+)?([munp])?$/);
  if (!m) throw new Error("not a BOLT11 invoice");
  let msats: number | undefined;
  if (m[2]) {
    const n = Number(m[2]);
    msats = m[3] ? Math.round(n * (MSAT_PER[m[3]] as number)) : n * 1e11;
  }
  const out: Invoice = {
    network: m[1] as string,
    msats,
    sats: msats === undefined ? undefined : Math.floor(msats / 1000),
    timestamp: wordsToInt(words.slice(0, 7)),
    expirySec: 3600,
    paymentHash: "",
    payee: "",
  };
  let i = 7;
  const end = words.length - 104; // trailing 65-byte signature
  while (i < end) {
    const type = words[i] as number;
    const len = (words[i + 1] as number) * 32 + (words[i + 2] as number);
    const data = words.slice(i + 3, i + 3 + len);
    i += 3 + len;
    if (type === 1) out.paymentHash = bytesToHex(Uint8Array.from(bech32.fromWords(data)));
    else if (type === 13)
      out.description = new TextDecoder().decode(Uint8Array.from(bech32.fromWords(data)));
    else if (type === 6) out.expirySec = wordsToInt(data);
    else if (type === 16) out.paymentSecret = bytesToHex(Uint8Array.from(bech32.fromWords(data)));
  }
  if (!out.paymentHash) throw new Error("invoice has no payment hash");
  // signature: 64 bytes r||s then 1 byte recovery id. Recover the payee and require it to verify.
  const sigBytes = Uint8Array.from(bech32.fromWords(words.slice(end)));
  const sig = sigBytes.slice(0, 64);
  const recid = sigBytes[64] ?? 99;
  if (recid > 3) throw new Error("invalid recovery id in signature");
  const noble = new Uint8Array(65);
  noble[0] = recid;
  noble.set(sig, 1);
  try {
    out.payee = bytesToHex(
      secp256k1.recoverPublicKey(noble, signingHash(prefix, words.slice(0, end)), {
        prehash: false,
      }),
    );
  } catch {
    throw new Error("invoice signature does not recover to a public key");
  }
  return out;
}

/** Encode and sign an invoice. Used by test backends; real invoices come from a real node. */
export function encodeInvoice(o: {
  sats?: number;
  paymentHash: string;
  nodeKey: Uint8Array;
  description?: string;
  expirySec?: number;
  network?: string;
  timestamp?: number;
  paymentSecret?: string;
}): string {
  const network = o.network ?? "bc";
  const hrp = `ln${network}${o.sats === undefined ? "" : `${o.sats * 10}n`}`;
  const words: number[] = intWords(o.timestamp ?? Math.floor(Date.now() / 1000), 7);
  const tag = (type: number, data: number[]) =>
    words.push(type, Math.floor(data.length / 32), data.length % 32, ...data);
  tag(1, toWords(hexToBytes(o.paymentHash)));
  tag(16, toWords(hexToBytes(o.paymentSecret ?? o.paymentHash)));
  tag(13, toWords(new TextEncoder().encode(o.description ?? "reelstr")));
  tag(6, intWords(o.expirySec ?? 3600));
  const rec = secp256k1.sign(signingHash(hrp, words), o.nodeKey, {
    prehash: false,
    format: "recovered",
  });
  // noble returns recid || r || s; BOLT11 wants r || s || recid
  const sig = new Uint8Array(65);
  sig.set(rec.slice(1), 0);
  sig[64] = rec[0] as number;
  return bech32.encode(hrp, [...words, ...toWords(sig)], 2048);
}

export const paymentHashOf = (preimageHex: string) => bytesToHex(sha256(hexToBytes(preimageHex)));
