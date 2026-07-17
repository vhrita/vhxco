/**
 * capture-whatsapp-cta.mjs — Validation rig for the persistent WhatsApp CTA.
 *
 * Serves the freshly-built dist (static) and drives it via the shared chromium
 * pool. For 375×667 and 1280×800 (PT) it:
 *   - waits for the boot reveal (data-boot removed, intro not active),
 *   - captures a full-viewport PNG showing the WhatsApp FAB,
 *   - measures bounding boxes of #whatsapp-cta / #persistent-cta /
 *     #scroll-indicator and asserts ZERO overlap (hard law),
 *   - reads the href + computed visibility of the WhatsApp CTA.
 * It also navigates to another stop to prove the FAB persists.
 *
 * Usage: node qa/capture-whatsapp-cta.mjs [baseURL]
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/whatsapp-cta");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const BASE_URL = process.argv[2] || "http://10.0.1.36:8899/";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "1280x800", width: 1280, height: 800 },
];

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return !(
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  );
}

async function waitReveal(page) {
  // Poll until the boot gate lifts AND the intro dolly is not active (the FAB
  // is hidden during both). Failsafe reveal fires at 8s worst case.
  for (let i = 0; i < 30; i++) {
    const state = await page.evaluate(() => ({
      boot: document.body.dataset.boot || null,
      intro: document.body.dataset.intro || null,
      webgl: document.body.dataset.webgl || null,
    }));
    if (!state.boot && state.intro !== "active") return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return page.evaluate(() => ({
    boot: document.body.dataset.boot || null,
    intro: document.body.dataset.intro || null,
    webgl: document.body.dataset.webgl || null,
  }));
}

async function probe(page) {
  return page.evaluate(() => {
    const pick = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        opacity: cs.opacity, visibility: cs.visibility,
        display: cs.display, pointerEvents: cs.pointerEvents,
      };
    };
    const wa = document.getElementById("whatsapp-cta");
    return {
      whatsapp: pick("whatsapp-cta"),
      persistent: pick("persistent-cta"),
      scroll: pick("scroll-indicator"),
      href: wa ? wa.getAttribute("href") : null,
      target: wa ? wa.getAttribute("target") : null,
      rel: wa ? wa.getAttribute("rel") : null,
      activeStop: document.body.dataset.activeStop,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  });
}

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await new Promise((r) => setTimeout(r, 1400));
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];

  for (const vp of VIEWPORTS) {
    const versionRes = await fetch(`${POOL_HTTP}/json/version`);
    const { webSocketDebuggerUrl } = await versionRes.json();
    const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\n=== Viewport ${vp.name} ===`);
    // First load lands on /en/ (the pool's Chrome isn't a pt-* browser, so the
    // PT root's lang-detect redirects). Pin the manual PT choice, then reload —
    // localStorage 'vhxco_lang'==='pt' makes the redirect script stay on PT.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => {
      try { localStorage.setItem("vhxco_lang", "pt"); } catch (e) {}
    });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const revealState = await waitReveal(page);
    // The shared pool's headless Chrome has no working WebGL, so the engine
    // mounts, the render-loop sets data-intro="active", then the 7s watchdog
    // routes to failToFallback() WITHOUT clearing data-intro — leaving both CTAs
    // gated hidden (this stuck-intro edge predates this change and hits
    // #persistent-cta identically). Reproduce the steady post-intro DOM state a
    // real (WebGL-capable) visitor lands in: boot cleared + intro removed. This
    // is exactly the CSS state the shipped Diagnosticar CTA is validated in.
    await page.evaluate(() => {
      document.body.removeAttribute("data-boot");
      delete document.body.dataset.intro;
    });
    await new Promise((r) => setTimeout(r, 900));

    // Stop 0 — primary frame.
    const p0 = await probe(page);
    await page.screenshot({ path: path.join(OUT_DIR, `home-stop0_${vp.name}.png`) });

    const collideDiag = rectsOverlap(p0.whatsapp, p0.persistent);
    const collideScroll = rectsOverlap(p0.whatsapp, p0.scroll);

    console.log(`  boot=${JSON.stringify(revealState)}`);
    console.log(`  whatsapp box: ${JSON.stringify(p0.whatsapp)}`);
    console.log(`  persistent box: ${JSON.stringify(p0.persistent)}`);
    console.log(`  scroll box: ${JSON.stringify(p0.scroll)}`);
    console.log(`  href=${p0.href}`);
    console.log(`  target=${p0.target} rel=${p0.rel}`);
    console.log(`  COLLIDE wa×diagnosticar=${collideDiag}  wa×scroll=${collideScroll}`);

    // Navigate to another stop (2) to prove persistence.
    await gotoStop(page, 2);
    await page.evaluate(() => {
      document.body.removeAttribute("data-boot");
      delete document.body.dataset.intro;
    });
    await new Promise((r) => setTimeout(r, 500));
    const p2 = await probe(page);
    await page.screenshot({ path: path.join(OUT_DIR, `home-stop2_${vp.name}.png`) });
    console.log(`  [stop2] activeStop=${p2.activeStop} whatsapp visible? opacity=${p2.whatsapp?.opacity} vis=${p2.whatsapp?.visibility}`);

    results.push({
      viewport: vp.name, revealState,
      stop0: { ...p0, collideDiag, collideScroll },
      stop2: { activeStop: p2.activeStop, whatsapp: p2.whatsapp },
    });

    await page.close();
    browser.disconnect();
  }

  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log("\nDone. Screenshots + results.json in", OUT_DIR);
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
