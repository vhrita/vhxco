/**
 * capture-mural-fix.mjs — validate PROVA mural tiles fit at 375 (no clip),
 * and stay side-by-side at 1280.
 *
 * Navigates to the Prova stop (index 4) via the app's journey API:
 *   window.__journey.setJourneyProgress(window.__journey.journey.stopProgress(4))
 * (falls back to the hud:goto-phase event if that shape is unavailable).
 *
 * For each viewport it captures a full-viewport PNG and geometrically checks
 * that every .stop-tile rect is fully inside its .stop-tiles container rect
 * (right edge does not overflow) and inside the viewport.
 *
 * Usage: node qa/capture-mural-fix.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/mural-fix");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];

const BOOT_WAIT_MS = 6000;
const PROVA_INDEX = 4;

async function waitRAFs(page, count) {
  await page.evaluate((n) => {
    return new Promise((resolve) => {
      let remaining = n;
      function tick() {
        if (--remaining <= 0) resolve(undefined);
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, count);
}

async function gotoProva(page) {
  const via = await page.evaluate((idx) => {
    const j = window.__journey;
    try {
      if (j && typeof j.setJourneyProgress === "function") {
        const journey = j.journey ?? j;
        if (journey && typeof journey.stopProgress === "function") {
          j.setJourneyProgress(journey.stopProgress(idx));
          return "setJourneyProgress";
        }
        if (typeof j.stopProgress === "function") {
          j.setJourneyProgress(j.stopProgress(idx));
          return "setJourneyProgress-flat";
        }
      }
    } catch (e) {
      /* fall through */
    }
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: idx } }),
    );
    return "hud:goto-phase";
  }, PROVA_INDEX);
  await new Promise((r) => setTimeout(r, 1600));
  await waitRAFs(page, 6);
  return via;
}

async function measureMural(page) {
  return page.evaluate((idx) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${idx}"]`);
    const scope = stop ?? document;
    const list = scope.querySelector(".stop-tiles");
    if (!list) return { error: "no .stop-tiles found", activeStop: document.body.dataset.activeStop };
    const listRect = list.getBoundingClientRect();
    const cs = getComputedStyle(list);
    const tiles = Array.from(scope.querySelectorAll(".stop-tile")).map((t) => {
      const r = t.getBoundingClientRect();
      const name = t.querySelector(".stop-tile-name")?.textContent?.trim();
      return {
        name,
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        width: +r.width.toFixed(1),
        // overflow past container right edge (px). >0.5 means clipped/spilled.
        overflowRight: +(r.right - listRect.right).toFixed(1),
        overflowLeft: +(listRect.left - r.left).toFixed(1),
        pastViewportRight: +(r.right - window.innerWidth).toFixed(1),
        visible: r.width > 0 && r.height > 0,
      };
    });
    return {
      activeStop: document.body.dataset.activeStop,
      flexDirection: cs.flexDirection,
      display: cs.display,
      list: {
        left: +listRect.left.toFixed(1),
        right: +listRect.right.toFixed(1),
        width: +listRect.width.toFixed(1),
      },
      innerWidth: window.innerWidth,
      tileCount: tiles.length,
      tiles,
    };
  }, PROVA_INDEX);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const versionRes = await fetch(`${POOL_HTTP}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();
  console.log("Connecting to pool:", webSocketDebuggerUrl);

  const browser = await puppeteer.connect({
    browserWSEndpoint: webSocketDebuggerUrl,
  });

  const results = [];
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\n=== Viewport ${vp.name} ===`);
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

    // Fire nav a couple times with generous settle; the journey easing can
    // need a moment before body.dataset.activeStop flips to 4.
    let via = await gotoProva(page);
    for (let attempt = 0; attempt < 6; attempt++) {
      const active = await page.evaluate(() => document.body.dataset.activeStop);
      if (active === "4") break;
      via = await gotoProva(page);
      await new Promise((r) => setTimeout(r, 700));
    }
    await new Promise((r) => setTimeout(r, 600));
    const m = await measureMural(page);

    const filename = `prova_${vp.name}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, filename) });

    const overflowers = (m.tiles ?? []).filter(
      (t) => t.overflowRight > 0.5 || t.pastViewportRight > 0.5,
    );
    const rec = { viewport: vp.name, nav: via, filename, ...m, overflowers };
    results.push(rec);

    console.log(`  nav via: ${via}  activeStop=${m.activeStop}`);
    console.log(`  list flex-direction=${m.flexDirection} width=${m.list?.width} innerWidth=${m.innerWidth}`);
    console.log(`  tiles: ${m.tileCount}`);
    for (const t of m.tiles ?? []) {
      console.log(
        `    "${t.name}" w=${t.width} right=${t.right} overflowRight=${t.overflowRight} pastVP=${t.pastViewportRight} visible=${t.visible}`,
      );
    }
    console.log(`  overflowers: ${overflowers.length}`);
    await page.close();
  }

  browser.disconnect();
  fs.writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("\nDone. Screenshots + results.json in", OUT_DIR);
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
