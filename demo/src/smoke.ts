import { chromium } from "playwright-core";

// Walks the running demo as a viewer: series list, free episode plays, paid one asks for sats.
const out = process.argv[2] ?? ".";
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await (await browser.newContext({ viewport: { width: 420, height: 860 } })).newPage();
await page.goto("http://127.0.0.1:5174");
await page.getByRole("button", { name: "Generate a key" }).click();
await page.getByText("I saved my key").click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText("The Last Signal").first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/1-home.png` });
await page.getByText("The Last Signal").first().click();
await page.getByText(/Ep 1/).first().waitFor({ timeout: 30_000 });
await page.screenshot({ path: `${out}/2-series.png` });
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
console.log("free episode plays");
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
await page.goto(watchUrl);
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
console.log("topped up with test sats and unlocked the paid episode");
await browser.close();
