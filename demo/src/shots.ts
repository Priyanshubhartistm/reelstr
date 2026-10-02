import { hexToBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { chromium } from "playwright-core";
import { demoKeys } from "./stack";

/**
 * Screenshot every screen of both apps, desktop and phone width, against the running seeded demo.
 *   bun demo/src/shots.ts <outdir> [filter]
 */
const out = process.argv[2] ?? ".";
const only = process.argv[3];
const web = process.env.WEB_URL ?? "http://127.0.0.1:5173";
const api = process.env.INDEXER_URL ?? "http://127.0.0.1:3300";
const k = demoKeys();
const nsec = (n: string) => new LocalSigner(hexToBytes(k[n] as string)).backup();

const series = (await (await fetch(`${api}/series`)).json()) as { coord: string; title: string }[];
const sc = (series.find((x) => x.title === "The Last Signal") ?? series[0])?.coord as string;
const eps = (await (await fetch(`${api}/series/${encodeURIComponent(sc)}/episodes`)).json()) as {
  coord: string;
}[];
const stories = (await (await fetch(`${api}/stories`)).json()) as { coord: string }[];
const st = stories[0]?.coord as string;
const e = encodeURIComponent;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});

type Shot = {
  name: string;
  app: string;
  hash: string;
  who?: string;
  wait?: string;
  act?: (p: import("playwright-core").Page) => Promise<void>;
};
const shots: Shot[] = [
  { name: "landing", app: web, hash: "" },
  { name: "gate", app: web, hash: "#/signin" },
  { name: "c-home", app: web, hash: "#/", who: "mara", wait: ".cover" },
  { name: "c-series", app: web, hash: `#/series/${e(sc)}`, who: "mara", wait: ".ep" },
  {
    name: "c-watch-free",
    app: web,
    hash: `#/watch/${e(eps[0]?.coord ?? "")}`,
    who: "mara",
    wait: "video.player",
  },
  {
    name: "c-watch-paid",
    app: web,
    hash: `#/watch/${e(eps[1]?.coord ?? "")}`,
    who: "mara",
    wait: "[data-testid=paywall]",
  },
  { name: "c-wallet", app: web, hash: "#/wallet", who: "mara", wait: "[data-testid=balance]" },
  { name: "c-desk", app: web, hash: "#/desk", who: "ila", wait: "#d-story" },
  {
    name: "c-desk-filled",
    app: web,
    hash: "#/desk",
    who: "ila",
    wait: "#d-story",
    act: async (p) => {
      await p.locator("#d-story").selectOption({ index: 1 });
      await p.getByText("include scenes already used").click();
      await p.getByRole("button", { name: "Add" }).first().waitFor({ timeout: 30000 });
      await p.getByRole("button", { name: "Add" }).nth(0).click();
      await p.getByRole("button", { name: "Add" }).nth(1).click();
      await p.waitForTimeout(1200);
    },
  },
  { name: "c-settings", app: web, hash: "#/settings", who: "mara", wait: "#v-add" },
  { name: "s-stories", app: web, hash: "#/stories", who: "mara", wait: ".cover, .card" },
  {
    name: "s-story",
    app: web,
    hash: `#/story/${e(st)}`,
    who: "mara",
    wait: ".tree .node",
    act: async (p) => {
      await p.locator(".tree .node").first().click();
      await p.waitForTimeout(800);
    },
  },
  { name: "s-compose", app: web, hash: `#/compose/${e(st)}`, who: "mara", wait: "#c-file" },
  { name: "s-agents", app: web, hash: "#/agents", who: "mara", wait: "#ag-agent" },
  { name: "s-crew", app: web, hash: "#/crew", who: "mara" },
  { name: "s-earnings", app: web, hash: "#/earnings", who: "mara" },
  { name: "s-wallet", app: web, hash: "#/wallet", who: "mara", wait: "[data-testid=balance]" },
];

for (const [label, w, h] of [
  ["d", 1280, 900],
  ["m", 400, 860],
] as const) {
  for (const s of shots) {
    if (only && !s.name.includes(only)) continue;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
    });
    if (s.who)
      await ctx.addInitScript(
        (n) => localStorage.setItem("reelstr.localkey", n as string),
        nsec(s.who),
      );
    const page = await ctx.newPage();
    try {
      await page.goto(s.app + (s.hash || ""));
      if (s.wait) await page.locator(s.wait).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1200);
      await s.act?.(page);
      await page.screenshot({ path: `${out}/${s.name}-${label}.png`, fullPage: true });
      console.log("ok", s.name, label);
    } catch (err) {
      console.log("FAIL", s.name, label, (err as Error).message.split("\n")[0]);
      await page.screenshot({ path: `${out}/${s.name}-${label}-FAIL.png` }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
