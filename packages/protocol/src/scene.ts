import { coordinate, parseCoordinate } from "./coords";
import { DEFAULT_LICENSE, KIND, REELSTR_TAG } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { imetaTag, isHex64, parseImeta, secs, tagsOf, tagValue } from "./tags";

/** Licenses that allow forking in Studio. Anything else can be watched but not forked. */
const FORK_FRIENDLY = /^(CC0-1\.0|CC-BY-4\.0|CC-BY-SA-4\.0|MIT|Apache-2\.0)$/;
export const isForkable = (license: string) => FORK_FRIENDLY.test(license);

export const SCENE_MAX_SEC = 20;
export const SCENE_TARGET_SEC: [number, number] = [10, 15];

export interface SceneParams {
  title: string;
  /** prompt / scene description / dialogue */
  content: string;
  video: {
    url: string;
    sha256: string;
    duration: number;
    dim?: string;
    fallback?: string[];
    /** poster frame (JPEG/PNG url). Some relays (Divine) refuse a video event without one. */
    thumbnail?: string;
  };
  audio?: { url: string; sha256: string; duration?: number; lang?: string };
  /** un-normalized upload kept by BE-1 */
  original?: { url: string; sha256: string };
  story: { pubkey: string; d: string; relay?: string };
  parent?: { id: string; relay?: string };
  license?: string;
  gen?: {
    model?: { name: string; open: boolean };
    seed?: string | number;
    refs?: string[];
    loras?: string[];
  };
  commissioner?: { pubkey: string; relay?: string };
  createdAt?: number;
}

export function buildScene(p: SceneParams): EventTemplate {
  const tags: string[][] = [
    ["d", p.video.sha256],
    ["title", p.title],
    imetaTag({
      url: p.video.url,
      x: p.video.sha256,
      m: "video/mp4",
      dim: p.video.dim ?? "1080x1920",
      duration: secs(p.video.duration),
      fallback: p.video.fallback?.join(" "),
      image: p.video.thumbnail,
    }),
  ];
  if (p.audio)
    tags.push(
      imetaTag({
        url: p.audio.url,
        x: p.audio.sha256,
        m: "audio/mp4",
        l: p.audio.lang ? `${p.audio.lang} ISO-639-1 ov` : undefined,
        duration: p.audio.duration === undefined ? undefined : secs(p.audio.duration),
      }),
    );
  if (p.original)
    tags.push(imetaTag({ url: p.original.url, x: p.original.sha256, variant: "original" }));
  tags.push(["a", coordinate(KIND.STORY, p.story.pubkey, p.story.d), p.story.relay ?? "", "root"]);
  if (p.parent) tags.push(["e", p.parent.id, p.parent.relay ?? "", "parent"]);
  tags.push(["license", p.license ?? DEFAULT_LICENSE]);
  if (p.gen?.model)
    tags.push(["gen", "model", p.gen.model.name, p.gen.model.open ? "open" : "closed"]);
  if (p.gen?.seed !== undefined) tags.push(["gen", "seed", String(p.gen.seed)]);
  for (const r of p.gen?.refs ?? []) tags.push(["gen", "ref", r]);
  for (const l of p.gen?.loras ?? []) tags.push(["gen", "lora", l]);
  if (p.commissioner)
    tags.push(["p", p.commissioner.pubkey, p.commissioner.relay ?? "", "commissioner"]);
  tags.push(["t", REELSTR_TAG]);
  return {
    kind: KIND.SCENE,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: p.content,
  };
}

export interface Scene {
  id?: string;
  author: string;
  title: string;
  content: string;
  videoSha: string;
  videoUrl: string;
  duration: number;
  audioSha?: string;
  storyCoord: string;
  parentId?: string;
  license: string;
  commissioner?: string;
  /** who is paid when this scene is used: commissioner for agent scenes, else the author */
  payee: string;
  gen: { model?: { name: string; open: boolean }; seed?: string; refs: string[]; loras: string[] };
}

function videoImeta(tags: string[][]) {
  return tagsOf(tags, "imeta")
    .map(parseImeta)
    .find((m) => m.m?.startsWith("video/") && !m.variant);
}

export function validateScene(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.SCENE) c.err(`kind must be ${KIND.SCENE}, got ${e.kind}`);
  const d = tagValue(e.tags, "d");
  const v = videoImeta(e.tags);
  if (!tagValue(e.tags, "title")) c.err("missing title tag");
  if (!v) c.err("missing video imeta");
  else {
    if (!isHex64(v.x)) c.err("video imeta x must be a sha256 hex");
    if (!v.url) c.err("video imeta missing url");
    if (d !== v.x) c.err("d tag must equal the video blob sha256");
    const dur = Number(v.duration);
    if (!Number.isFinite(dur) || dur <= 0) c.err("video imeta duration missing or invalid");
    else if (dur > SCENE_MAX_SEC) c.err(`scene longer than ${SCENE_MAX_SEC}s (${dur}s)`);
    else if (dur < SCENE_TARGET_SEC[0] || dur > SCENE_TARGET_SEC[1])
      c.warn(`duration ${dur}s outside the ${SCENE_TARGET_SEC.join("-")}s target`);
    if (v.dim && v.dim !== "1080x1920") c.warn(`dim ${v.dim} is not normalized 1080x1920`);
  }
  for (const a of tagsOf(e.tags, "imeta").map(parseImeta)) {
    if (a.m?.startsWith("audio/") && !isHex64(a.x)) c.err("audio imeta x must be a sha256 hex");
  }
  const license = tagValue(e.tags, "license");
  if (!license) c.err("license tag is required");
  const root = tagsOf(e.tags, "a").find((t) => t[3] === "root");
  if (!root) c.err("missing a tag marked root (story)");
  else {
    const co = parseCoordinate(root[1] ?? "");
    if (!co || co.kind !== KIND.STORY) c.err("root a tag must be a Story coordinate");
  }
  const parents = tagsOf(e.tags, "e").filter((t) => t[3] === "parent");
  if (parents.length > 1) c.err("at most one parent");
  for (const p of parents) {
    if (!isHex64(p[1])) c.err("parent e tag must be an event id");
    if (e.id && p[1] === e.id) c.err("scene cannot be its own parent");
  }
  if (!tagsOf(e.tags, "t").some((t) => t[1] === REELSTR_TAG)) c.err("missing t reelstr tag");
  for (const g of tagsOf(e.tags, "gen")) {
    if (g[1] === "model" && g[3] !== "open" && g[3] !== "closed")
      c.err("gen model needs an open|closed flag");
    if ((g[1] === "ref" || g[1] === "lora") && !isHex64(g[2]))
      c.err(`gen ${g[1]} must be a sha256`);
  }
  const com = tagsOf(e.tags, "p").find((t) => t[3] === "commissioner");
  if (com && !isHex64(com[1])) c.err("commissioner pubkey invalid");
  return c.result();
}

export function parseScene(e: EventLike): Scene {
  const v = videoImeta(e.tags);
  if (!v) throw new Error("not a scene: no video imeta");
  const audio = tagsOf(e.tags, "imeta")
    .map(parseImeta)
    .find((m) => m.m?.startsWith("audio/"));
  const model = tagsOf(e.tags, "gen").find((g) => g[1] === "model");
  const commissioner = tagsOf(e.tags, "p").find((t) => t[3] === "commissioner")?.[1];
  return {
    id: e.id,
    author: e.pubkey,
    title: tagValue(e.tags, "title") ?? "",
    content: e.content,
    videoSha: v.x ?? "",
    videoUrl: v.url ?? "",
    duration: Number(v.duration),
    audioSha: audio?.x,
    storyCoord: tagsOf(e.tags, "a").find((t) => t[3] === "root")?.[1] ?? "",
    parentId: tagsOf(e.tags, "e").find((t) => t[3] === "parent")?.[1],
    license: tagValue(e.tags, "license") ?? "",
    commissioner,
    payee: commissioner ?? e.pubkey,
    gen: {
      model: model?.[2] ? { name: model[2], open: model[3] === "open" } : undefined,
      seed: tagsOf(e.tags, "gen").find((g) => g[1] === "seed")?.[2],
      refs: tagsOf(e.tags, "gen")
        .filter((g) => g[1] === "ref")
        .map((g) => g[2] ?? ""),
      loras: tagsOf(e.tags, "gen")
        .filter((g) => g[1] === "lora")
        .map((g) => g[2] ?? ""),
    },
  };
}

/**
 * Manifest is eligible for a re-render check: every gen tag names an open-weight model and
 * all refs/LoRAs are hashed. This is eligibility, not proof: see DEVIATIONS.md
 * ("Source Verified" = pinned-container same-arch re-render or perceptual match).
 */
export function manifestEligibleForVerification(e: EventLike): boolean {
  const gens = tagsOf(e.tags, "gen");
  const model = gens.find((g) => g[1] === "model");
  return (
    !!model &&
    model[3] === "open" &&
    gens.some((g) => g[1] === "seed") &&
    gens.filter((g) => g[1] === "ref" || g[1] === "lora").every((g) => isHex64(g[2]))
  );
}
