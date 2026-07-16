/**
 * qa/capture-noold.mjs
 * Proof rig for "old preloader removed": captures the LOADING moment (brain
 * forming on canvas, no old chrome) and the LANDING moment (dolly landed +
 * content revealed => bootComplete fired) via the shared chromium pool.
 *
 * Signals used (the old #preFill / #preloader.done are gone):
 *   - loading: body[data-intro="active"] present (dolly armed/running, brain
 *     forming). Grab an early-ish frame while intro is still active.
 *   - landing: body NOT [data-intro] (render-loop removed it on land +
 *     fired journey:intro-done) AND the core headline text is present.
 */
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

async function shot(page, label, vp) {
  const file = path.join(OUT_DIR, `${vp.name}-${label}.png`);
  await page.screenshot({ path: file });
  console.log(`  saved ${path.basename(file)}`);
}

// Probe for any old-chrome DOM. Should always be null/absent now.
async function oldChromeProbe(page) {
  return page.evaluate(() => ({
    preloader: !!document.getElementById("preloader"),
    preFill: !!document.getElementById("preFill"),
    preSys: !!document.getElementById("preSys"),
    preFlash: !!document.getElementById("preFlash"),
    preMark: !!document.querySelector(".pre-mark"),
    preBar: !!document.querySelector(".pre-bar"),
    preMeta: !!document.querySelector(".pre-meta"),
  }));
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  console.log(`connected to pool ${WS} base=${BASE}`);

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);

    // ── LOADING — grab while intro is active (brain forming, no old chrome) ──
    {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Wait for the intro to arm (body[data-intro="active"]).
      const t0 = Date.now();
      let armed = false;
      while (Date.now() - t0 < 8000) {
        armed = await page.evaluate(
          () => document.body.dataset.intro === "active",
        );
        if (armed) break;
        await sleep(60);
      }
      // Sit ~1.6s into the boot so the brain is visibly forming, still loading.
      await sleep(1600);
      const probeLoad = await oldChromeProbe(page);
      const introState = await page.evaluate(
        () => document.body.dataset.intro ?? "(none)",
      );
      console.log(`  loading: intro=${introState} oldChrome=${JSON.stringify(probeLoad)}`);
      await shot(page, "loading", vp);
      await page.close();
    }

    // ── LANDING — wait for intro-done (dolly landed + content revealed) ──────
    {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Wait until data-intro is gone (render-loop removes it on land).
      const t0 = Date.now();
      let landed = false;
      while (Date.now() - t0 < 20000) {
        landed = await page.evaluate(() => {
          const introGone = !document.body.hasAttribute("data-intro") ||
            document.body.dataset.intro !== "active";
          return introGone;
        });
        if (landed) break;
        await sleep(150);
      }
      // Settle the reveal animation.
      await sleep(1500);
      const probeLand = await oldChromeProbe(page);
      const headline = await page.evaluate(() => {
        const el = document.querySelector("[data-scramble], h1");
        return el ? (el.textContent || "").trim().slice(0, 80) : "(no headline)";
      });
      console.log(`  landing: landed=${landed} oldChrome=${JSON.stringify(probeLand)}`);
      console.log(`  landing headline: "${headline}"`);
      await shot(page, "landing", vp);
      await page.close();
    }
  }

  await browser.disconnect();
  console.log("\ndone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
