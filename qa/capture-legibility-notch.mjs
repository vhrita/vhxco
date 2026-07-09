/**
 * capture-legibility-notch.mjs — proof rig for the secondary-text contrast lift.
 *
 * Drives the LIVE dev URL via the shared chromium pool. Captures Stop 0
 * (Promessa — hero scroll-cue) and Stop 3 (Resultados — subcopy + cards + hud
 * hint) at 375×667 and 1280×800, and dumps the computed color/opacity of the
 * cue + subcopy tiers so we can prove the cue reads and the subcopy improved.
 *
 * Usage: node qa/capture-legibility-notch.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/legibility-notch");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];

const STOPS = [
  { idx: 0, name: "promessa" },
  { idx: 3, name: "resultados" },
];

const BOOT_WAIT_MS = 6500;

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

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    // Prefer the app's own journey API if exposed; fall back to the event.
    try {
      const j = window.__journey;
      if (j && typeof j.setJourneyProgress === "function" && j.journey?.stopProgress) {
        j.setJourneyProgress(j.journey.stopProgress(i));
        return;
      }
    } catch {}
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await new Promise((r) => setTimeout(r, 1500));
  await waitRAFs(page, 8);
}

// Report computed color/opacity of the tiers we touched, for the active stop.
async function reportTiers(page, idx) {
  return page.evaluate((i) => {
    const root = document.querySelector(`.journey-stop[data-stop="${i}"]`);
    const grab = (sel) => {
      const el = (root || document).querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
        color: cs.color,
        opacity: cs.opacity,
        fontSize: cs.fontSize,
      };
    };
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      tokens: {
        dim: rootStyle.getPropertyValue("--color-dim").trim(),
        hint: rootStyle.getPropertyValue("--color-hint").trim(),
        fg: rootStyle.getPropertyValue("--color-fg").trim(),
      },
      cue_hudHint: grab(".stop-hud-hint"),
      cue_scroll: document.querySelector(".scroll-cue")
        ? (() => {
            const el = document.querySelector(".scroll-cue");
            const cs = getComputedStyle(el);
            return {
              text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
              color: cs.color,
              opacity: cs.opacity,
            };
          })()
        : null,
      subcopy_body: grab(".stop-body"),
      cardDesc: grab(".stop-card-desc"),
      eyebrow: grab(".stop-eyebrow"),
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
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

    for (const stop of STOPS) {
      await gotoStop(page, stop.idx);
      await new Promise((r) => setTimeout(r, 400));
      const tiers = await reportTiers(page, stop.idx);
      const filename = `stop${stop.idx}-${stop.name}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename) });
      results.push({ viewport: vp.name, stop: stop.idx, name: stop.name, filename, tiers });
      console.log(`  stop ${stop.idx} (${stop.name}):`);
      console.log(`    tokens: dim=${tiers.tokens.dim} hint=${tiers.tokens.hint} fg=${tiers.tokens.fg}`);
      if (tiers.cue_hudHint)
        console.log(`    hud-hint cue: "${tiers.cue_hudHint.text}" color=${tiers.cue_hudHint.color} op=${tiers.cue_hudHint.opacity}`);
      if (tiers.cue_scroll)
        console.log(`    scroll cue:   "${tiers.cue_scroll.text}" color=${tiers.cue_scroll.color} op=${tiers.cue_scroll.opacity}`);
      if (tiers.subcopy_body)
        console.log(`    subcopy:      "${tiers.subcopy_body.text.slice(0,40)}" color=${tiers.subcopy_body.color} op=${tiers.subcopy_body.opacity}`);
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
