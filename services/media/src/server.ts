import { BlossomClient } from "@reelstr/blossom";
import { LocalSigner } from "@reelstr/nostr";
import { verifyHttpAuth } from "@reelstr/protocol";
import { captionEpisode, type Hosts, ingestScene, renderAndPublish } from "./pipeline";

type Job = {
  id: string;
  /** pubkey that created it: only they can read it */
  owner: string;
  kind: "ingest" | "render" | "captions";
  status: "queued" | "running" | "done" | "failed";
  result?: unknown;
  error?: string;
};

export interface MediaServerOpts {
  hosts: Hosts;
  /**
   * Which callers may use the service. Every request must carry a NIP-98 signature bound to its
   * URL, method and body. `allow` narrows that to chosen pubkeys; omit it for an open service
   * that is still rate limited per pubkey.
   */
  allow?: (pubkey: string) => boolean;
  /** hosts the service may fetch source blobs from; defaults to the configured Blossom servers */
  allowedHosts?: string[];
  /** jobs per pubkey per hour (default 60) */
  maxJobsPerHour?: number;
  /** jobs waiting or running across everyone (default 20) */
  maxQueued?: number;
  run?: {
    ingest: typeof ingestScene;
    render: typeof renderAndPublish;
    captions?: typeof captionEpisode;
  };
  port?: number;
}

/** Sequential job runner: ffmpeg is CPU bound, so one at a time. Jobs live in memory (lost on restart). */
export function createMediaServer(opts: MediaServerOpts) {
  const jobs = new Map<string, Job>();
  const run = {
    captions: captionEpisode,
    ...(opts.run ?? { ingest: ingestScene, render: renderAndPublish }),
  };
  const hostOf = (u: string) => new URL(u).host;
  const allowedHosts = new Set(
    opts.allowedHosts ??
      [opts.hosts.primary.server, ...opts.hosts.mirrors.map((m) => m.server)].map(hostOf),
  );
  const perHour = opts.maxJobsPerHour ?? 60;
  const maxQueued = opts.maxQueued ?? 20;
  const history = new Map<string, number[]>();
  let chain: Promise<unknown> = Promise.resolve();

  const pending = () =>
    [...jobs.values()].filter((j) => j.status === "queued" || j.status === "running").length;

  /** Reserve a slot for `owner`, or say why not. */
  const admit = (owner: string): Response | null => {
    const now = Date.now();
    const recent = (history.get(owner) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour)
      return Response.json({ error: `rate limit: ${perHour} jobs per hour` }, { status: 429 });
    if (pending() >= maxQueued)
      return Response.json({ error: "service is busy, try again shortly" }, { status: 503 });
    history.set(owner, [...recent, now]);
    return null;
  };

  const enqueue = (owner: string, kind: Job["kind"], fn: () => Promise<unknown>): Job => {
    const job: Job = { id: crypto.randomUUID(), owner, kind, status: "queued" };
    jobs.set(job.id, job);
    chain = chain.then(async () => {
      job.status = "running";
      try {
        job.result = await fn();
        job.status = "done";
      } catch (e) {
        job.error = (e as Error).message;
        job.status = "failed";
      }
    });
    return job;
  };

  const badUrl = (urls: unknown): string | null => {
    if (!Array.isArray(urls) || urls.length === 0) return "need urls";
    for (const u of urls) {
      try {
        const x = new URL(String(u));
        if (x.protocol !== "http:" && x.protocol !== "https:") return `unsupported scheme in ${u}`;
        if (!allowedHosts.has(x.host)) return `${x.host} is not an allowed source host`;
      } catch {
        return `invalid url ${u}`;
      }
    }
    return null;
  };

  const view = (j: Job) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    result: j.result,
    error: j.error,
  });

  // browsers call this from the Studio/Cinema origin, so it needs CORS (and a preflight answer)
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const MAX_BODY = 1_000_000; // job requests are small JSON; blobs go to Blossom, never through here
  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const text = req.method === "POST" ? await req.text() : "";
    if (text.length > MAX_BODY)
      return Response.json({ error: "request too large" }, { status: 413 });
    const who = verifyHttpAuth(req, text);
    if (!who)
      return Response.json({ error: "unauthorized: sign the request (NIP-98)" }, { status: 401 });
    if (opts.allow && !opts.allow(who))
      return Response.json({ error: "this pubkey may not use the service" }, { status: 403 });
    const body = (): Record<string, unknown> | null => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    if (req.method === "POST" && url.pathname === "/ingest") {
      const b = body() as { sha256: string; urls: string[]; fit?: "crop" | "letterbox" } | null;
      if (!b || !/^[0-9a-f]{64}$/.test(b.sha256 ?? ""))
        return Response.json({ error: "need sha256 and urls" }, { status: 400 });
      const bad = badUrl(b.urls);
      if (bad) return Response.json({ error: bad }, { status: 400 });
      const no = admit(who);
      if (no) return no;
      return Response.json(
        view(enqueue(who, "ingest", () => run.ingest(b, opts.hosts, { fit: b.fit }))),
        { status: 202 },
      );
    }
    if (req.method === "POST" && url.pathname === "/render") {
      const b = body() as
        | (Parameters<typeof renderAndPublish>[0] & { key?: string; iv?: string; keyUri?: string })
        | null;
      if (!b || !Array.isArray(b.scenes) || b.scenes.length === 0)
        return Response.json({ error: "need scenes" }, { status: 400 });
      if (b.scenes.length > 40)
        return Response.json({ error: "too many scenes (max 40)" }, { status: 400 });
      for (const sc of [...b.scenes, ...(b.audioBed ? [b.audioBed] : [])]) {
        const bad = badUrl((sc as { urls: string[] }).urls);
        if (bad) return Response.json({ error: bad }, { status: 400 });
      }
      const job = { ...b } as Parameters<typeof renderAndPublish>[0];
      if (b.key && b.iv && b.keyUri)
        job.encryption = {
          key: Buffer.from(b.key, "hex"),
          iv: Buffer.from(b.iv, "hex"),
          keyUri: b.keyUri,
        };
      const no = admit(who);
      if (no) return no;
      return Response.json(view(enqueue(who, "render", () => run.render(job, opts.hosts))), {
        status: 202,
      });
    }
    if (req.method === "POST" && url.pathname === "/captions") {
      const b = body() as Parameters<typeof captionEpisode>[0] | null;
      if (!b || !Array.isArray(b.scenes) || b.scenes.length === 0)
        return Response.json({ error: "need scenes" }, { status: 400 });
      if (b.scenes.length > 40)
        return Response.json({ error: "too many scenes (max 40)" }, { status: 400 });
      for (const sc of b.scenes) {
        const bad = badUrl(sc.urls);
        if (bad) return Response.json({ error: bad }, { status: 400 });
      }
      const no = admit(who);
      if (no) return no;
      return Response.json(view(enqueue(who, "captions", () => run.captions(b, opts.hosts))), {
        status: 202,
      });
    }
    const m = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const j = jobs.get(m[1] as string);
      // someone else's job looks exactly like a missing one
      return j && j.owner === who
        ? Response.json(view(j))
        : Response.json({ error: "no such job" }, { status: 404 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
  return Bun.serve({
    port: opts.port ?? Number(process.env.PORT ?? 3200),
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const res = await handle(req);
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
      return res;
    },
  });
}

if (import.meta.main) {
  // MEDIA_ALLOW: comma-separated hex pubkeys. Empty = anyone with a valid signature (still rate limited).
  const allowed = (process.env.MEDIA_ALLOW ?? "").split(",").filter(Boolean);
  const signer = process.env.MEDIA_NSEC
    ? LocalSigner.fromNsec(process.env.MEDIA_NSEC)
    : LocalSigner.generate();
  const primary = new BlossomClient(process.env.BLOSSOM_URL ?? "http://127.0.0.1:3100", signer);
  const mirrors = (process.env.BLOSSOM_MIRRORS ?? "")
    .split(",")
    .filter(Boolean)
    .map((u) => new BlossomClient(u, signer));
  const s = createMediaServer({
    hosts: { primary, mirrors },
    allow: allowed.length ? (pk) => allowed.includes(pk) : undefined,
  });
  console.log(`media service on :${s.port}`);
}
