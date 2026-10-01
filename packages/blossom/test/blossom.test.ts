import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSigner } from "@reelstr/nostr";
import { sha256Hex } from "@reelstr/protocol";
import { authHeader, BlossomClient, fetchVerified, uploadAndMirror } from "../src";

/** Ask the OS for a free port rather than guessing a range (testkit can't be imported here: it depends on this package). */
const freePort = (): number => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port as number;
  s.stop(true);
  return port;
};

const INFRA = join(import.meta.dir, "../../../infra/blossom");
const procs: Bun.Subprocess[] = [];
const dirs: string[] = [];

async function startBlossom(port: number) {
  const data = mkdtempSync(join(tmpdir(), "reelstr-blossom-"));
  dirs.push(data);
  procs.push(
    Bun.spawn(["sh", join(INFRA, "run.sh")], {
      env: { ...process.env, PORT: String(port), BLOSSOM_DATA: data },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).status < 500) return url;
    } catch {}
    await Bun.sleep(150);
  }
  throw new Error(`blossom on ${port} did not start`);
}

const P = freePort();
const signer = LocalSigner.generate();
let A: BlossomClient;
let B: BlossomClient;
const bytes = new TextEncoder().encode(`reelstr test blob ${Math.random()}`);
const sha = sha256Hex(bytes);

beforeAll(async () => {
  A = new BlossomClient(await startBlossom(P), signer);
  B = new BlossomClient(await startBlossom(freePort()), signer);
}, 60_000);

afterAll(() => {
  for (const p of procs) p.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("blossom client (BUD-01/02/04/11)", () => {
  test("upload returns a descriptor whose hash matches and the blob is fetchable", async () => {
    const d = await A.upload(bytes, "video/mp4");
    expect(d.sha256).toBe(sha);
    expect(await A.has(sha)).toBe(true);
    const got = await fetchVerified([A.urlFor(sha)], sha);
    expect(got.bytes).toEqual(bytes);
    expect((await A.list(await signer.getPublicKey())).some((x) => x.sha256 === sha)).toBe(true);
  });

  test("mirror copies a blob to a second server (BE-8)", async () => {
    expect(await B.has(sha)).toBe(false);
    const d = await B.mirror(A.urlFor(sha), sha);
    expect(d.sha256).toBe(sha);
    expect(await B.has(sha)).toBe(true);
  });

  test("uploadAndMirror reports per-server failures without throwing", async () => {
    const other = new TextEncoder().encode(`second ${Math.random()}`);
    const dead = new BlossomClient("http://127.0.0.1:1", signer);
    const r = await uploadAndMirror(other, "audio/mp4", A, [B, dead]);
    expect(r.mirrored.length).toBe(1);
    expect(r.failed.map((f) => f.server)).toEqual(["http://127.0.0.1:1"]);
    expect(await B.has(sha256Hex(other))).toBe(true);
  });

  test("an expired or missing auth event is rejected and nothing is stored", async () => {
    const fresh = new TextEncoder().encode(`unauthorized ${Math.random()}`);
    const fsha = sha256Hex(fresh);
    const expired = await fetch(`${A.server}/upload`, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "X-SHA-256": fsha,
        Authorization: await authHeader(signer, "upload", {
          sha256: fsha,
          now: 1_000_000,
          ttlSec: 10,
        }),
      },
      body: fresh,
    });
    expect(expired.ok).toBe(false);
    const noAuth = await fetch(`${A.server}/upload`, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "X-SHA-256": fsha },
      body: fresh,
    });
    expect(noAuth.ok).toBe(false);
    expect(await A.has(fsha)).toBe(false);
  });

  test("a server that lies about the hash is caught on upload", async () => {
    const liar = new BlossomClient(
      "http://liar.test",
      signer,
      async () =>
        new Response(
          JSON.stringify({ url: "http://liar.test/x", sha256: "0".repeat(64), size: 1 }),
          { status: 200 },
        ),
    );
    await expect(liar.upload(bytes, "video/mp4")).rejects.toThrow(/expected/);
  });

  test("fetchVerified skips dead and lying servers and uses the next URL (availability)", async () => {
    const lying = Bun.serve({ port: 0, fetch: () => new Response("not the blob") });
    try {
      const got = await fetchVerified(
        ["http://127.0.0.1:1/x", `http://127.0.0.1:${lying.port}/x`, B.urlFor(sha)],
        sha,
      );
      expect(got.url).toBe(B.urlFor(sha));
      await expect(fetchVerified([`http://127.0.0.1:${lying.port}/x`], sha)).rejects.toThrow(
        /hash mismatch/,
      );
    } finally {
      lying.stop(true);
    }
  });

  test("default fetch is called unbound, like a browser requires (regression: Illegal invocation)", async () => {
    const real = globalThis.fetch;
    // a browser's fetch throws when invoked with any `this` other than window/undefined
    globalThis.fetch = function strict(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return real(input, init);
    } as typeof fetch;
    try {
      const c = new BlossomClient(A.server, signer); // default fetch
      const b = new TextEncoder().encode(`unbound ${Math.random()}`);
      const d = await c.upload(b, "video/mp4");
      expect(await c.has(d.sha256)).toBe(true);
      expect((await fetchVerified([c.urlFor(d.sha256)], d.sha256)).bytes).toEqual(b);
    } finally {
      globalThis.fetch = real;
    }
  });

  test("a connection reset on a pooled socket is retried (uploads are idempotent); HTTP errors are not", async () => {
    let calls = 0;
    const flaky = new BlossomClient("http://flaky.test", signer, async (_u, init) => {
      calls++;
      if (calls <= 2) throw new TypeError("The socket connection was closed unexpectedly");
      const b = init?.body as Uint8Array;
      return new Response(
        JSON.stringify({ url: "http://flaky.test/x", sha256: sha256Hex(b), size: b.length }),
        { status: 200 },
      );
    });
    const bytes = new TextEncoder().encode("retry me");
    expect((await flaky.upload(bytes, "video/mp4")).sha256).toBe(sha256Hex(bytes));
    expect(calls).toBe(3);
    // an answer from the server (here 500) is never retried
    let hits = 0;
    const bad = new BlossomClient("http://bad.test", signer, async () => {
      hits++;
      return new Response("nope", { status: 500 });
    });
    await expect(bad.upload(bytes, "video/mp4")).rejects.toThrow(/500/);
    expect(hits).toBe(1);
    // a server that never answers gives up after three tries
    let dead = 0;
    const down = new BlossomClient("http://down.test", signer, async () => {
      dead++;
      throw new TypeError("fetch failed");
    });
    await expect(down.has("a".repeat(64))).rejects.toThrow();
    expect(dead).toBe(3);
  });

  test("delete removes a blob", async () => {
    const tmp = new TextEncoder().encode(`to delete ${Math.random()}`);
    const d = await A.upload(tmp, "video/mp4");
    await A.delete(d.sha256);
    expect(await A.has(d.sha256)).toBe(false);
  });
});
