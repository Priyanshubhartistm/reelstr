import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BlossomClient } from "@reelstr/blossom";
import { Indexer } from "@reelstr/indexer";
import { createApi } from "@reelstr/indexer/src/server";
import { ingestScene, renderAndPublish } from "@reelstr/media-service";
import { createMediaServer } from "@reelstr/media-service/src/server";
import { LocalSigner } from "@reelstr/nostr";
import { cleanup, startBlossom, startRelay, tempDir } from "@reelstr/testkit";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { makeClip } from "../packages/media/test/helpers";

// Real browser (system Chrome, headless: never a window on the desktop) driving the built Studio
// and Cinema against real relay, Blossom, media service and indexer.
const ROOT = join(import.meta.dir, "..");
let browser: Browser;
let studioUrl: string;
let cinemaUrl: string;
let endpoints: Record<string, unknown>;
const procs: Bun.Subprocess[] = [];
const stops: (() => void | Promise<void>)[] = [];
const dir = tempDir();

async function serveApp(app: "studio" | "cinema") {
  const dist = join(ROOT, "apps", app, "dist");
  // always rebuild: a stale dist once hid a browser-only bug for a whole test run
  const b = Bun.spawnSync(["bunx", "vite", "build"], { cwd: join(ROOT, "apps", app) });
  if (b.exitCode !== 0) throw new Error(`${app} build failed: ${b.stderr.toString()}`);
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      const p = new URL(req.url).pathname;
      const f = Bun.file(join(dist, p === "/" ? "index.html" : p));
      return (await f.exists())
        ? new Response(f)
        : new Response(Bun.file(join(dist, "index.html")));
    },
  });
  stops.push(() => srv.stop(true));
  return `http://127.0.0.1:${srv.port}`;
}

beforeAll(async () => {
  const relay = await startRelay();
  const A = await startBlossom();
  const B = await startBlossom();
  const svc = LocalSigner.generate();
  process.env.PORT = "0";
  const media = createMediaServer({
    token: "tok",
    hosts: { primary: new BlossomClient(A.url, svc), mirrors: [new BlossomClient(B.url, svc)] },
    run: { ingest: ingestScene, render: renderAndPublish },
  });
  stops.push(() => media.stop(true));
  const ix = await Indexer.open();
  await ix.follow([relay.url]);
  const api = createApi(ix, 0);
  stops.push(
    () => api.stop(true),
    () => ix.close(),
  );
  endpoints = {
    relays: [relay.url],
    blossom: A.url,
    mirrors: [B.url],
    mediaUrl: `http://127.0.0.1:${media.port}`,
    mediaToken: "tok",
    indexerUrl: `http://127.0.0.1:${api.port}`,
    powBits: 0,
  };
  studioUrl = await serveApp("studio");
  cinemaUrl = await serveApp("cinema");
  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  for (const s of stops.reverse()) await s();
  for (const p of procs) p.kill();
  cleanup();
});

async function newUser(
  url: string,
): Promise<{ page: Page; ctx: BrowserContext; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.addInitScript(
    (e) => localStorage.setItem("reelstr.endpoints", JSON.stringify(e)),
    endpoints,
  );
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on(
    "console",
    (m) =>
      m.type() === "error" &&
      !/favicon|ERR_CONNECTION_REFUSED/.test(m.text()) &&
      errors.push(m.text()),
  );
  await page.goto(url);
  await page.getByRole("button", { name: "Generate a key" }).click();
  await page.getByText("I saved my key").click();
  await page.getByRole("button", { name: "Continue" }).click();
  return { page, ctx, errors };
}

const T = 120_000;

/** Run a wait; on failure throw with what the page was showing and its console errors. */
async function diagnose(u: { page: Page; errors: string[] }, f: () => Promise<unknown>) {
  try {
    await f();
  } catch (e) {
    const shown = await u.page
      .locator(".error")
      .allInnerTexts()
      .catch(() => []);
    throw new Error(
      `${(e as Error).message}\npage errors: ${JSON.stringify(shown)}\nconsole: ${JSON.stringify(u.errors.slice(0, 6))}`,
    );
  }
}

describe("Studio and Cinema in a real browser", () => {
  test("create story, publish a scene, fork it, curate an episode, watch it", async () => {
    const clipA = await makeClip(join(dir, "a.mp4"), {
      size: "640x360",
      fps: 24,
      sec: 12,
      freq: 330,
      gainDb: -22,
    });
    const clipB = await makeClip(join(dir, "b.mp4"), {
      size: "360x640",
      fps: 30,
      sec: 12,
      freq: 550,
      gainDb: -18,
    });

    // --- Studio: alice starts a story and adds the first scene
    const alice = await newUser(studioUrl);
    await alice.page.getByLabel("Title").first().fill("E2E Heist");
    await alice.page.getByLabel("Logline").fill("A crew, a door, a clock.");
    await alice.page.getByRole("button", { name: "Create story" }).click();
    await alice.page.getByRole("link", { name: /E2E Heist/ }).click({ timeout: T });
    await alice.page.getByRole("button", { name: "Add the first scene" }).click();
    await alice.page.locator("#c-file").setInputFiles(clipA);
    await alice.page.locator("#c-title").fill("The door");
    await alice.page.locator("#c-prompt").fill("a steel vault door, rain");
    await alice.page.locator("#c-model").fill("wan-2.2-t2v");
    await alice.page.locator("#c-seed").fill("828341");
    await alice.page.getByRole("button", { name: "Publish scene" }).click();
    await diagnose(alice, () => alice.page.getByText("Published.").waitFor({ timeout: 60_000 }));
    await alice.page.locator(".tree .node").first().waitFor({ timeout: T });
    expect(await alice.page.locator(".tree .node").count()).toBe(1);
    await alice.page.locator(".tree .node").first().click();
    await alice.page.getByText("re-render eligible").waitFor({ timeout: T });
    await alice.page.getByText("open weights").first().waitFor();
    const storyHash = new URL(alice.page.url()).hash;

    // --- Studio: bob forks it
    const bob = await newUser(studioUrl);
    await bob.page.goto(`${studioUrl}/${storyHash}`);
    await bob.page.locator(".tree .node").first().click({ timeout: T });
    await bob.page.getByRole("button", { name: "Fork / continue from here" }).click();
    await bob.page.getByText("the original creator is credited automatically").waitFor();
    await bob.page.locator("#c-file").setInputFiles(clipB);
    await bob.page.locator("#c-title").fill("Door, take two");
    await bob.page.locator("#c-prompt").fill("same door, night");
    await bob.page.getByRole("button", { name: "Publish fork" }).click();
    await bob.page.getByText("Published.").waitFor({ timeout: T });
    await bob.page.waitForFunction(
      () => document.querySelectorAll(".tree .node").length === 2,
      null,
      { timeout: T },
    );
    expect(await bob.page.locator(".tree .node").count()).toBe(2);

    // --- Cinema: cara curates both scenes into an episode
    const cara = await newUser(cinemaUrl);
    await cara.page.getByRole("link", { name: "Curator desk" }).click();
    await cara.page.locator("#d-story").selectOption({ label: "E2E Heist" });
    await cara.page.getByText("include scenes already used").click();
    await cara.page.getByRole("button", { name: "Add" }).first().waitFor({ timeout: T });
    await cara.page.getByRole("button", { name: "Add" }).nth(0).click();
    await cara.page.getByRole("button", { name: "Add" }).nth(1).click();
    await cara.page.locator("#m-slug").fill("e2e-heist");
    await cara.page.locator("#m-st").fill("E2E Heist");
    await cara.page.locator("#m-sum").fill("They reach the door.");
    await cara.page.locator("#m-t").fill("The door");
    await cara.page.locator("#m-f").fill("5");
    // trims: first clip 0..10, second 1..11 => creators 10 s each
    await cara.page.locator("#out0").fill("10");
    await cara.page.locator("#in1").fill("1");
    await cara.page.locator("#out1").fill("11");
    const split = cara.page.locator("table.split");
    await split.waitFor();
    expect(await split.locator("tfoot").innerText()).toContain("10000");
    expect(await split.locator("tbody tr").count()).toBe(4); // two creators + curator + host
    await cara.page.getByRole("button", { name: "Render and publish episode" }).click();
    await cara.page.getByText("Published episode 1.").waitFor({ timeout: 240_000 });

    // --- Cinema: a viewer opens the series and watches it
    const dan = await newUser(cinemaUrl);
    await dan.page.getByRole("link", { name: /E2E Heist/ }).click({ timeout: T });
    await dan.page.getByText(/Ep 1/).first().waitFor({ timeout: T });
    await dan.page.getByText("Credits and split").waitFor({ timeout: T });
    await dan.page.getByRole("link", { name: /Ep 1/ }).click();
    const video = dan.page.locator("video.player");
    await video.waitFor({ timeout: T });
    await dan.page.waitForFunction(
      () => {
        const v = document.querySelector("video.player") as HTMLVideoElement | null;
        return !!v && v.readyState >= 3 && v.currentTime > 0.5;
      },
      null,
      { timeout: T },
    );
    const info = await video.evaluate((v: HTMLVideoElement) => ({
      d: v.duration,
      w: v.videoWidth,
      h: v.videoHeight,
      t: v.currentTime,
    }));
    expect(info.d).toBeGreaterThan(19);
    expect(info.d).toBeLessThan(21);
    expect(info.h).toBeGreaterThan(info.w); // vertical
    // resume position is remembered for this viewer
    await Bun.sleep(2500);
    const saved = await dan.page.evaluate(() =>
      JSON.parse(localStorage.getItem("reelstr.progress") ?? "{}"),
    );
    expect(Object.keys(saved).length).toBe(1);

    for (const u of [alice, bob, cara, dan]) expect(u.errors).toEqual([]);
    for (const u of [alice, bob, cara, dan]) await u.ctx.close();
  }, 600_000);
});
