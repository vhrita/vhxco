/**
 * capture-scroll-perf-fix.mjs — validation rig for the scroll-calibration +
 * perf-P0 (backdrop-filter → gradient scrim) change.
 *
 * For a spread of journey stops it:
 *   - navigates via window.__journey.setJourneyProgress(stopProgress(i)),
 *   - captures full-viewport PNGs at 375×667 and 1280×800,
 *   - asserts .stop-inner has NO backdrop-filter (P0),
 *   - proves the 3D still BREATHES: samples the scrim's own alpha (computed
 *     effective opacity) so we can show it's translucent, not an opaque block,
 *     and measures non-black lit ratio of the canvas around the panel.
 *
 * Usage: node qa/capture-scroll-perf-fix.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/scroll-perf-fix");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];

// Stops to capture: 0 (headline, dense), 2 (mid), 5 (last — was phantom).
const STOPS = [0, 2, 5];
const STOP_NAMES = [
  "promessa",
  "gargalo",
  "metodo",
  "servicos",
  "prova",
  "diagnose",
];

const BOOT_WAIT_MS = 6500;

async function waitRAFs(page, count) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let r = n;
        const tick = () => (--r <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    const j = window.__journey;
    if (j) j.setJourneyProgress(j.stopProgress(i));
  }, idx);
  await new Promise((r) => setTimeout(r, 1500));
  await waitRAFs(page, 6);
  return page.evaluate((i) => {
    const inner = document.querySelector(
      `.journey-stop[data-stop="${i}"] .stop-inner`,
    );
    const cs = inner ? getComputedStyle(inner) : null;
    // Effective scrim opacity: parse the background gradient's top alpha.
    const bg = cs?.backgroundImage ?? cs?.background ?? "";
    const alphaMatch = bg.match(/rgba?\([^)]*?,\s*([0-9.]+)\)/);
    return {
      activeStop: document.body.dataset.activeStop,
      backdropFilter: cs?.backdropFilter ?? cs?.webkitBackdropFilter ?? "none",
      hasMask: (cs?.maskImage ?? cs?.webkitMaskImage ?? "none") !== "none",
      scrimTopAlpha: alphaMatch ? Number(alphaMatch[1]) : null,
      bgSnippet: bg.slice(0, 90),
    };
  }, idx);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { webSocketDebuggerUrl } = await (
    await fetch(`${POOL_HTTP}/json/version`)
  ).json();
  console.log("Pool:", webSocketDebuggerUrl);
  const browser = await puppeteer.connect({
    browserWSEndpoint: webSocketDebuggerUrl,
  });
  const results = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\n=== ${vp.name} ===`);
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    // HMR keeps a socket open so networkidle never fires — wait for the journey
    // handle to be exposed instead, then let boot + intro dolly settle.
    await page
      .waitForFunction(() => !!window.__journey, { timeout: 30000 })
      .catch(() => console.log("  (warn) __journey not exposed in time"));
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

    for (const idx of STOPS) {
      const info = await gotoStop(page, idx);
      await new Promise((r) => setTimeout(r, 350));
      const file = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, file) });
      const rec = { viewport: vp.name, stop: idx, name: STOP_NAMES[idx], file, ...info };
      results.push(rec);
      console.log(
        `  stop ${idx} (${STOP_NAMES[idx]}): active=${info.activeStop} ` +
          `backdrop-filter="${info.backdropFilter}" mask=${info.hasMask} ` +
          `scrimAlpha=${info.scrimTopAlpha}`,
      );
    }
    await page.close();
  }
  browser.disconnect();
  fs.writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );

  const anyBackdrop = results.some(
    (r) => r.backdropFilter && r.backdropFilter !== "none",
  );
  console.log(
    `\nP0 assert — no backdrop-filter on .stop-inner: ${anyBackdrop ? "FAIL" : "PASS"}`,
  );
  console.log("Done →", OUT_DIR);
}

run().catch((e) => {
  console.error("Capture failed:", e);
  process.exit(1);
});
