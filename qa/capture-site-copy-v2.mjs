/**
 * capture-site-copy-v2.mjs — outcome-first copy v2 validation rig.
 *
 * Connects to the shared chromium pool and drives the LIVE dev URL. For each of
 * the 6 journey stops, navigates INSTANTLY via the app's own JourneyHandle
 * (window.__journey.setJourneyProgress(stopProgress(i)) — no easing), then
 * captures a full-viewport PNG at 375×667 and 1280×800.
 *
 * Also measures overflow on .stop-inner (scrollHeight > clientHeight) to prove
 * the hard law at 375×667 — esp. Stop 3 (4 icon cards) and Stop 4 (mural).
 *
 * Usage: node qa/capture-site-copy-v2.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/site-copy-v2");

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
  "resultados",
  "prova",
  "acao",
];

const BOOT_WAIT_MS = 6000; // Three.js boot + intro dolly

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

async function gotoStopInstant(page, idx) {
  await page.evaluate((i) => {
    const j = window.__journey;
    if (j && typeof j.setJourneyProgress === "function") {
      j.setJourneyProgress(j.stopProgress(i));
    }
    // also sync the active-stop attribute path used for panel visibility
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await waitRAFs(page, 4);
}

async function measureStop(page, idx) {
  return page.evaluate((i) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${i}"]`);
    if (!stop) return { error: "no stop el" };
    const inner = stop.querySelector(".stop-inner");
    const overflow = inner
      ? { scrollH: inner.scrollHeight, clientH: inner.clientHeight, overflows: inner.scrollHeight > inner.clientHeight + 1 }
      : null;
    // Does the panel exceed the viewport height?
    const rect = stop.getBoundingClientRect();
    const innerRect = inner ? inner.getBoundingClientRect() : null;
    const viewportOverflow = innerRect
      ? innerRect.bottom > window.innerHeight + 1 || innerRect.top < -1
      : null;
    const eyebrow = stop.querySelector(".stop-eyebrow")?.textContent?.trim();
    const headline = stop
      .querySelector(".stop-headline")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    const body = stop
      .querySelector(".stop-body")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();
    const cards = Array.from(stop.querySelectorAll(".stop-card-title")).map((c) =>
      c.textContent.replace(/\s+/g, " ").trim(),
    );
    const icons = stop.querySelectorAll(".stop-card-icon").length;
    const ctaLink = stop.querySelector(".stop-card-link[data-goto-action]");
    const muralLabel = stop.querySelector(".stop-mural-label")?.textContent?.trim();
    const tiles = Array.from(stop.querySelectorAll(".stop-tile")).map((a) => ({
      text: a.textContent.replace(/\s+/g, " ").trim(),
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
    }));
    return {
      eyebrow,
      headline,
      body,
      cards,
      icons,
      ctaGotoAction: ctaLink ? ctaLink.getAttribute("data-goto-action") : null,
      muralLabel: muralLabel ?? null,
      tiles,
      overflow,
      viewportOverflow,
    };
  }, idx);
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

    for (let idx = 0; idx < STOP_COUNT; idx++) {
      await gotoStopInstant(page, idx);
      await new Promise((r) => setTimeout(r, 500));
      const m = await measureStop(page, idx);
      const filename = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename) });
      results.push({ viewport: vp.name, stop: idx, name: STOP_NAMES[idx], filename, ...m });
      const ovf = m.overflow
        ? `overflow=${m.overflow.overflows} (${m.overflow.scrollH}/${m.overflow.clientH})`
        : "overflow=n/a";
      console.log(
        `  stop ${idx} (${STOP_NAMES[idx]}): "${m.headline ?? "?"}" ` +
          `${m.cards?.length ? `cards=${m.cards.length} icons=${m.icons} ` : ""}` +
          `${m.tiles?.length ? `tiles=${m.tiles.length} ` : ""}${ovf} vpOverflow=${m.viewportOverflow}`,
      );
    }
    await page.close();
  }

  browser.disconnect();
  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log("\nDone. Screenshots + results.json in", OUT_DIR);
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
