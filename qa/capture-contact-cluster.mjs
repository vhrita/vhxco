/**
 * capture-contact-cluster.mjs — Validation rig for the Diagnose-stop contact cluster.
 *
 * Drives the freshly-built dist (served statically) via the shared chromium pool.
 * For 375/768/1280/1920 (PT) it:
 *   - waits for the boot reveal, then reproduces the steady post-intro DOM state
 *     (pool Chrome has no WebGL, so the dolly stays stuck — clear data-boot/intro),
 *   - navigates to the action stop (Diagnose form),
 *   - captures a full-viewport PNG showing the form + contact cluster,
 *   - probes: WhatsApp href, all 5 channel hrefs, bounding boxes of the form /
 *     cluster / persistent CTA to assert NO overlap and NO vertical overflow,
 *   - confirms the old floating FAB (#whatsapp-cta) is GONE on stop 0.
 *
 * Usage: node qa/capture-contact-cluster.mjs [baseURL]
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/contact-cluster");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const BASE_URL = process.argv[2] || "http://10.0.1.36:8899/";
const ACTION_STOP = 5; // 6 stops (0..5); action/Diagnose is the last.

const VIEWPORTS = [
  { name: "375", width: 375, height: 667 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1920", width: 1920, height: 1080 },
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
  }));
}

async function forceSteady(page) {
  await page.evaluate(() => {
    document.body.removeAttribute("data-boot");
    delete document.body.dataset.intro;
  });
}

async function gotoStop(page, idx) {
  await page.evaluate((i) => {
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await new Promise((r) => setTimeout(r, 1500));
}

async function probe(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        opacity: cs.opacity, visibility: cs.visibility,
      };
    };
    const cluster = document.querySelector(".contact-cluster");
    const wa = document.querySelector(".contact-whatsapp");
    const chips = Array.from(document.querySelectorAll(".contact-chip"));
    const form = document.querySelector("#termForm, .terminal");
    const persistent = document.getElementById("persistent-cta");
    // Channel inventory (href + tap-target height).
    const channels = {};
    document
      .querySelectorAll(".contact-cluster a[data-channel]")
      .forEach((a) => {
        const r = a.getBoundingClientRect();
        channels[a.dataset.channel] = {
          href: a.getAttribute("href"),
          target: a.getAttribute("target"),
          rel: a.getAttribute("rel"),
          aria: a.getAttribute("aria-label"),
          tapH: Math.round(r.height),
          tapW: Math.round(r.width),
        };
      });
    return {
      activeStop: document.body.dataset.activeStop,
      hasFAB: !!document.getElementById("whatsapp-cta"),
      cluster: box(cluster),
      whatsapp: box(wa),
      form: box(form),
      persistent: box(persistent),
      chipCount: chips.length,
      channels,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
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
    console.log(`\n=== Viewport ${vp.name} (${vp.width}x${vp.height}) ===`);

    // Pin PT (pool Chrome isn't pt-locale → root redirects to /en/ otherwise).
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => {
      try { localStorage.setItem("vhxco_lang", "pt"); } catch (e) {}
    });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const revealState = await waitReveal(page);
    await forceSteady(page);
    await new Promise((r) => setTimeout(r, 700));

    // Stop 0 — confirm the FAB is gone.
    const p0 = await probe(page);
    await page.screenshot({ path: path.join(OUT_DIR, `stop0_${vp.name}.png`) });

    // Action stop — the contact cluster + form.
    await gotoStop(page, ACTION_STOP);
    await forceSteady(page);
    // Let the client:visible DiagnoseForm island finish hydrating so the probe +
    // screenshot capture the settled full-form state (not a mid-hydration frame).
    await new Promise((r) => setTimeout(r, 2000));
    const pA = await probe(page);
    await page.screenshot({ path: path.join(OUT_DIR, `diagnose_${vp.name}.png`) });

    const overlapFormCluster = rectsOverlap(pA.form, pA.cluster);
    const overlapClusterCta = rectsOverlap(pA.cluster, pA.persistent);
    const clusterBottom = pA.cluster ? pA.cluster.bottom : null;
    const overflow = clusterBottom != null && clusterBottom > pA.vh + 2;
    const channelIds = Object.keys(pA.channels);
    const minTap = Math.min(
      ...Object.values(pA.channels).map((c) => c.tapH),
      pA.whatsapp ? pA.whatsapp.h : 999,
    );

    console.log(`  reveal=${JSON.stringify(revealState)}`);
    console.log(`  stop0 hasFAB=${p0.hasFAB}  (expect false)`);
    console.log(`  activeStop=${pA.activeStop}`);
    console.log(`  channels present: ${channelIds.join(", ")} (count=${channelIds.length}, chips=${pA.chipCount})`);
    console.log(`  whatsapp href=${pA.channels.whatsapp?.href}`);
    console.log(`  form box=${JSON.stringify(pA.form)}`);
    console.log(`  cluster box=${JSON.stringify(pA.cluster)}`);
    console.log(`  minTapHeight=${minTap}px (expect >=40)`);
    console.log(`  OVERLAP form×cluster=${overlapFormCluster}  cluster×CTA=${overlapClusterCta}`);
    console.log(`  clusterBottom=${clusterBottom} vh=${pA.vh}  OVERFLOW=${overflow}`);

    results.push({
      viewport: vp.name,
      stop0HasFAB: p0.hasFAB,
      activeStop: pA.activeStop,
      channelIds,
      chipCount: pA.chipCount,
      channels: pA.channels,
      overlapFormCluster,
      overlapClusterCta,
      overflow,
      minTap,
      cluster: pA.cluster,
      form: pA.form,
      vh: pA.vh,
    });

    await page.close();
    browser.disconnect();
  }

  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));

  // Summary verdict.
  console.log("\n──────── SUMMARY ────────");
  let pass = true;
  for (const r of results) {
    const ok =
      r.stop0HasFAB === false &&
      r.channelIds.length === 5 &&
      !r.overlapFormCluster &&
      !r.overflow &&
      r.minTap >= 40;
    pass = pass && ok;
    console.log(
      `  ${r.viewport}: FAB gone=${!r.stop0HasFAB} channels=${r.channelIds.length} noOverlap=${!r.overlapFormCluster} noOverflow=${!r.overflow} tap>=40=${r.minTap >= 40} → ${ok ? "PASS" : "FAIL"}`,
    );
  }
  console.log(`\nVERDICT: ${pass ? "PASS" : "FAIL"}`);
  console.log("Screenshots + results.json in", OUT_DIR);
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
