import { afterAll, describe, expect, test } from "bun:test";
import { BlossomClient } from "@reelstr/blossom";
import { LocalSigner } from "@reelstr/nostr";
import { httpAuthHeader, httpAuthTemplate } from "@reelstr/protocol";
import { createMediaServer } from "../src/server";

const SOURCE = "http://blossom.test:3100";
const signer = LocalSigner.generate();
const hosts = { primary: new BlossomClient(SOURCE, signer), mirrors: [] };
process.env.PORT = "0";
let gate: (() => void) | null = null;
const fakeRun = {
  ingest: (async (src: { sha256: string }) => {
    if (src.sha256.startsWith("f")) throw new Error("boom");
    if (src.sha256.startsWith("e")) await new Promise<void>((r) => (gate = r)); // hold the queue open
    return { ok: true };
  }) as never,
  render: (async () => ({ masterSha256: "x" })) as never,
};
const mk = (o: Partial<Parameters<typeof createMediaServer>[0]> = {}) =>
  createMediaServer({ hosts, run: fakeRun, port: 0, ...o });
const srv = mk();
const base = `http://127.0.0.1:${srv.port}`;
afterAll(() => srv.stop(true));

async function call(
  s: LocalSigner,
  path: string,
  method = "GET",
  body?: unknown,
  at?: number,
  to = base,
) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const ev = await s.signEvent(
    httpAuthTemplate({ url: `${to}${path}`, method, body: text, createdAt: at }),
  );
  return fetch(`${to}${path}`, {
    method,
    headers: { Authorization: httpAuthHeader(ev), "Content-Type": "application/json" },
    body: text,
  });
}
const ing = (sha: string) => ({
  sha256: sha.padEnd(64, "a"),
  urls: [`${SOURCE}/${sha.padEnd(64, "a")}`],
});
async function poll(s: LocalSigner, id: string, to = base) {
  for (let i = 0; i < 100; i++) {
    const j = (await (await call(s, `/jobs/${id}`, "GET", undefined, undefined, to)).json()) as {
      status: string;
      error?: string;
    };
    if (j.status === "done" || j.status === "failed") return j;
    await Bun.sleep(20);
  }
  throw new Error("job did not finish");
}

describe("media server authentication (NIP-98)", () => {
  test("no signature, a stale one, a wrong-path one, and a forged one are all 401", async () => {
    expect((await fetch(`${base}/jobs/x`)).status).toBe(401);
    expect(
      (await fetch(`${base}/jobs/x`, { headers: { Authorization: "Bearer secret" } })).status,
    ).toBe(401);
    expect(
      (await call(signer, "/jobs/x", "GET", undefined, Math.floor(Date.now() / 1000) - 600)).status,
    ).toBe(401);
    const forPath = await signer.signEvent(
      httpAuthTemplate({ url: `${base}/other`, method: "GET" }),
    );
    expect(
      (await fetch(`${base}/jobs/x`, { headers: { Authorization: httpAuthHeader(forPath) } }))
        .status,
    ).toBe(401);
    const forged = { ...forPath, sig: "00".repeat(64) };
    expect(
      (await fetch(`${base}/other`, { headers: { Authorization: httpAuthHeader(forged) } })).status,
    ).toBe(401);
  });

  test("the signature is bound to the body: a captured header cannot carry a different job", async () => {
    const real = JSON.stringify(ing("1"));
    const ev = await signer.signEvent(
      httpAuthTemplate({ url: `${base}/ingest`, method: "POST", body: real }),
    );
    const swapped = await fetch(`${base}/ingest`, {
      method: "POST",
      headers: { Authorization: httpAuthHeader(ev) },
      body: JSON.stringify(ing("2")),
    });
    expect(swapped.status).toBe(401);
    const same = await fetch(`${base}/ingest`, {
      method: "POST",
      headers: { Authorization: httpAuthHeader(ev) },
      body: real,
    });
    expect(same.status).toBe(202);
    // a POST that carries a body but whose auth names no payload is refused too
    const noPayload = await signer.signEvent({
      ...httpAuthTemplate({ url: `${base}/ingest`, method: "POST" }),
      tags: [
        ["u", `${base}/ingest`],
        ["method", "POST"],
      ],
    });
    expect(
      (
        await fetch(`${base}/ingest`, {
          method: "POST",
          headers: { Authorization: httpAuthHeader(noPayload) },
          body: real,
        })
      ).status,
    ).toBe(401);
  });

  test("CORS preflight is answered without auth", async () => {
    const pre = await fetch(`${base}/ingest`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("jobs", () => {
  test("lifecycle, validation, and failures are reported", async () => {
    const ok = (await (await call(signer, "/ingest", "POST", ing("a"))).json()) as { id: string };
    expect((await poll(signer, ok.id)).status).toBe("done");
    const bad = (await (await call(signer, "/ingest", "POST", ing("f"))).json()) as { id: string };
    expect(await poll(signer, bad.id)).toMatchObject({ status: "failed", error: "boom" });
    expect((await call(signer, "/ingest", "POST", { sha256: "zz", urls: [] })).status).toBe(400);
    expect((await call(signer, "/render", "POST", { scenes: [] })).status).toBe(400);
    expect((await call(signer, "/jobs/nope")).status).toBe(404);
  });

  test("a job is visible only to its owner (someone else's looks missing)", async () => {
    const other = LocalSigner.generate();
    const j = (await (await call(signer, "/ingest", "POST", ing("b"))).json()) as { id: string };
    await poll(signer, j.id);
    expect((await call(other, `/jobs/${j.id}`)).status).toBe(404);
    expect((await call(signer, `/jobs/${j.id}`)).status).toBe(200);
  });

  test("source URLs must be on an allowed host: internal addresses and other schemes are refused (SSRF)", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://127.0.0.1:22/x",
      "file:///etc/passwd",
      "https://evil.example/x",
      "not a url",
    ]) {
      const r = await call(signer, "/ingest", "POST", {
        sha256: "a".repeat(64),
        urls: [`${SOURCE}/ok`, url],
      });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(
        /not an allowed source host|unsupported scheme|invalid url/,
      );
    }
    const render = await call(signer, "/render", "POST", {
      scenes: [{ sha256: "a".repeat(64), urls: ["http://10.0.0.5/x"], inSec: 0, outSec: 5 }],
    });
    expect(render.status).toBe(400);
    const bed = await call(signer, "/render", "POST", {
      scenes: [{ sha256: "a".repeat(64), urls: [`${SOURCE}/x`], inSec: 0, outSec: 5 }],
      audioBed: { sha256: "b".repeat(64), urls: ["http://10.0.0.5/x"] },
    });
    expect(bed.status).toBe(400);
  });

  test("oversized bodies and too many scenes are refused", async () => {
    const big = await call(signer, "/ingest", "POST", {
      sha256: "a".repeat(64),
      urls: [SOURCE],
      pad: "x".repeat(1_100_000),
    });
    expect(big.status).toBe(413);
    const many = await call(signer, "/render", "POST", {
      scenes: Array.from({ length: 41 }, () => ({
        sha256: "a".repeat(64),
        urls: [SOURCE],
        inSec: 0,
        outSec: 1,
      })),
    });
    expect(many.status).toBe(400);
  });
});

describe("who may use it, and how much", () => {
  test("an allowlist excludes other pubkeys with 403", async () => {
    const me = LocalSigner.generate();
    known.set(me, await me.getPublicKey());
    const s = mk({ allow: (pk) => pk === pubOf(me) });
    const to = `http://127.0.0.1:${s.port}`;
    expect((await call(me, "/ingest", "POST", ing("c"), undefined, to)).status).toBe(202);
    expect(
      (await call(LocalSigner.generate(), "/ingest", "POST", ing("d"), undefined, to)).status,
    ).toBe(403);
    s.stop(true);
  });

  test("per-pubkey hourly rate limit returns 429 and does not affect others", async () => {
    const s = mk({ maxJobsPerHour: 2 });
    const to = `http://127.0.0.1:${s.port}`;
    const a = LocalSigner.generate();
    expect((await call(a, "/ingest", "POST", ing("1"), undefined, to)).status).toBe(202);
    expect((await call(a, "/ingest", "POST", ing("2"), undefined, to)).status).toBe(202);
    const third = await call(a, "/ingest", "POST", ing("3"), undefined, to);
    expect(third.status).toBe(429);
    expect(
      (await call(LocalSigner.generate(), "/ingest", "POST", ing("4"), undefined, to)).status,
    ).toBe(202);
    s.stop(true);
  });

  test("a full queue returns 503 instead of piling up work", async () => {
    const s = mk({ maxQueued: 1 });
    const to = `http://127.0.0.1:${s.port}`;
    const u = LocalSigner.generate();
    const first = await call(u, "/ingest", "POST", ing("e"), undefined, to); // held open by the fake runner
    expect(first.status).toBe(202);
    const second = await call(LocalSigner.generate(), "/ingest", "POST", ing("5"), undefined, to);
    expect(second.status).toBe(503);
    gate?.();
    const { id } = (await first.json()) as { id: string };
    expect((await poll(u, id, to)).status).toBe("done");
    expect(
      (await call(LocalSigner.generate(), "/ingest", "POST", ing("6"), undefined, to)).status,
    ).toBe(202);
    s.stop(true);
  });
});

// LocalSigner exposes its pubkey asynchronously; allow() is synchronous, so resolve it once up front
const known = new Map<LocalSigner, string>();
const pubOf = (s: LocalSigner) => known.get(s) as string;
