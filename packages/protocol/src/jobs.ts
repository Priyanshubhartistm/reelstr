import { coordinate } from "./coords";
import { DEFAULT_LICENSE, KIND, REELSTR_TAG } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { isForkable } from "./scene";
import { isHex64, tagsOf, tagValue } from "./tags";

const at = (n?: number) => n ?? Math.floor(Date.now() / 1000);
export const JOB_MIN_SEC = 4;
export const JOB_MAX_SEC = 20;

export interface JobRequestParams {
  agent: string;
  prompt: string;
  story: { pubkey: string; d: string };
  parentId?: string;
  model: string;
  seed?: string | number;
  refs?: string[];
  loras?: string[];
  durationSec: number;
  /** what the requester will pay on accepting the delivery */
  bidSats: number;
  license?: string;
  createdAt?: number;
}

/** NP-5: ask an agent for a scene. The agent is named in a `p` tag; the requester is the event's author. */
export function buildJobRequest(p: JobRequestParams): EventTemplate {
  const tags: string[][] = [
    ["p", p.agent, "", "agent"],
    ["a", coordinate(KIND.STORY, p.story.pubkey, p.story.d), "", "root"],
  ];
  if (p.parentId) tags.push(["e", p.parentId, "", "parent"]);
  tags.push(["gen", "model", p.model, "open"]);
  if (p.seed !== undefined) tags.push(["gen", "seed", String(p.seed)]);
  for (const r of p.refs ?? []) tags.push(["gen", "ref", r]);
  for (const l of p.loras ?? []) tags.push(["gen", "lora", l]);
  tags.push(
    ["duration", String(p.durationSec)],
    ["bid", String(p.bidSats), "sat"],
    ["license", p.license ?? DEFAULT_LICENSE],
    ["t", REELSTR_TAG],
  );
  return { kind: KIND.JOB_REQUEST, created_at: at(p.createdAt), tags, content: p.prompt };
}

export interface JobRequest {
  id?: string;
  requester: string;
  agent: string;
  prompt: string;
  storyCoord: string;
  parentId?: string;
  model: string;
  seed?: string;
  refs: string[];
  loras: string[];
  durationSec: number;
  bidSats: number;
  license: string;
}

export function parseJobRequest(e: EventLike): JobRequest {
  const gen = tagsOf(e.tags, "gen");
  return {
    id: e.id,
    requester: e.pubkey,
    agent: tagsOf(e.tags, "p").find((t) => t[3] === "agent")?.[1] ?? "",
    prompt: e.content,
    storyCoord: tagsOf(e.tags, "a").find((t) => t[3] === "root")?.[1] ?? "",
    parentId: tagsOf(e.tags, "e").find((t) => t[3] === "parent")?.[1],
    model: gen.find((g) => g[1] === "model")?.[2] ?? "",
    seed: gen.find((g) => g[1] === "seed")?.[2],
    refs: gen.filter((g) => g[1] === "ref").map((g) => g[2] ?? ""),
    loras: gen.filter((g) => g[1] === "lora").map((g) => g[2] ?? ""),
    durationSec: Number(tagValue(e.tags, "duration")),
    bidSats: Number(tagValue(e.tags, "bid")),
    license: tagValue(e.tags, "license") ?? "",
  };
}

export function validateJobRequest(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.JOB_REQUEST) c.err(`kind must be ${KIND.JOB_REQUEST}`);
  const j = parseJobRequest(e);
  if (!isHex64(j.agent)) c.err("p tag marked agent is required");
  if (j.agent === e.pubkey) c.err("an agent cannot commission itself");
  if (!/^31810:[0-9a-f]{64}:.+$/.test(j.storyCoord))
    c.err("a tag marked root must be a Story coordinate");
  if (!j.prompt.trim()) c.err("prompt (content) is required");
  if (!j.model) c.err("gen model is required");
  if (!Number.isFinite(j.durationSec) || j.durationSec < JOB_MIN_SEC || j.durationSec > JOB_MAX_SEC)
    c.err(`duration must be ${JOB_MIN_SEC}-${JOB_MAX_SEC} s`);
  if (!Number.isInteger(j.bidSats) || j.bidSats < 0)
    c.err("bid must be a non-negative integer (sats)");
  if (j.parentId !== undefined && !isHex64(j.parentId)) c.err("parent must be an event id");
  if (!isForkable(j.license) && j.parentId)
    c.err("a job continuing a scene needs a fork-friendly license");
  for (const r of [...j.refs, ...j.loras]) if (!isHex64(r)) c.err("gen ref/lora must be sha256");
  return c.result();
}

export interface JobResultParams {
  jobId: string;
  requester: string;
  status: "success" | "error";
  /** the agent's signed Scene (JSON) on success; a reason on error */
  content: string;
  sceneId?: string;
  createdAt?: number;
}

export function buildJobResult(p: JobResultParams): EventTemplate {
  const tags: string[][] = [
    ["e", p.jobId, "", "request"],
    ["p", p.requester],
    ["status", p.status],
  ];
  if (p.sceneId) tags.push(["e", p.sceneId, "", "scene"]);
  return { kind: KIND.JOB_RESULT, created_at: at(p.createdAt), tags, content: p.content };
}

export function parseJobResult(e: EventLike) {
  return {
    id: (e as { id?: string }).id,
    agent: e.pubkey,
    jobId: tagsOf(e.tags, "e").find((t) => t[3] === "request")?.[1] ?? "",
    sceneId: tagsOf(e.tags, "e").find((t) => t[3] === "scene")?.[1],
    requester: tagValue(e.tags, "p") ?? "",
    status: tagValue(e.tags, "status") ?? "",
    content: e.content,
  };
}

export function validateJobResult(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.JOB_RESULT) c.err(`kind must be ${KIND.JOB_RESULT}`);
  const r = parseJobResult(e);
  if (!isHex64(r.jobId)) c.err("missing e tag marked request");
  if (!isHex64(r.requester)) c.err("missing p tag for the requester");
  if (r.status !== "success" && r.status !== "error") c.err("status must be success|error");
  if (r.status === "success" && !isHex64(r.sceneId)) c.err("a successful result names its scene");
  return c.result();
}

/** NIP-24 `bot` profile flag (NP-6): agents say so in their kind 0. */
export function buildAgentProfile(o: {
  name: string;
  about: string;
  models: string[];
  priceSats: number;
  createdAt?: number;
}): EventTemplate {
  return {
    kind: 0,
    created_at: at(o.createdAt),
    tags: [["t", REELSTR_TAG]],
    content: JSON.stringify({
      name: o.name,
      about: o.about,
      bot: true,
      reelstr: { role: "agent", models: o.models, priceSats: o.priceSats },
    }),
  };
}

export function parseAgentProfile(
  e: EventLike,
): { name: string; bot: boolean; models: string[]; priceSats: number } | null {
  try {
    const j = JSON.parse(e.content) as {
      name?: string;
      bot?: boolean;
      reelstr?: { models?: string[]; priceSats?: number };
    };
    if (!j.bot) return null;
    return {
      name: j.name ?? "",
      bot: true,
      models: j.reelstr?.models ?? [],
      priceSats: j.reelstr?.priceSats ?? 0,
    };
  } catch {
    return null;
  }
}
