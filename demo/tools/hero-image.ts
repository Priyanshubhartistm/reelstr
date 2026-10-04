import { hexToBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { chromium } from "playwright-core";
import { demoKeys } from "../src/stack";

/**
 * The README picture: the app in a desktop window next to three phone screens.
 *   WEB_URL=... INDEXER_URL=... bun demo/tools/hero-image.ts docs/screenshots
 * Defaults to the live testnet demo.
 */
const out = process.argv[2] ?? "docs/screenshots";
const web = process.env.WEB_URL ?? "https://reelstr.ansht.workers.dev";
const api = process.env.INDEXER_URL ?? "https://4-194-209-138.sslip.io/reelstr/api";
const e = encodeURIComponent;
const nsec = new LocalSigner(hexToBytes(demoKeys().mara as string)).backup();

const series = (await (await fetch(`${api}/series`)).json()) as { coord: string; title: string }[];
const sc = (series.find((x) => x.title === "The Last Signal") ?? series[0])?.coord as string;
const eps = (await (await fetch(`${api}/series/${e(sc)}/episodes`)).json()) as { coord: string }[];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});

async function shot(w: number, h: number, hash: string, signedIn: boolean, wait: string) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  if (signedIn) await ctx.addInitScript((n) => localStorage.setItem("reelstr.localkey", n), nsec);
  await ctx.addInitScript(() => localStorage.setItem("reelstr.guide.closed", "1"));
  const p = await ctx.newPage();
  await p.goto(web + hash);
  await p.locator(wait).first().waitFor({ timeout: 30_000 });
  await p.waitForTimeout(2500);
  const png = (await p.screenshot()).toString("base64");
  await ctx.close();
  return `data:image/png;base64,${png}`;
}

const D = [1440, 900] as const;
const P = [390, 844] as const;
const desk = await shot(...D, "", false, "h1");
const home = await shot(...P, "#/", true, ".cover");
const paywall = await shot(
  ...P,
  `#/watch/${e(eps[1]?.coord ?? "")}`,
  true,
  "[data-testid=paywall]",
);
const wallet = await shot(...P, "#/wallet", true, "[data-testid=balance]");

const ctx = await browser.newContext({
  viewport: { width: 1800, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await page.setContent(`<!doctype html><meta charset=utf-8><style>
body{margin:0;width:1800px;height:1000px;background:#2f4a3a;display:flex;align-items:center;justify-content:center;gap:40px;font-family:system-ui}
.win{width:900px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 30px 80px #0008}
.top{height:34px;background:#e8e2d2;display:flex;align-items:center;gap:8px;padding:0 14px}
.top i{width:12px;height:12px;border-radius:50%;background:#c9c1ac}
.win img{display:block;width:100%}
.phones{display:flex;gap:20px}
.ph{width:216px;border-radius:34px;border:8px solid #111;overflow:hidden;background:#111;box-shadow:0 30px 80px #0008}
.ph img{display:block;width:100%}
.ph:nth-child(2){transform:translateY(-34px)}
</style>
<div class=win><div class=top><i></i><i></i><i></i></div><img src="${desk}"></div>
<div class=phones><div class=ph><img src="${home}"></div><div class=ph><img src="${paywall}"></div><div class=ph><img src="${wallet}"></div></div>`);
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/showcase.png` });
await browser.close();
console.log("wrote", `${out}/showcase.png`);
