import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { tempDir } from "@reelstr/testkit";
import { chromium } from "playwright-core";
import { makeScene } from "../src/footage";
import { demoKeys } from "../src/stack";

// The creator side of the walkthrough, against the running seeded demo.
const out = process.argv[2] ?? ".";
const keys = demoKeys();
const nsec = (n: string) => new LocalSigner(hexToBytes(keys[n] as string)).backup();
const web = process.env.WEB_URL ?? "http://127.0.0.1:5173";
// This script publishes forks, agent scenes and cuts. On a shared or public demo that is the clutter people see.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(web) && !process.env.ALLOW_LIVE_WRITES)
  throw new Error(
    `smoke-studio writes to ${web}; set ALLOW_LIVE_WRITES=1 if that is really what you want`,
  );
const dir = tempDir("reelstr-demo-smoke-");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const as = async (who: string) => {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  await ctx.addInitScript((k) => localStorage.setItem("reelstr.localkey", k as string), nsec(who));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => !/closed by us/.test(e.message) && errors.push(e.message));
  return { page, errors };
};
const step = (s: string) => console.log(`ok: ${s}`);

// 1. Dev forks a scene from the Studio tree
const dev = await as("dev");
await dev.page.goto(`${web}/#/stories`);
await dev.page.getByRole("link", { name: /The Last Signal/ }).click({ timeout: 60_000 });
// the seeded tree (any size: the seed may grow); the fork must add exactly one
await dev.page.locator(".tree .node").first().waitFor({ timeout: 60_000 });
await dev.page.waitForTimeout(1500);
const before = await dev.page.locator(".tree .node").count();
await dev.page.screenshot({ path: `${out}/s1-tree.png` });
await dev.page.locator(".tree .node", { hasText: "The Broadcast" }).click();
await dev.page.getByRole("button", { name: "Fork / continue from here" }).click();
const clip = await makeScene(join(dir, "fork.mp4"), {
  title: "NEW BRANCH",
  caption: "Dev continues the broadcast",
  c0: "0x102a3a",
  c1: "0xffd24a",
  freq: 247,
});
await dev.page.locator("#c-file").setInputFiles(clip);
await dev.page.locator("#c-title").fill("Reply");
await dev.page.locator("#c-prompt").fill("Wren answers the voice");
await dev.page.getByRole("button", { name: "Publish fork" }).click();
await dev.page.getByText("Published.").waitFor({ timeout: 120_000 });
await dev.page.waitForFunction(
  (n) => document.querySelectorAll(".tree .node").length === n + 1,
  before,
  {
    timeout: 60_000,
  },
);
await dev.page.screenshot({ path: `${out}/s2-forked.png` });
step(`fork from the tree: ${before} -> ${before + 1} scenes`);

// 2. Dev commissions the agent (needs test sats first)
await dev.page.locator("header.bar").getByRole("link", { name: "Wallet", exact: true }).click();
await dev.page.getByTestId("balance").waitFor({ timeout: 30_000 });
// the wallet is persistent on a deployed stack, so compare with where it started
const start = Number.parseInt(await dev.page.getByTestId("balance").innerText(), 10) || 0;
await dev.page.locator("#w-amt").fill("300");
await dev.page.getByRole("button", { name: "Get invoice" }).click();
await dev.page.getByText(`${start + 300} sats`, { exact: true }).waitFor({ timeout: 60_000 });
await dev.page.locator("header.bar").getByRole("link", { name: "Agents", exact: true }).click();
await dev.page.locator("#ag-agent option").nth(1).waitFor({ state: "attached", timeout: 30_000 });
await dev.page.locator("#ag-agent").selectOption({ index: 1 });
await dev.page.locator("#ag-story").selectOption({ label: "The Last Signal" });
await dev.page.locator("#ag-prompt").fill("the tower seen from a drone at dawn");
await dev.page.locator("#ag-seed").fill("7");
await dev.page.locator("#ag-dur").fill("6");
await dev.page.getByRole("button", { name: "Request scene" }).click();
await dev.page.getByTestId("delivery").waitFor({ timeout: 180_000 });
await dev.page.screenshot({ path: `${out}/s3-agent.png` });
await dev.page.getByRole("button", { name: /Accept and pay/ }).click();
await dev.page.getByText(/Accepted\. The scene is published/).waitFor({ timeout: 120_000 });
step("commissioned the agent, accepted, paid by nutzap");

// 3. Ila (curator) edits episode 1: replace a scene, publish a new version
const ila = await as("ila");
await ila.page.goto(`${web}/#/desk`);
await ila.page.locator("#d-story").selectOption({ label: "The Last Signal" });
await ila.page.getByLabel("Your published episodes").selectOption({ index: 1 });
await ila.page.getByRole("heading", { name: /Editing episode 1/ }).waitFor({ timeout: 30_000 });
await ila.page.getByRole("button", { name: "Replace" }).first().click();
await ila.page.getByRole("button", { name: "Use as scene 1" }).first().waitFor({ timeout: 30_000 });
await ila.page.getByRole("button", { name: "Use as scene 1" }).first().click();
await ila.page.screenshot({ path: `${out}/s4-desk.png` });
await ila.page.getByRole("button", { name: "Render and publish new version" }).click();
await ila.page.getByText("Published a new version of episode 1.").waitFor({ timeout: 240_000 });
step("curator replaced a scene and published a new version");

console.log("page errors:", JSON.stringify([...dev.errors, ...ila.errors]));
await browser.close();
