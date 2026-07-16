/**
 * capture-site-copy-n6.mjs — N=6 copy rework validation rig.
 *
 * Connects to the shared chromium pool (browserWSEndpoint) and drives the LIVE
 * dev URL. For each of the 6 journey stops, navigates via the app's own
 * hud:goto-phase (uses stopCenterT internally), then captures a full-viewport
 * PNG at 375×667 and 1280×800 and measures the central non-black ratio so we
 * can prove the NEW SERVIÇOS anchor (stop 3) does NOT frame void.
 *
 * Usage: node qa/capture-site-copy-n6.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/site-copy-n6");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];

const STOP_COUNT = 6;
const STOP_NAMES = [
  "promessa",
  "gargalo",
  "metodo",
  "servicos",
  "prova",
  "acao",
];

const BOOT_WAIT_MS = 6000; // Three.js boot + intro dolly
const SETTLE_MS = 1400; // easing to the target stop + 400ms opacity

// Central-region void metric (exclude top HUD + bottom CTA).
const CROP_MARGIN_X = 0.2;
const CROP_MARGIN_Y = 0.18;
const CROP_BOTTOM_MARGIN = 0.2;
const BLACK_THRESHOLD = 12;

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

async function measureVoid(page) {
  return page.evaluate(
    (marginX, marginY, bottomMargin, threshold) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return { ratio: 0, error: "no canvas" };
      const w = canvas.width;
      const h = canvas.height;
      const x0 = Math.floor(w * marginX);
      const y0 = Math.floor(h * marginY);
      const x1 = Math.floor(w * (1 - marginX));
      const y1 = Math.floor(h * (1 - bottomMargin));
      const cropW = x1 - x0;
      const cropH = y1 - y0;
      if (cropW <= 0 || cropH <= 0) return { ratio: 0, error: "bad crop" };
      const off = document.createElement("canvas");
      off.width = cropW;
      off.height = cropH;
      const ctx = off.getContext("2d");
      if (!ctx) return { ratio: 0, error: "no 2d ctx" };
      ctx.drawImage(canvas, x0, y0, cropW, cropH, 0, 0, cropW, cropH);
      let data;
      try {
        data = ctx.getImageData(0, 0, cropW, cropH).data;
      } catch (e) {
        return { ratio: 0, error: `getImageData: ${String(e)}` };
      }
      let nonBlack = 0;
      const total = cropW * cropH;
      for (let i = 0; i < total; i++) {
        if (
          data[i * 4] > threshold ||
          data[i * 4 + 1] > threshold ||
          data[i * 4 + 2] > threshold
        )
          nonBlack++;
      }
      return { ratio: nonBlack / total, total };
    },
    CROP_MARGIN_X,
    CROP_MARGIN_Y,
    CROP_BOTTOM_MARGIN,
    BLACK_THRESHOLD,
  );
}

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await new Promise((r) => setTimeout(r, 1400));
  await waitRAFs(page, 6);
  // Read back the resolved t + activeStop for the record.
  return page.evaluate(() => {
    const body = document.body;
    return {
      activeStop: body.dataset.activeStop,
    };
  });
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
    console.log("Loading", DEV_URL);
    await page.goto(DEV_URL, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

    for (let idx = 0; idx < STOP_COUNT; idx++) {
      const nav = await gotoStop(page, idx);
      await new Promise((r) => setTimeout(r, 300));
      const voidMetric = await measureVoid(page);
      const filename = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename) });

      // Also grab the visible copy text of the active stop for a sanity dump.
      const copy = await page.evaluate((i) => {
        const el = document.querySelector(`.journey-stop[data-stop="${i}"]`);
        if (!el) return null;
        const eyebrow = el.querySelector(".stop-eyebrow")?.textContent?.trim();
        const headline = el
          .querySelector(".stop-headline")
          ?.textContent?.replace(/\s+/g, " ")
          .trim();
        const cards = Array.from(el.querySelectorAll(".stop-card-title")).map(
          (c) => c.textContent.trim(),
        );
        return { eyebrow, headline, cards };
      }, idx);

      const rec = {
        viewport: vp.name,
        stop: idx,
        name: STOP_NAMES[idx],
        activeStop: nav.activeStop,
        voidRatio: voidMetric.ratio,
        voidError: voidMetric.error ?? null,
        filename,
        copy,
      };
      results.push(rec);
      console.log(
        `  stop ${idx} (${STOP_NAMES[idx]}): active=${nav.activeStop} ` +
          `lit=${(voidMetric.ratio * 100).toFixed(1)}% ` +
          `hl="${copy?.headline ?? "?"}"` +
          (copy?.cards?.length ? ` cards=${copy.cards.length}` : "") +
          (voidMetric.error ? ` [${voidMetric.error}]` : ""),
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
