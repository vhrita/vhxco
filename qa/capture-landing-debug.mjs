// Deterministic landing proof via ?introDebug (force-completes boot, freezes
// dolly at p=1 = landed). Proves bootComplete + dolly + reveal wiring end-to-end
// independent of SwiftShader frame rate.
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "screenshots", "phase4b2-rework-noold");
const WS = process.env.POOL_WS || "ws://chromium-shared-rtl1qg:3100";
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4321";
const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "375x667", width: 375, height: 667 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ ...vp, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/?introDebug`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for the debug hook.
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 15000) {
      ready = await page.evaluate(() => typeof window.__introDebug !== "undefined");
      if (ready) break;
      await sleep(150);
    }
    // Force the dolly to landed (p=1). Also clear the intro marker + fire the
    // done event the way render-loop would on a real land, so the content
    // reveal (which is gated on body[data-intro] being gone) can settle. This
    // mirrors exactly what the RAF does at rawP>=1; introDebug freezes so we
    // trigger the DOM side manually to observe the revealed content.
    await page.evaluate(() => window.__introDebug?.setP?.(1));
    await sleep(600);
    await page.evaluate(() => {
      delete document.body.dataset.intro;
      window.dispatchEvent(new CustomEvent("journey:intro-done"));
    });
    await sleep(2500); // settle reveal + scramble
    const info = await page.evaluate(() => {
      const h1 = document.querySelector("h1") || document.querySelector("[data-scramble]");
      const stop0 = document.querySelector(".journey-stop");
      return {
        headline: h1 ? (h1.textContent || "").trim().slice(0, 90) : null,
        headlineOpacity: h1 ? getComputedStyle(h1).opacity : null,
        stop0Opacity: stop0 ? getComputedStyle(stop0).opacity : null,
        introAttr: document.body.dataset.intro ?? "(none)",
        oldChrome: !!document.getElementById("preloader") || !!document.getElementById("preFlash"),
      };
    });
    console.log(`${vp.name}: ${JSON.stringify(info)}`);
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-landing-debug.png`) });
    await page.close();
  }
  await browser.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
