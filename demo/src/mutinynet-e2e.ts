import { readFileSync } from "node:fs";
import { LndBackend } from "../../services/keys/src/ln";

/**
 * The key server's real Lightning backend (LndBackend) against two real LND nodes of ours on Mutinynet:
 * A creates invoices, B pays them over a real channel, A sees them settle.
 *   Needs ssh tunnels to the VM (see infra/mutinynet/README.md): 18081 -> A, 18082 -> B, plus
 *   A_MAC / B_MAC (admin macaroon, hex) and A_CA / B_CA (each node has its own tls.cert). Valueless signet coins.
 *   bun demo/src/mutinynet-e2e.ts [payments=5] [sats=21]
 */
const A = {
  url: "https://localhost:18081",
  mac: process.env.A_MAC ?? "",
  ca: readFileSync(process.env.A_CA ?? "A.cert", "utf8"),
};
const B = {
  url: "https://localhost:18082",
  mac: process.env.B_MAC ?? "",
  ca: readFileSync(process.env.B_CA ?? "B.cert", "utf8"),
};
if (!A.mac || !B.mac) throw new Error("set A_MAC and B_MAC (hex macaroons)");
const n = Number(process.argv[2] ?? 5);
const sats = Number(process.argv[3] ?? 21);

// LND answers with loosely typed JSON; the checks below read only the fields they need
// biome-ignore lint/suspicious/noExplicitAny: LND REST JSON
type Rest = Record<string, any>;
const call = async (node: typeof A, path: string, body?: unknown) => {
  const r = await fetch(node.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Grpc-Metadata-macaroon": node.mac, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    tls: { ca: node.ca },
  } as RequestInit);
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 160)}`);
  return JSON.parse(t) as Rest;
};
const wait = async (what: string, f: () => Promise<boolean>, ms = 600_000) => {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`ok: ${what} (${Math.round((Date.now() - t0) / 1000)} s)`);
};

const ia = await call(A, "/v1/getinfo");
const ib = await call(B, "/v1/getinfo");
console.log(
  `A ${ia.identity_pubkey.slice(0, 12)} height ${ia.block_height} synced ${ia.synced_to_chain}`,
);
console.log(
  `B ${ib.identity_pubkey.slice(0, 12)} height ${ib.block_height} synced ${ib.synced_to_chain}`,
);
if (!ia.synced_to_chain || !ib.synced_to_chain) throw new Error("nodes are still syncing");

// 1. a channel A -> B (B gets some balance up front so it can pay), unless one is already open
const open = async () =>
  (await call(A, "/v1/channels")).channels?.some(
    (c: Rest) => c.remote_pubkey === ib.identity_pubkey && c.active,
  );
if (!(await open())) {
  await call(B, "/v1/peers", {
    addr: { pubkey: ia.identity_pubkey, host: "reelstr-lnd:9735" },
  }).catch((e) => {
    if (!/already connected/.test(String(e))) throw e;
  });
  await wait(
    "on-chain funds on A",
    async () => Number((await call(A, "/v1/balance/blockchain")).confirmed_balance) >= 250_000,
    1_800_000,
  );
  await call(A, "/v1/channels", {
    node_pubkey: Buffer.from(ib.identity_pubkey, "hex").toString("base64"),
    local_funding_amount: "200000",
    push_sat: "100000",
    sat_per_vbyte: "2",
  });
  await wait("channel A-B active", open);
}

// 2. the product's backend, both ends: A invoices, B pays, A sees it settle
const a = new LndBackend(A.url, A.mac, A.ca);
const b = new LndBackend(B.url, B.mac, B.ca);
const times: number[] = [];
for (let i = 1; i <= n; i++) {
  const inv = await a.createInvoice({ sats, description: `reelstr e2e ${i}` });
  if (await a.isPaid(inv.paymentHash)) throw new Error("invoice paid before payment");
  const t0 = performance.now();
  const { preimage } = await b.payInvoice(inv.invoice);
  const dt = performance.now() - t0;
  const paid = await a.isPaid(inv.paymentHash);
  if (!paid) throw new Error(`payment ${i} did not settle on A`);
  times.push(dt);
  console.log(
    `payment ${i}: ${Math.round(dt)} ms, preimage ${preimage.slice(0, 8)}…, settled on A`,
  );
}
console.log(
  `ok: ${n} real Lightning payments through LndBackend, median ${Math.round([...times].sort((x, y) => x - y)[Math.floor(n / 2)] as number)} ms`,
);
