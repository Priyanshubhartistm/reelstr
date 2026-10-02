import { sha256Hex } from "./blob";
import type { EventLike, EventTemplate } from "./result";
import { tagValue } from "./tags";
import { verifySignature } from "./validate";

export const HTTP_AUTH_KIND = 27235;
const MAX_SKEW_SEC = 60;

/**
 * NIP-98 HTTP auth event template for one request. `body` (if any) is hashed into a `payload` tag,
 * so a captured Authorization header cannot be replayed with a different body.
 */
export function httpAuthTemplate(o: {
  url: string;
  method: string;
  body?: string;
  createdAt?: number;
}): EventTemplate {
  const tags = [
    ["u", o.url],
    ["method", o.method.toUpperCase()],
  ];
  if (o.body !== undefined && o.body !== "")
    tags.push(["payload", sha256Hex(new TextEncoder().encode(o.body))]);
  return {
    kind: HTTP_AUTH_KIND,
    created_at: o.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
}

export const httpAuthHeader = (ev: unknown) => `Nostr ${btoa(JSON.stringify(ev))}`;

/**
 * Verify the `Authorization: Nostr <base64 event>` header of a request. Returns the signer's pubkey
 * or null. Checks signature, kind, freshness (60 s), method, URL path, and, when a body is given,
 * that its SHA-256 equals the `payload` tag (a POST with a body and no payload tag is refused).
 * Pass the request body text you already read (a Request body can only be read once).
 */
export function verifyHttpAuth(
  req: Request,
  bodyText?: string,
  publicPrefix?: string,
): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Nostr ")) return null;
  try {
    const ev = JSON.parse(atob(h.slice(6))) as EventLike & { created_at: number };
    if (ev.kind !== HTTP_AUTH_KIND || !verifySignature(ev)) return null;
    if (Math.abs(Date.now() / 1000 - ev.created_at) > MAX_SKEW_SEC) return null;
    const u = tagValue(ev.tags, "u");
    const m = tagValue(ev.tags, "method");
    // behind a reverse proxy that strips a path prefix (`/reelstr/media`), the client signed the public
    // path while this process sees the stripped one: PUBLIC_PATH_PREFIX says what was stripped.
    // Strict once set: the signed path must be exactly prefix + what we received.
    const prefix = (
      publicPrefix ??
      (typeof process !== "undefined" ? process.env?.PUBLIC_PATH_PREFIX : "") ??
      ""
    ).replace(/\/+$/, "");
    if (
      !u ||
      new URL(u).pathname !== prefix + new URL(req.url).pathname ||
      m?.toUpperCase() !== req.method
    )
      return null;
    if (bodyText !== undefined && bodyText !== "") {
      if (tagValue(ev.tags, "payload") !== sha256Hex(new TextEncoder().encode(bodyText)))
        return null;
    }
    return ev.pubkey;
  } catch {
    return null;
  }
}
