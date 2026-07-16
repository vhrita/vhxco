/**
 * qa/capture-perf.mjs
 * Phase 4b-2 perf proof: capture the landing frame (normal motion) and a
 * reduced-motion static frame at 1920x1080 and 375x667, to show the perf work
 * (fps cap / offscreen pause / half-res bloom / detail-3 somas / reduced-motion
 * static render) did NOT regress the approved look (brain + content + nav).
 *
 * Real perf/lag is validated by Vitor's smoke on real GPU — the pool runs
 * SwiftShader (software GL), so fps here is meaningless. These are look-proof
 * frames only.
 *
 * Signals:
 *   - normal landing: body no longer [data-intro="active"] (dolly landed +
 *     journey:intro-done fired) → brain formed at f(0), content revealed.
 *   - reduced-motion: emulated via CDP; render-loop paints one static settle
 *     frame of the fully-formed brain then stops the loop. We still expect the
 *     brain + revealed content in the frame.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "screenshots", "phase4b2-perf");

const WS = process.env.POOL_WS || "ws://chromium-shared-rtl1qg:3100";
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4330";

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

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  console.log(`connected to pool ${WS} base=${BASE}`);

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);

    // ── NORMAL — landing (dolly landed + content revealed) ──────────────────
    {
      const page = await browser.newPage();
      // Pool tabs open backgrounded → rAF throttles to ~1fps and the boot+dolly
      // (wall-clock ~6.8s) never lands within a sane window. Foreground the tab.
      await page.bringToFront();
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const t0 = Date.now();
      let landed = false;
      while (Date.now() - t0 < 30000) {
        landed = await page.evaluate(
          () => document.body.dataset.intro !== "active",
        );
        if (landed) break;
        await sleep(200);
      }
      await sleep(3500); // settle reveal (scramble + opacity transitions)
      const headline = await page.evaluate(() => {
        const el = document.querySelector("[data-scramble], h1");
        return el ? (el.textContent || "").trim().slice(0, 80) : "(no headline)";
      });
      const hasCanvas = await page.evaluate(
        () => !!document.getElementById("webgl"),
      );
      console.log(
        `  normal landing: landed=${landed} canvas=${hasCanvas} headline="${headline}"`,
      );
      await shot(page, "normal-landing", vp);
      await page.close();
    }

    // ── REDUCED-MOTION — one static settle frame (brain formed + content) ────
    {
      const page = await browser.newPage();
      await page.bringToFront();
      // Emulate prefers-reduced-motion: reduce
      await page.emulateMediaFeatures([
        { name: "prefers-reduced-motion", value: "reduce" },
      ]);
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // In reduced-motion the intro is skipped + content revealed immediately;
      // the loop draws one static frame then stops. Give it a beat to paint.
      await sleep(2500);
      const introState = await page.evaluate(
        () => document.body.dataset.intro ?? "(none)",
      );
      const headline = await page.evaluate(() => {
        const el = document.querySelector("[data-scramble], h1");
        return el ? (el.textContent || "").trim().slice(0, 80) : "(no headline)";
      });
      console.log(
        `  reduced-motion: intro=${introState} headline="${headline}"`,
      );
      await shot(page, "reduced-motion-static", vp);
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
