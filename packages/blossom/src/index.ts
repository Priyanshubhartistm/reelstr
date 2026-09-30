import type { Signer } from "@reelstr/nostr";
import { blobMatches, sha256Hex } from "@reelstr/protocol";

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type?: string;
  uploaded?: number;
}

type Verb = "upload" | "get" | "list" | "delete";
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** BUD-11: kind 24242 authorization event, sent as `Authorization: Nostr <base64 json>`. */
export async function authHeader(
  signer: Signer,
  verb: Verb,
  opts: { sha256?: string; ttlSec?: number; now?: number; content?: string } = {},
): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tags = [
    ["t", verb],
    ["expiration", String(now + (opts.ttlSec ?? 300))],
  ];
  if (opts.sha256) tags.push(["x", opts.sha256]);
  const ev = await signer.signEvent({
    kind: 24242,
    created_at: now,
    tags,
    content: opts.content ?? verb,
  });
  return `Nostr ${btoa(JSON.stringify(ev))}`;
}

function checkDescriptor(d: BlobDescriptor, expectedSha: string, what: string): BlobDescriptor {
  if (!d || typeof d.url !== "string") throw new Error(`${what}: server returned no descriptor`);
  if (d.sha256?.toLowerCase() !== expectedSha)
    throw new Error(`${what}: server stored ${d.sha256}, expected ${expectedSha}`);
  return d;
}

export class BlossomClient {
  readonly server: string;
  constructor(
    server: string,
    private readonly signer: Signer,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.server = server.replace(/\/+$/, "");
  }

  /** BUD-02 upload. The server's answer is checked against the locally computed hash. */
  async upload(bytes: Uint8Array, contentType: string): Promise<BlobDescriptor> {
    const sha256 = sha256Hex(bytes);
    const res = await this.fetchFn(`${this.server}/upload`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "X-SHA-256": sha256,
        Authorization: await authHeader(this.signer, "upload", { sha256 }),
      },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok)
      throw new Error(
        `upload to ${this.server} failed: ${res.status} ${res.headers.get("x-reason") ?? (await res.text())}`,
      );
    return checkDescriptor(
      (await res.json()) as BlobDescriptor,
      sha256,
      `upload to ${this.server}`,
    );
  }

  /** BUD-04 mirror: ask this server to copy a blob from `url`. Servers MAY refuse. */
  async mirror(url: string, sha256: string): Promise<BlobDescriptor> {
    const res = await this.fetchFn(`${this.server}/mirror`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await authHeader(this.signer, "upload", { sha256 }),
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok)
      throw new Error(
        `mirror to ${this.server} failed: ${res.status} ${res.headers.get("x-reason") ?? (await res.text())}`,
      );
    return checkDescriptor(
      (await res.json()) as BlobDescriptor,
      sha256,
      `mirror to ${this.server}`,
    );
  }

  async has(sha256: string): Promise<boolean> {
    const res = await this.fetchFn(`${this.server}/${sha256}`, { method: "HEAD" });
    return res.ok;
  }

  async list(pubkey: string): Promise<BlobDescriptor[]> {
    const res = await this.fetchFn(`${this.server}/list/${pubkey}`);
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return (await res.json()) as BlobDescriptor[];
  }

  async delete(sha256: string): Promise<void> {
    const res = await this.fetchFn(`${this.server}/${sha256}`, {
      method: "DELETE",
      headers: { Authorization: await authHeader(this.signer, "delete", { sha256 }) },
    });
    if (!res.ok) throw new Error(`delete failed: ${res.status}`);
  }

  /** Content-addressed URL for a blob on this server. */
  urlFor(sha256: string, ext = ""): string {
    return `${this.server}/${sha256}${ext}`;
  }
}

/**
 * Try each URL in order (primary, then `fallback` and mirror URLs) and return the first body
 * whose SHA-256 matches. A server that returns the wrong bytes is skipped, never trusted.
 */
export async function fetchVerified(
  urls: string[],
  sha256: string,
  fetchFn: FetchLike = fetch,
): Promise<{ bytes: Uint8Array; url: string }> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        failures.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!blobMatches(bytes, sha256)) {
        failures.push(`${url}: hash mismatch`);
        continue;
      }
      return { bytes, url };
    } catch (e) {
      failures.push(`${url}: ${(e as Error).message}`);
    }
  }
  throw new Error(`no server returned blob ${sha256}: ${failures.join("; ")}`);
}

/** Upload to the primary, then mirror onto every other server (BE-8). Returns the descriptors that succeeded. */
export async function uploadAndMirror(
  bytes: Uint8Array,
  contentType: string,
  primary: BlossomClient,
  mirrors: BlossomClient[],
): Promise<{
  primary: BlobDescriptor;
  mirrored: BlobDescriptor[];
  failed: { server: string; reason: string }[];
}> {
  const desc = await primary.upload(bytes, contentType);
  const mirrored: BlobDescriptor[] = [];
  const failed: { server: string; reason: string }[] = [];
  for (const m of mirrors) {
    try {
      mirrored.push(await m.mirror(desc.url, desc.sha256));
    } catch (e) {
      failed.push({ server: m.server, reason: (e as Error).message });
    }
  }
  return { primary: desc, mirrored, failed };
}
