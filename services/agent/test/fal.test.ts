import { afterAll, describe, expect, test } from "bun:test";
import { FalWanAdapter } from "../src";

// Mock of fal's queue: Key auth, submit -> status polling -> result -> download.
let statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
let failWith: string | null = null;
let noVideo = false;
const seen: { path: string; auth: string | null; body?: Record<string, unknown> }[] = [];
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 1, 2, 3]);
const srv: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  async fetch(req): Promise<Response> {
    const u = new URL(req.url);
    const auth = req.headers.get("authorization");
    seen.push({
      path: u.pathname,
      auth,
      body: req.method === "POST" ? ((await req.json()) as Record<string, unknown>) : undefined,
    });
    if (u.pathname.startsWith("/video/")) return new Response(VIDEO);
    if (auth !== "Key secret-key") return new Response("unauthorized", { status: 401 });
    const base = `http://127.0.0.1:${srv.port}`;
    if (req.method === "POST" && u.pathname === "/fal-ai/wan/v2.2-a14b/text-to-video")
      return Response.json({
        request_id: "r1",
        status_url: `${base}/q/requests/r1/status`,
        response_url: `${base}/q/requests/r1`,
      });
    if (u.pathname === "/q/requests/r1/status")
      return Response.json({ status: failWith ?? statuses.shift() ?? "COMPLETED" });
    if (u.pathname === "/q/requests/r1")
      return Response.json(noVideo ? {} : { video: { url: `${base}/video/out.mp4` }, seed: 5 });
    return new Response("nope", { status: 404 });
  },
});
afterAll(() => srv.stop(true));

// route the real hostname to the mock, keep everything else (paths, headers, bodies) intact
const viaMock = (i: string, o?: RequestInit) =>
  fetch(i.replace("https://queue.fal.run", `http://127.0.0.1:${srv.port}`), o);
const mk = (key = "secret-key") =>
  new FalWanAdapter(key, "fal-ai/wan/v2.2-a14b/text-to-video", viaMock, 5);

describe("FalWanAdapter against a mock of fal's queue", () => {
  test("submits with Key auth and a 9:16 prompt/seed body, polls to COMPLETED, downloads the video", async () => {
    seen.length = 0;
    statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    const bytes = await mk().generate({
      prompt: "neon alley",
      seed: "1234",
      refs: [],
      loras: [],
      durationSec: 5,
    });
    expect(bytes).toEqual(VIDEO);
    const submit = seen.find((s) => s.body);
    expect(submit?.auth).toBe("Key secret-key");
    expect(submit?.body).toEqual({ prompt: "neon alley", seed: 1234, aspect_ratio: "9:16" });
    expect(seen.filter((s) => s.path.endsWith("/status")).length).toBe(3);
  });
  test("a bad key, a failed job, a result without a video, and an over-long request are all errors", async () => {
    await expect(
      mk("wrong").generate({ prompt: "p", seed: "1", refs: [], loras: [], durationSec: 5 }),
    ).rejects.toThrow(/401/);
    failWith = "FAILED";
    await expect(
      mk().generate({ prompt: "p", seed: "1", refs: [], loras: [], durationSec: 5 }),
    ).rejects.toThrow(/failed/);
    failWith = null;
    statuses = ["COMPLETED"];
    noVideo = true;
    await expect(
      mk().generate({ prompt: "p", seed: "1", refs: [], loras: [], durationSec: 5 }),
    ).rejects.toThrow(/no video/);
    noVideo = false;
    await expect(
      mk().generate({ prompt: "p", seed: "1", refs: [], loras: [], durationSec: 12 }),
    ).rejects.toThrow(/~5 s/);
  });
  test("it is an open-weight adapter named for the Apache-2.0 model", () => {
    const a = mk();
    expect(a).toMatchObject({ model: "wan-2.2-t2v", open: true });
    expect(a.notes).toContain("Apache-2.0");
  });
});
