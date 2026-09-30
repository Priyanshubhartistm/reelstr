import { KIND } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { isHex64, tagsOf, tagValue } from "./tags";

export const NS_RATING = "reelstr/rating";
export const NS_VERIFIED = "reelstr/verified";

const at = (n?: number) => n ?? Math.floor(Date.now() / 1000);

/** FE-13: a 1-5 star rating with optional review text, as a NIP-32 label on a Cut (kind 1985). */
export function buildRating(o: {
  stars: number;
  cutId: string;
  cutCoord: string;
  review?: string;
  createdAt?: number;
}): EventTemplate {
  if (!Number.isInteger(o.stars) || o.stars < 1 || o.stars > 5)
    throw new Error("stars must be 1 to 5");
  return {
    kind: KIND.LABEL,
    created_at: at(o.createdAt),
    tags: [
      ["L", NS_RATING],
      ["l", String(o.stars), NS_RATING],
      ["e", o.cutId],
      ["a", o.cutCoord],
    ],
    content: o.review ?? "",
  };
}

export function parseRating(e: EventLike) {
  return {
    stars: Number(tagsOf(e.tags, "l").find((t) => t[2] === NS_RATING)?.[1]),
    cutId: tagValue(e.tags, "e") ?? "",
    cutCoord: tagValue(e.tags, "a") ?? "",
    review: e.content,
    rater: e.pubkey,
  };
}

export function validateRating(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.LABEL) c.err(`kind must be ${KIND.LABEL}`);
  if (!tagsOf(e.tags, "L").some((t) => t[1] === NS_RATING)) c.err(`missing L ${NS_RATING}`);
  const l = tagsOf(e.tags, "l").filter((t) => t[2] === NS_RATING);
  if (l.length !== 1) c.err("exactly one rating label required");
  else if (!/^[1-5]$/.test(l[0]?.[1] ?? "")) c.err("stars must be an integer 1 to 5");
  if (!isHex64(tagValue(e.tags, "e"))) c.err("e tag must name the Cut event");
  if (!/^31811:[0-9a-f]{64}:.+$/.test(tagValue(e.tags, "a") ?? ""))
    c.err("a tag must be a Cut coordinate");
  if (e.content.length > 2000) c.err("review is over 2000 characters");
  return c.result();
}

export type ReportReason = "spam" | "illegal" | "nudity" | "impersonation" | "malware" | "other";
const REASONS = new Set<string>(["spam", "illegal", "nudity", "impersonation", "malware", "other"]);

/** FE-11: NIP-56 report (kind 1984) of a Cut or Scene. The reporter hides it locally at once. */
export function buildReport(o: {
  eventId: string;
  authorPubkey: string;
  reason: ReportReason;
  note?: string;
  createdAt?: number;
}): EventTemplate {
  if (!REASONS.has(o.reason)) throw new Error(`unknown reason ${o.reason}`);
  return {
    kind: KIND.REPORT,
    created_at: at(o.createdAt),
    tags: [
      ["e", o.eventId, o.reason],
      ["p", o.authorPubkey],
    ],
    content: o.note ?? "",
  };
}

export function validateReport(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.REPORT) c.err(`kind must be ${KIND.REPORT}`);
  const t = tagsOf(e.tags, "e")[0];
  if (!isHex64(t?.[1])) c.err("e tag must name the reported event");
  if (!REASONS.has(t?.[2] ?? ""))
    c.err("e tag needs a reason: spam|illegal|nudity|impersonation|malware|other");
  if (!isHex64(tagValue(e.tags, "p"))) c.err("p tag must name the author");
  return c.result();
}

export type Verdict = "verified" | "mismatch" | "ineligible" | "error";

/**
 * "Source Verified": a verifier re-rendered the scene from its manifest and compared the result.
 * `similarity` is SSIM 0..1. `exact` is true only for a byte-identical re-render. This is a claim
 * by the verifier, not proof; clients choose which verifiers to trust.
 */
export function buildVerification(o: {
  sceneId: string;
  sceneSha256: string;
  verdict: Verdict;
  similarity?: number;
  exact?: boolean;
  engine: string;
  createdAt?: number;
}): EventTemplate {
  const tags = [
    ["L", NS_VERIFIED],
    ["l", o.verdict, NS_VERIFIED],
    ["e", o.sceneId],
    ["x", o.sceneSha256],
    ["engine", o.engine],
  ];
  if (o.similarity !== undefined) tags.push(["similarity", o.similarity.toFixed(4)]);
  if (o.exact !== undefined) tags.push(["exact", o.exact ? "1" : "0"]);
  return { kind: KIND.LABEL, created_at: at(o.createdAt), tags, content: "" };
}

export function parseVerification(e: EventLike) {
  return {
    verdict: (tagsOf(e.tags, "l").find((t) => t[2] === NS_VERIFIED)?.[1] ?? "error") as Verdict,
    sceneId: tagValue(e.tags, "e") ?? "",
    sceneSha256: tagValue(e.tags, "x") ?? "",
    similarity:
      tagValue(e.tags, "similarity") === undefined
        ? undefined
        : Number(tagValue(e.tags, "similarity")),
    exact: tagValue(e.tags, "exact") === "1",
    engine: tagValue(e.tags, "engine") ?? "",
    verifier: e.pubkey,
  };
}

export function validateVerification(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.LABEL) c.err(`kind must be ${KIND.LABEL}`);
  const v = tagsOf(e.tags, "l").find((t) => t[2] === NS_VERIFIED)?.[1];
  if (!["verified", "mismatch", "ineligible", "error"].includes(v ?? ""))
    c.err("verdict must be verified|mismatch|ineligible|error");
  if (!isHex64(tagValue(e.tags, "e"))) c.err("e tag must name the scene");
  if (!isHex64(tagValue(e.tags, "x"))) c.err("x tag must be the scene blob sha256");
  const sim = tagValue(e.tags, "similarity");
  if (sim !== undefined && !(Number(sim) >= 0 && Number(sim) <= 1))
    c.err("similarity must be between 0 and 1");
  return c.result();
}
