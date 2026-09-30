import { DEFAULT_LICENSE, KIND, REELSTR_TAG } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { isHex64, tagsOf, tagValue } from "./tags";

export interface StoryParams {
  d: string;
  title: string;
  logline: string;
  style?: string;
  license?: string;
  cast?: { name: string; refSha256?: string; description?: string }[];
  relays?: string[];
  createdAt?: number;
}

export function buildStory(p: StoryParams): EventTemplate {
  const tags: string[][] = [
    ["d", p.d],
    ["title", p.title],
    ["license", p.license ?? DEFAULT_LICENSE],
  ];
  if (p.style) tags.push(["style", p.style]);
  for (const c of p.cast ?? []) tags.push(["cast", c.name, c.refSha256 ?? "", c.description ?? ""]);
  for (const r of p.relays ?? []) tags.push(["r", r]);
  tags.push(["t", REELSTR_TAG]);
  return {
    kind: KIND.STORY,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: p.logline,
  };
}

export function validateStory(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.STORY) c.err(`kind must be ${KIND.STORY}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(tagValue(e.tags, "d") ?? ""))
    c.err("d must be a lowercase slug");
  if (!tagValue(e.tags, "title")) c.err("missing title");
  if (!e.content.trim()) c.err("logline (content) is required");
  if (!tagValue(e.tags, "license")) c.err("license tag is required");
  for (const t of tagsOf(e.tags, "cast")) {
    if (!t[1]) c.err("cast entry needs a name");
    if (t[2] && !isHex64(t[2])) c.err(`cast ${t[1]}: reference must be a sha256`);
  }
  if (!tagsOf(e.tags, "t").some((t) => t[1] === REELSTR_TAG)) c.err("missing t reelstr tag");
  return c.result();
}
