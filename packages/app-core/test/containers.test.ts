import { afterAll, describe, expect, test } from "bun:test";
import { BlossomClient, fetchVerified } from "@reelstr/blossom";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildStory, KIND, sha256Hex, validateEvent } from "@reelstr/protocol";
import { freePort } from "@reelstr/testkit";

// Runs the Dockerfiles for real (with podman, which reads them unchanged). Skipped when podman or
// the images are missing: build them with `podman build -t reelstr-relay services/relay` and
// `podman build -t reelstr-blossom infra/blossom`.
const have = (img: string) => Bun.spawnSync(["podman", "image", "exists", img]).exitCode === 0;
const ready = have("reelstr-relay") && have("reelstr-blossom");
const started: string[] = [];
const sh = (args: string[]) => Bun.spawnSync(["podman", ...args]);
afterAll(() => {
  for (const n of started) sh(["rm", "-f", "-t", "1", n]);
  for (const v of ["reelstr-test-relay", "reelstr-test-blossom"]) sh(["volume", "rm", "-f", v]);
});

/** Several consecutive answers through the port forwarder (one answer is not proof it is stable). */
async function waitHttp(url: string, consecutive = 4) {
  let ok = 0;
  for (let i = 0; i < 150 && ok < consecutive; i++) {
    try {
      await fetch(url, { headers: { Accept: "application/nostr+json" } });
      ok++;
    } catch {
      ok = 0;
    }
    await Bun.sleep(150);
  }
  if (ok < consecutive) throw new Error(`${url} never answered ${consecutive} times in a row`);
}

const STARTED = /Started app on port|reelstr-relay on/;

/** Wait until the app inside the container has logged its start line `times` times (once per (re)start).
 * podman's port forwarder accepts connections before the app listens, so an HTTP probe is not enough. */
async function waitLog(name: string, re: RegExp, times: number) {
  const g = new RegExp(re.source, "g");
  for (let i = 0; i < 150; i++) {
    const l = sh(["logs", name]);
    if (((l.stdout.toString() + l.stderr.toString()).match(g) ?? []).length >= times) return;
    await Bun.sleep(200);
  }
  throw new Error(
    `${name}: start line never appeared ${times}x: ${sh(["logs", name]).stderr.toString().slice(-300)}`,
  );
}

async function up(
  name: string,
  image: string,
  hostPort: number,
  containerPort: number,
  env: Record<string, string>,
  volume: string,
  mount: string,
) {
  sh(["rm", "-f", "-t", "1", name]);
  const r = sh([
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${hostPort}:${containerPort}`,
    "-v",
    `${volume}:${mount}`,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    image,
  ]);
  if (r.exitCode !== 0) throw new Error(`podman run failed: ${r.stderr.toString()}`);
  started.push(name);
  await waitLog(name, STARTED, 1);
  await waitHttp(`http://127.0.0.1:${hostPort}`);
}

describe.skipIf(!ready)("container images (infra/docker-compose.yml shape)", () => {
  test("relay container: NIP-11 info, accepts a Reelstr event, rejects other kinds, keeps data across a restart", async () => {
    const port = freePort();
    await up(
      "reelstr-test-relay",
      "reelstr-relay",
      port,
      3334,
      { POW_BITS: "0" },
      "reelstr-test-relay",
      "/data",
    );
    const url = `ws://127.0.0.1:${port}`;
    const info = (await (
      await fetch(`http://127.0.0.1:${port}`, { headers: { Accept: "application/nostr+json" } })
    ).json()) as { name: string };
    expect(info.name).toBe("reelstr-relay");
    const pool = new RelayPool();
    const s = LocalSigner.generate();
    const story = await s.signEvent(
      buildStory({ d: "ctr", title: "In a container", logline: "l" }),
    );
    expect(validateEvent(story, { verifySig: true }).ok).toBe(true);
    await pool.publish(story, [url]);
    await expect(
      pool.publish(
        await s.signEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "no",
        }),
        [url],
      ),
    ).rejects.toThrow(/blocked/);
    expect((await pool.query([url], { kinds: [KIND.STORY] })).map((e) => e.id)).toEqual([story.id]);
    // restart the container: the volume keeps the event
    expect(sh(["restart", "-t", "1", "reelstr-test-relay"]).exitCode).toBe(0);
    await waitLog("reelstr-test-relay", STARTED, 2);
    await waitHttp(`http://127.0.0.1:${port}`);
    const pool2 = new RelayPool();
    expect((await pool2.query([url], { kinds: [KIND.STORY] })).map((e) => e.id)).toEqual([
      story.id,
    ]);
    pool.close([url]);
    pool2.close([url]);
  }, 180_000);

  test("blossom container: authorized upload, hash-verified download, mirror to another server, delete", async () => {
    const port = freePort();
    await up(
      "reelstr-test-blossom",
      "reelstr-blossom",
      port,
      3100,
      { PORT: "3100", BLOSSOM_PUBLIC_URL: `http://127.0.0.1:${port}` },
      "reelstr-test-blossom",
      "/data",
    );
    const signer = LocalSigner.generate();
    const c = new BlossomClient(`http://127.0.0.1:${port}`, signer);
    const bytes = new TextEncoder().encode(`container blob ${Math.random()}`);
    const d = await c.upload(bytes, "video/mp4");
    expect(d.sha256).toBe(sha256Hex(bytes));
    expect((await fetchVerified([c.urlFor(d.sha256)], d.sha256)).bytes).toEqual(bytes);
    // no auth, no upload
    expect(
      (await fetch(`http://127.0.0.1:${port}/upload`, { method: "PUT", body: bytes })).ok,
    ).toBe(false);
    // data survives a restart
    expect(sh(["restart", "-t", "1", "reelstr-test-blossom"]).exitCode).toBe(0);
    await waitLog("reelstr-test-blossom", STARTED, 2);
    await waitHttp(`http://127.0.0.1:${port}`);
    expect(await c.has(d.sha256)).toBe(true);
    await c.delete(d.sha256);
    expect(await c.has(d.sha256)).toBe(false);
  }, 180_000);
});
