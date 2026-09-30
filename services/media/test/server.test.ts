import { afterAll, describe, expect, test } from "bun:test";
import { BlossomClient } from "@reelstr/blossom";
import { LocalSigner } from "@reelstr/nostr";
import { createMediaServer } from "../src/server";

const client = new BlossomClient("http://127.0.0.1:1", LocalSigner.generate());
const ok = { primary: client, mirrors: [] };
process.env.PORT = "0";
const fakeRun = {
  ingest: (async (src: { sha256: string }) => {
    if (src.sha256.startsWith("f")) throw new Error("boom");
    return { ok: true };
  }) as never,
  render: (async () => ({ masterSha256: "x" })) as never,
};
const srv = createMediaServer({ token: "secret", hosts: ok, run: fakeRun });
const base = `http://127.0.0.1:${srv.port}`;
const auth = { Authorization: "Bearer secret", "Content-Type": "application/json" };
afterAll(() => srv.stop(true));

async function poll(id: string) {
  for (let i = 0; i < 50; i++) {
    const j = (await (await fetch(`${base}/jobs/${id}`, { headers: auth })).json()) as {
      status: string;
    };
    if (j.status === "done" || j.status === "failed") return j;
    await Bun.sleep(20);
  }
  throw new Error("job did not finish");
}

describe("media server", () => {
  test("rejects missing or wrong token", async () => {
    expect((await fetch(`${base}/jobs/x`)).status).toBe(401);
    expect(
      (await fetch(`${base}/jobs/x`, { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });
  test("validates input", async () => {
    const r = await fetch(`${base}/ingest`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sha256: "zz", urls: [] }),
    });
    expect(r.status).toBe(400);
    const r2 = await fetch(`${base}/render`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ scenes: [] }),
    });
    expect(r2.status).toBe(400);
  });
  test("job lifecycle: queued -> done, and failures are reported", async () => {
    const good = (await (
      await fetch(`${base}/ingest`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ sha256: "a".repeat(64), urls: ["http://x"] }),
      })
    ).json()) as { id: string };
    expect(((await poll(good.id)) as { status: string }).status).toBe("done");
    const bad = (await (
      await fetch(`${base}/ingest`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ sha256: "f".repeat(64), urls: ["http://x"] }),
      })
    ).json()) as { id: string };
    const j = (await poll(bad.id)) as { status: string; error?: string };
    expect(j.status).toBe("failed");
    expect(j.error).toBe("boom");
    expect((await fetch(`${base}/jobs/nope`, { headers: auth })).status).toBe(404);
  });
});
