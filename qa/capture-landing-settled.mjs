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
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for intro-done, then settle a long time so the reveal fully lands.
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const gone = await page.evaluate(
        () => document.body.dataset.intro !== "active",
      );
      if (gone) break;
      await sleep(150);
    }
    await sleep(5000); // long settle for scramble + opacity transition
    const info = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const h1 = q("h1") || q("[data-scramble]");
      const cs = h1 ? getComputedStyle(h1) : null;
      const stopEls = Array.from(document.querySelectorAll(".journey-stop"));
      const stop0 = stopEls[0] ? getComputedStyle(stopEls[0]) : null;
      return {
        headlineText: h1 ? (h1.textContent || "").trim().slice(0, 90) : null,
        headlineOpacity: cs ? cs.opacity : null,
        stop0Opacity: stop0 ? stop0.opacity : null,
        introAttr: document.body.dataset.intro ?? "(none)",
        activeStop: document.body.dataset.activeStop ?? "(none)",
      };
    });
    console.log(`${vp.name}: ${JSON.stringify(info)}`);
    await page.screenshot({
      path: path.join(OUT_DIR, `${vp.name}-landing-settled.png`),
    });
    await page.close();
  }
  await browser.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
