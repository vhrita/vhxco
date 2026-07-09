/**
 * qa-n6-validate.mjs — QA read-only validation of N=6 copy rework.
 * Fixes the builder rig's networkidle2 hang (3D site keeps HMR ws open, never idles).
 * Uses domcontentloaded + explicit canvas/journey-ready wait.
 *
 * For each of 6 stops: navigate via hud:goto-phase, capture 375x667 & 1280x800,
 * measure central non-black ratio (void check), dump copy, and measure card overflow.
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
const STOP_NAMES = ["promessa", "gargalo", "metodo", "servicos", "prova", "acao"];

const BOOT_WAIT_MS = 7000;

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
  await new Promise((r) => setTimeout(r, 1600));
  await waitRAFs(page, 8);
  return page.evaluate(() => ({ activeStop: document.body.dataset.activeStop }));
}

// Inspect the active stop's DOM: copy + whether the copy panel / cards overflow
// their viewport (bottom edge below innerHeight, or scrollHeight > clientHeight).
async function inspectStop(page, idx) {
  return page.evaluate((i) => {
    const el = document.querySelector(`.journey-stop[data-stop="${i}"]`);
    if (!el) {
      // fall back: find the visible/active stop panel
      const active = document.querySelector(".journey-stop.is-active") ||
        document.querySelector('[data-active-stop]');
      return { found: false, activeAttr: document.body.dataset.activeStop };
    }
    const cs = getComputedStyle(el);
    const eyebrow = el.querySelector(".stop-eyebrow")?.textContent?.trim() ?? null;
    const headline = el.querySelector(".stop-headline")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    const body = el.querySelector(".stop-body")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
    const cardEls = Array.from(el.querySelectorAll(".stop-card, .service-card, [class*='card']"));
    const cardTitles = Array.from(el.querySelectorAll(".stop-card-title, .service-card-title, [class*='card-title']")).map((c) => c.textContent.trim());
    const vh = window.innerHeight;
    // overflow: does any card's rect bottom exceed viewport, or top < 0?
    const cardRects = cardEls.map((c) => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), belowFold: r.bottom > vh + 1, aboveFold: r.top < -1 };
    });
    // Does the stop content region itself scroll internally?
    const contentEl = el.querySelector(".stop-content, .stop-inner, .stop-copy") || el;
    const internalScroll = contentEl.scrollHeight > contentEl.clientHeight + 1;
    const elRect = el.getBoundingClientRect();
    const anyBelow = cardRects.some((r) => r.belowFold);
    const anyAbove = cardRects.some((r) => r.aboveFold);
    return {
      found: true,
      eyebrow, headline, body,
      cardCount: cardTitles.length,
      cardTitles,
      cardRects,
      internalScroll,
      overflow: anyBelow || anyAbove || internalScroll,
      vh,
      elRect: { top: Math.round(elRect.top), bottom: Math.round(elRect.bottom), height: Math.round(elRect.height) },
    };
  }, idx);
}

async function inspectGlobals(page, idx) {
  return page.evaluate(() => {
    const cta = document.querySelector(".persistent-cta, [class*='persistent-cta'], [class*='PersistentCta']");
    const ctaVisible = cta ? getComputedStyle(cta).display !== "none" && getComputedStyle(cta).visibility !== "hidden" && cta.getBoundingClientRect().height > 0 : null;
    const form = document.querySelector("form");
    const formVisible = form ? form.getBoundingClientRect().height > 0 && getComputedStyle(form).display !== "none" : false;
    const tagEl = document.querySelector(".stop-tagline-close");
    const tagText = tagEl ? tagEl.textContent.replace(/\s+/g, " ").trim() : null;
    const tagVisible = tagEl ? tagEl.getBoundingClientRect().height > 0 && getComputedStyle(tagEl).visibility !== "hidden" && +getComputedStyle(tagEl).opacity > 0.05 : false;
    const bodyText = document.body.innerText;
    const taglineInDom = bodyText.includes("Construído por agentes") && bodyText.includes("Feito para pessoas");
    return { ctaExists: !!cta, ctaVisible, formExists: !!form, formVisible, tagText, tagVisible, taglineInDom };
  });
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const versionRes = await fetch(`${POOL_HTTP}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();
  console.log("Connecting to pool:", webSocketDebuggerUrl);
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });

  const results = [];
  const consoleErrors = [];

  function flush() {
    fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify({ results, consoleErrors }, null, 2));
  }

  for (const vp of VIEWPORTS) {
    try {
      const page = await browser.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push({ vp: vp.name, text: msg.text() });
      });
      page.on("pageerror", (err) => consoleErrors.push({ vp: vp.name, text: "PAGEERROR: " + err.message }));
      await page.setViewport({ width: vp.width, height: vp.height });
      console.log(`\n=== Viewport ${vp.name} ===`);
      await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("canvas", { timeout: 30000 }).catch(() => console.log("  (no canvas selector yet)"));
      await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

      for (let idx = 0; idx < STOP_COUNT; idx++) {
        const nav = await gotoStop(page, idx);
        await new Promise((r) => setTimeout(r, 400));
        const voidMetric = await measureVoid(page);
        const insp = await inspectStop(page, idx);
        const glob = await inspectGlobals(page, idx);
        const filename = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
        await page.screenshot({ path: path.join(OUT_DIR, filename) });
        const rec = {
          viewport: vp.name, stop: idx, name: STOP_NAMES[idx],
          activeStop: nav.activeStop,
          voidRatio: +(voidMetric.ratio ?? 0).toFixed(4),
          voidError: voidMetric.error ?? null,
          filename, copy: insp, globals: glob,
        };
        results.push(rec);
        flush();
        console.log(
          `  stop ${idx} (${STOP_NAMES[idx]}): active=${nav.activeStop} ` +
          `lit=${((voidMetric.ratio ?? 0) * 100).toFixed(1)}% ` +
          `hl="${insp.headline ?? "?"}" cards=${insp.cardCount ?? 0} ` +
          `overflow=${insp.overflow} cta=${glob.ctaVisible} form=${glob.formVisible} tagVis=${glob.tagVisible}` +
          (voidMetric.error ? ` [${voidMetric.error}]` : ""),
        );
      }
      await page.close();
    } catch (e) {
      console.error(`  !! viewport ${vp.name} aborted: ${e.message}`);
      flush();
    }
  }

  browser.disconnect();
  flush();
  console.log("\nConsole errors:", consoleErrors.length);
  consoleErrors.forEach((e) => console.log(`  [${e.vp}] ${e.text}`));
  console.log("Done. Output in", OUT_DIR);
}

run().catch((err) => { console.error("Capture failed:", err); process.exit(1); });
