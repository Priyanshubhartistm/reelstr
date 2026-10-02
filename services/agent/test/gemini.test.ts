import { afterAll, describe, expect, test } from "bun:test";
import { GeminiVeoAdapter } from "../src";

// A mock of the Gemini API built from Google's published Veo guide: predictLongRunning with an
// x-goog-api-key header, an operation to poll, then a video uri to download with the same key.
let pollsUntilDone = 2;
let opError: string | null = null;
let noVideo = false;
let uriHost = "";
const seen: { path: string; key: string | null; body?: Record<string, unknown> }[] = [];
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 9, 9]);
const srv: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  async fetch(req): Promise<Response> {
    const u = new URL(req.url);
    const key = req.headers.get("x-goog-api-key");
    seen.push({
      path: u.pathname,
      key,
      body: req.method === "POST" ? ((await req.json()) as Record<string, unknown>) : undefined,
    });
    if (key !== "secret") return new Response("denied", { status: 403 });
    if (req.method === "POST" && u.pathname.endsWith(":predictLongRunning"))
      return Response.json({ name: "operations/op-1" });
    if (u.pathname === "/v1beta/operations/op-1") {
      if (opError) return Response.json({ done: true, error: { message: opError } });
      if (pollsUntilDone-- > 0) return Response.json({ done: false });
      return Response.json({
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: noVideo
              ? []
              : [{ video: { uri: `${uriHost || `http://127.0.0.1:${srv.port}`}/download/v.mp4` } }],
          },
        },
      });
    }
    if (u.pathname === "/download/v.mp4") return new Response(VIDEO);
    return new Response("nope", { status: 404 });
  },
});
afterAll(() => srv.stop(true));
const base = () => `http://127.0.0.1:${srv.port}/v1beta`;
const req = { prompt: "a tower at dawn", seed: "7", refs: [], loras: [], durationSec: 6 };
// the real download host must be Google's; the mock stands in for it by rewriting the check's input
const viaMock = (i: string, o?: RequestInit) =>
  fetch(i.replace("https://files.googleapis.com", `http://127.0.0.1:${srv.port}`), o);

describe("GeminiVeoAdapter", () => {
  test("submits the documented request, polls, downloads with the key, and says it is closed", async () => {
    seen.length = 0;
    pollsUntilDone = 2;
    uriHost = "https://files.googleapis.com";
    const a = new GeminiVeoAdapter("secret", "veo-3.1-generate-preview", viaMock, 1, base());
    expect(a.open).toBe(false);
    expect(a.notes).toMatch(/closed weights/);
    const bytes = await a.generate(req);
    expect(Array.from(bytes)).toEqual(Array.from(VIDEO));
    const submit = seen[0];
    expect(submit?.path).toBe("/v1beta/models/veo-3.1-generate-preview:predictLongRunning");
    expect(submit?.key).toBe("secret");
    expect(submit?.body).toEqual({
      instances: [{ prompt: "a tower at dawn" }],
      parameters: { aspectRatio: "9:16", durationSeconds: "6", resolution: "720p", seed: 7 },
    });
    expect(seen.filter((x) => x.path === "/v1beta/operations/op-1").length).toBe(3);
    expect(seen.at(-1)?.key).toBe("secret"); // the download is authenticated too
  });

  test("durations map to 4, 6 or 8 s, over 8 s is refused, a non-numeric seed is omitted", async () => {
    uriHost = "https://files.googleapis.com";
    const a = new GeminiVeoAdapter("secret", undefined, viaMock, 1, base());
    for (const [asked, sent] of [
      [3, "4"],
      [4, "4"],
      [5, "6"],
      [7.2, "8"],
    ] as const) {
      seen.length = 0;
      pollsUntilDone = 0;
      await a.generate({ ...req, durationSec: asked, seed: "abc" });
      const p = ((seen[0]?.body ?? {}) as { parameters: Record<string, unknown> }).parameters;
      expect(p.durationSeconds).toBe(sent);
      expect("seed" in p).toBe(false);
    }
    await expect(a.generate({ ...req, durationSec: 9 })).rejects.toThrow(/up to 8 s/);
  });

  test("failures say why: bad key, a failed operation, no video (safety filter), and a foreign download host", async () => {
    uriHost = "https://files.googleapis.com";
    await expect(
      new GeminiVeoAdapter("wrong", undefined, viaMock, 1, base()).generate(req),
    ).rejects.toThrow(/submit failed: 403/);
    opError = "quota exceeded";
    await expect(
      new GeminiVeoAdapter("secret", undefined, viaMock, 1, base()).generate(req),
    ).rejects.toThrow(/quota exceeded/);
    opError = null;
    noVideo = true;
    pollsUntilDone = 0;
    await expect(
      new GeminiVeoAdapter("secret", undefined, viaMock, 1, base()).generate(req),
    ).rejects.toThrow(/safety filter/);
    noVideo = false;
    uriHost = "https://evil.example";
    pollsUntilDone = 0;
    seen.length = 0;
    await expect(
      new GeminiVeoAdapter("secret", undefined, viaMock, 1, base()).generate(req),
    ).rejects.toThrow(/refusing to send the API key to evil.example/);
    expect(seen.some((x) => x.path === "/download/v.mp4")).toBe(false);
  });
});
