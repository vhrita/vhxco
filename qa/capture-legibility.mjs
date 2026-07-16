/**
 * capture-legibility.mjs — Text-legibility validation rig (dim token + glass).
 *
 * Drives the LIVE dev URL via the shared chromium pool. For each of the 6
 * journey stops, navigates via the app's own hud:goto-phase, then captures a
 * full-viewport PNG at 375×667 and 1280×800. Also measures the "lit" ratio of
 * the 3D behind the content block so we can prove the mesh still breathes
 * (glass is subtle, not opaque). Saves to qa/screenshots/site-legibility/.
 *
 * Usage: node qa/capture-legibility.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/site-legibility");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const ALL_VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];
// ONLY env lets us run a single viewport per process — the shared chromium
// pool tends to recycle the connection on the 2nd viewport of a long session.
const VIEWPORTS = process.env.ONLY
  ? ALL_VIEWPORTS.filter((v) => v.name === process.env.ONLY)
  : ALL_VIEWPORTS;

const STOP_COUNT = 6;
const STOP_NAMES = ["promessa", "gargalo", "metodo", "servicos", "prova", "acao"];

const BOOT_WAIT_MS = 6500; // Three.js boot + intro dolly
const SETTLE_MS = 1500;

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

// Measure how "lit" the region behind the .stop-inner glass is — proves the 3D
// still shows through (subtle glass, not opaque panel). Samples the canvas
// pixels under the content block's bounding box.
async function measureBehindGlass(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const inner = document.querySelector(
      ".journey-stop[style*='opacity'], .journey-stop",
    );
    const active = document.querySelector(
      `.journey-stop[data-stop='${document.body.dataset.activeStop}']`,
    );
    const target = active || inner;
    const block = target?.querySelector(".stop-inner");
    if (!canvas || !block) return { ratio: null, error: "no canvas/block" };
    const r = block.getBoundingClientRect();
    const dpr = canvas.width / window.innerWidth;
    const x0 = Math.max(0, Math.floor(r.left * dpr));
    const y0 = Math.max(0, Math.floor(r.top * dpr));
    const cw = Math.min(canvas.width - x0, Math.floor(r.width * dpr));
    const ch = Math.min(canvas.height - y0, Math.floor(r.height * dpr));
    if (cw <= 0 || ch <= 0) return { ratio: null, error: "bad crop" };
    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const ctx = off.getContext("2d");
    ctx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
    let data;
    try {
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (e) {
      return { ratio: null, error: String(e) };
    }
    let nonBlack = 0;
    const total = cw * ch;
    for (let i = 0; i < total; i++) {
      if (data[i * 4] > 12 || data[i * 4 + 1] > 12 || data[i * 4 + 2] > 12)
        nonBlack++;
    }
    return { ratio: nonBlack / total, total };
  });
}

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  // Poll until body[data-active-stop] actually reaches idx (the journey easing
  // takes a variable time to settle; a fixed sleep raced the state update).
  const deadline = Date.now() + 6000;
  let activeStop = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    activeStop = await page.evaluate(() => document.body.dataset.activeStop);
    if (String(activeStop) === String(idx)) break;
  }
  await new Promise((r) => setTimeout(r, 600)); // opacity transition (400ms)
  await waitRAFs(page, 6);
  return { activeStop };
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

    // Read the resolved --color-dim so we log the ACTUAL live value.
    const dimVal = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-dim")
        .trim(),
    );
    console.log(`  live --color-dim = ${dimVal}`);

    for (let idx = 0; idx < STOP_COUNT; idx++) {
      const nav = await gotoStop(page, idx);
      await new Promise((r) => setTimeout(r, 300));
      const behind = await measureBehindGlass(page);
      const filename = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename) });

      const rec = {
        viewport: vp.name,
        stop: idx,
        name: STOP_NAMES[idx],
        activeStop: nav.activeStop,
        litBehindGlass: behind.ratio,
        behindError: behind.error ?? null,
        filename,
      };
      results.push(rec);
      console.log(
        `  stop ${idx} (${STOP_NAMES[idx]}): active=${nav.activeStop} ` +
          `lit-behind-glass=${behind.ratio == null ? "n/a" : (behind.ratio * 100).toFixed(1) + "%"}` +
          (behind.error ? ` [${behind.error}]` : ""),
      );
    }
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
