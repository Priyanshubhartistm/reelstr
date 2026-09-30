import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Ev, Indexer } from "../src";
import { createApi } from "../src/server";

const FIX = join(import.meta.dir, "../../../packages/protocol/fixtures/valid");
const events = readdirSync(FIX).map(
  (f) => (JSON.parse(readFileSync(join(FIX, f), "utf8")) as { event: Ev }).event,
);
const ix = await Indexer.open();
for (const e of events) await ix.ingest(e);
const srv = createApi(ix, 0);
const base = `http://127.0.0.1:${srv.port}`;
afterAll(async () => {
  srv.stop(true);
  await ix.close();
});
const get = async (p: string) => (await fetch(base + p)).json();

describe("indexer read API", () => {
  test("health, stories, tree, credits, earnings, inbox, series", async () => {
    expect((await get("/health")) as { ok: boolean }).toMatchObject({ ok: true });
    const stories = (await get("/stories")) as { coord: string }[];
    expect(stories.length).toBe(1);
    const tree = (await get(
      `/stories/${encodeURIComponent(stories[0]?.coord as string)}/tree`,
    )) as unknown[];
    expect(tree.length).toBe(4);
    const cut = events.find(
      (e) => e.kind === 31811 && e.tags.some((t) => t[0] === "d" && t[1]?.endsWith("ep-003")),
    ) as Ev;
    const cr = (await get(`/cuts/${cut.id}/credits`)) as { percent: number }[];
    expect(cr.reduce((a, c) => a + c.percent, 0)).toBeCloseTo(100);
    const scenes = (await get(`/cuts/${cut.id}/scenes`)) as unknown[];
    expect(scenes.length).toBe(8);
    const payee = cut.tags.find((t) => t[0] === "scene")?.[5] as string;
    expect(await get(`/earnings/${payee}`)).toMatchObject({ receivedMsats: 434000 });
    expect((await get(`/inbox?curator=${cut.pubkey}`)) as unknown[]).toEqual([]);
    const series = (await get("/series")) as { coord: string }[];
    const eps = (await get(
      `/series/${encodeURIComponent(series[0]?.coord as string)}/episodes`,
    )) as unknown[];
    expect(eps.length).toBe(2);
  });
  test("errors: missing param 400, unknown route 404, CORS header set", async () => {
    expect((await fetch(`${base}/inbox`)).status).toBe(400);
    const r = await fetch(`${base}/nope`);
    expect(r.status).toBe(404);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
});
