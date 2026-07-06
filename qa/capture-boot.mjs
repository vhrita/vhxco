/**
 * qa/capture-boot.mjs
 * Captures the boot → dolly sequence via the shared chromium pool (SwiftShader
 * renders WebGL).
 *
 * Two capture modes:
 *   1. Normal load (no flag) — captures the transparent-preloader LOADING moment
 *      mid-boot: the brain forming from afar behind the boot HUD.
 *   2. ?introDebug — deterministic dolly frames via window.__introDebug.setP(p):
 *        b) p=0    far start — whole brain framed
 *        c) p=0.5  mid dolly
 *        d) p=1    landing (f0)
 *      (Boot is force-completed in debug so the brain is fully formed.)
 *
 * Usage: node qa/capture-boot.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "screenshots", "phase4b2-rework");

const WS = process.env.POOL_WS || "ws://chromium-shared-rtl1qg:3100";
const BASE = process.env.QA_BASE_URL || "http://10.0.1.74:4321";

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
  console.log(`connected to pool ${WS}`);

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);

    // ── (a) LOADING moment — normal load, transparent preloader ─────────────
    // Capture mid-boot while the brain is forming (bootProgress ~0.85+) from
    // afar, behind the boot HUD. Poll the preFill bar width as the boot proxy.
    {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Wait until the boot fill bar reaches ~85% (brain birth window) but the
      // preloader hasn't finished yet.
      let grabbed = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        const s = await page.evaluate(() => {
          const fill = document.getElementById("preFill");
          const bar = document.querySelector(".pre-bar");
          const w = fill ? parseFloat(getComputedStyle(fill).width) || 0 : 0;
          const bw = bar ? parseFloat(getComputedStyle(bar).width) || 1 : 1;
          return {
            ratio: Math.min(w / bw, 1),
            done:
              document
                .getElementById("preloader")
                ?.classList.contains("done") ?? false,
          };
        });
        if (s.done) break;
        if (s.ratio >= 0.85) {
          await shot(page, "a-loading-brain-forming", vp);
          grabbed = true;
          break;
        }
        await sleep(80);
      }
      if (!grabbed) await shot(page, "a-loading-brain-forming", vp);
      await page.close();
    }

    // ── (b/c/d) deterministic dolly frames via ?introDebug ──────────────────
    {
      const page = await browser.newPage();
      await page.setViewport({ ...vp, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/?introDebug`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Wait for the debug hook to be installed by the engine.
      const t0 = Date.now();
      let ready = false;
      while (Date.now() - t0 < 15000) {
        ready = await page.evaluate(
          () => typeof window.__introDebug !== "undefined",
        );
        if (ready) break;
        await sleep(150);
      }
      if (!ready) {
        console.log("  WARN: __introDebug never appeared");
      }
      const startPos = await page.evaluate(
        () => window.__introDebug?.startPos?.() ?? null,
      );
      console.log(`  INTRO_START_POS = ${JSON.stringify(startPos)}`);

      const frames = [
        ["b-dolly-start", 0],
        ["c-dolly-mid", 0.5],
        ["d-landing", 1],
      ];
      for (const [label, p] of frames) {
        await page.evaluate((pp) => window.__introDebug?.setP?.(pp), p);
        // Let a few RAF frames render at the frozen p.
        await sleep(700);
        const cam = await page.evaluate(
          () => window.__introDebug?.cam?.() ?? null,
        );
        const dist = cam
          ? Math.hypot(cam[0], cam[1], cam[2]).toFixed(2)
          : "n/a";
        console.log(
          `  p=${p} cam=${JSON.stringify(cam?.map((v) => +v.toFixed(2)))} |cam|=${dist}`,
        );
        await shot(page, label, vp);
      }
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
