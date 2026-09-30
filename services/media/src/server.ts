import { BlossomClient } from "@reelstr/blossom";
import { LocalSigner } from "@reelstr/nostr";
import { type Hosts, ingestScene, renderAndPublish } from "./pipeline";

type Job = {
  id: string;
  kind: "ingest" | "render";
  status: "queued" | "running" | "done" | "failed";
  result?: unknown;
  error?: string;
};

/** Sequential job runner: ffmpeg is CPU bound, so one at a time. Jobs live in memory (lost on restart). */
export function createMediaServer(opts: {
  token: string;
  hosts: Hosts;
  run?: { ingest: typeof ingestScene; render: typeof renderAndPublish };
}) {
  const jobs = new Map<string, Job>();
  const run = opts.run ?? { ingest: ingestScene, render: renderAndPublish };
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = (kind: Job["kind"], fn: () => Promise<unknown>): Job => {
    const job: Job = { id: crypto.randomUUID(), kind, status: "queued" };
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

  return Bun.serve({
    port: Number(process.env.PORT ?? 3200),
    async fetch(req) {
      const url = new URL(req.url);
      if (req.headers.get("authorization") !== `Bearer ${opts.token}`)
        return Response.json({ error: "unauthorized" }, { status: 401 });
      if (req.method === "POST" && url.pathname === "/ingest") {
        const b = (await req.json()) as {
          sha256: string;
          urls: string[];
          fit?: "crop" | "letterbox";
        };
        if (!/^[0-9a-f]{64}$/.test(b.sha256) || !Array.isArray(b.urls) || b.urls.length === 0)
          return Response.json({ error: "need sha256 and urls" }, { status: 400 });
        return Response.json(
          enqueue("ingest", () => run.ingest(b, opts.hosts, { fit: b.fit })),
          { status: 202 },
        );
      }
      if (req.method === "POST" && url.pathname === "/render") {
        const b = (await req.json()) as Parameters<typeof renderAndPublish>[0] & {
          key?: string;
          iv?: string;
          keyUri?: string;
        };
        if (!Array.isArray(b.scenes) || b.scenes.length === 0)
          return Response.json({ error: "need scenes" }, { status: 400 });
        const job = { ...b } as Parameters<typeof renderAndPublish>[0];
        if (b.key && b.iv && b.keyUri)
          job.encryption = {
            key: Buffer.from(b.key, "hex"),
            iv: Buffer.from(b.iv, "hex"),
            keyUri: b.keyUri,
          };
        return Response.json(
          enqueue("render", () => run.render(job, opts.hosts)),
          { status: 202 },
        );
      }
      const m = url.pathname.match(/^\/jobs\/([\w-]+)$/);
      if (req.method === "GET" && m) {
        const j = jobs.get(m[1] as string);
        return j ? Response.json(j) : Response.json({ error: "no such job" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const token = process.env.MEDIA_TOKEN;
  if (!token) throw new Error("MEDIA_TOKEN is required");
  const signer = process.env.MEDIA_NSEC
    ? LocalSigner.fromNsec(process.env.MEDIA_NSEC)
    : LocalSigner.generate();
  const primary = new BlossomClient(process.env.BLOSSOM_URL ?? "http://127.0.0.1:3100", signer);
  const mirrors = (process.env.BLOSSOM_MIRRORS ?? "")
    .split(",")
    .filter(Boolean)
    .map((u) => new BlossomClient(u, signer));
  const s = createMediaServer({ token, hosts: { primary, mirrors } });
  console.log(`media service on :${s.port}`);
}
