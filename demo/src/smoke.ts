import { chromium, webkit } from "playwright-core";

// Walks the running demo as a viewer: series list, free episode plays, paid one asks for sats.
//   WEBKIT_WS=ws://127.0.0.1:3999/   drive Playwright's WebKit (infra/webkit) instead of Chrome
//   NETWORK=4g|slow-4g|3g            Chrome only: throttle with DevTools network emulation (a simulation)
const out = process.argv[2] ?? ".";
const browser = process.env.WEBKIT_WS
  ? await webkit.connect(process.env.WEBKIT_WS)
  : await chromium.launch({
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
const page = await ctx.newPage();
// ms latency, kbit/s down, kbit/s up (the figures Chrome DevTools and WebPageTest use)
const PROFILES: Record<string, [number, number, number]> = {
  "4g": [70, 9000, 9000],
  "slow-4g": [150, 1600, 750],
  "3g": [300, 400, 400],
};
const net = process.env.NETWORK ? PROFILES[process.env.NETWORK] : undefined;
if (process.env.NETWORK && !net) throw new Error(`NETWORK must be one of ${Object.keys(PROFILES)}`);
if (net && !process.env.WEBKIT_WS) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: net[0],
    downloadThroughput: (net[1] * 1000) / 8,
    uploadThroughput: (net[2] * 1000) / 8,
  });
  console.log(
    `network: ${process.env.NETWORK} (${net[0]} ms, ${net[1]} down / ${net[2]} up kbit/s)`,
  );
}
const engine = process.env.WEBKIT_WS ? "webkit" : "chrome";
const t = () => performance.now();
await page.goto(process.env.CINEMA_URL ?? "http://127.0.0.1:5174");
await page.getByRole("button", { name: "Generate a key" }).click();
await page.getByText("I saved my key").click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText("The Last Signal").first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/1-home.png` });
await page.getByText("The Last Signal").first().click();
await page.getByText(/Ep 1/).first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/2-series.png` });
const t0 = t();
await page.getByText(/Ep 1/).first().click();
await page.waitForFunction(
  () => {
    const v = document.querySelector("video.player") as HTMLVideoElement | null;
    return !!v && v.readyState >= 3 && v.currentTime > 0.5;
  },
  null,
  { timeout: 60_000 },
);
await page.screenshot({ path: `${out}/3-playing.png` });
console.log(`free episode plays (${engine}): first frame ${Math.round(t() - t0)} ms after the tap`);
await page.goBack();
await page.getByText(/Ep 2/).first().click();
await page
  .getByRole("button", { name: /unlock/i })
  .first()
  .waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/4-paywall.png` });
console.log("paid episode shows the paywall");
const watchUrl = page.url();
await page.getByRole("link", { name: "Top up" }).click();
await page.getByTestId("balance").waitFor({ timeout: 30_000 });
await page.locator("#w-amt").fill("100");
await page.getByRole("button", { name: "Get invoice" }).click();
await page.getByText("100 sats", { exact: true }).waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${out}/5-wallet.png` });
await page.getByRole("button", { name: "Pay ₹100 (demo)" }).click();
await page.getByText("200 sats", { exact: true }).waitFor({ timeout: 60_000 });
console.log("fiat demo partner credited 100 sats");
await page.goto(watchUrl);
const t1 = t();
await page.getByRole("button", { name: "Unlock for 21 sats" }).click();
await page.waitForFunction(
  () => {
    const v = document.querySelector("video.player") as HTMLVideoElement | null;
    return !!v && v.readyState >= 3 && v.currentTime > 0.5;
  },
  null,
  { timeout: 60_000 },
);
await page.screenshot({ path: `${out}/6-unlocked.png` });
console.log(
  `topped up with test sats and unlocked the paid episode (${engine}): unlock to playing ${Math.round(t() - t1)} ms`,
);
// the AI scene in this episode carries the verifier's label (the apps trust the demo verifier)
await page
  .getByTestId("source-row")
  .filter({ hasText: "Source Verified" })
  .waitFor({ timeout: 60_000 });
await page.screenshot({ path: `${out}/7-verified.png`, fullPage: true });
console.log("Source Verified badge shown on the AI scene");
await browser.close();
