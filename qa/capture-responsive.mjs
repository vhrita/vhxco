/**
 * capture-responsive.mjs — Responsividade validation rig (large-screen scaling
 * + mobile sidebar).
 *
 * Drives the LIVE dev URL via the shared chromium pool. For each viewport it
 * navigates the 6 journey stops (via the app's own hud:goto-phase event) and
 * captures a full-viewport PNG. On 375 it additionally captures the mobile
 * sidebar CLOSED (hamburger visible) and OPEN (drawer with 6 stops + lang).
 *
 * Viewports: 375×667, 768×1024, 1280×800, 1920×1080, 2560×1440.
 *
 * Usage: node qa/capture-responsive.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/responsive");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const ALL_VIEWPORTS = [
  { name: "375x667", width: 375, height: 667, mobile: true },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
];

// Filter via CLI arg (comma-separated widths) so we can run resiliently in
// smaller batches when the shared pool drops a page mid-run.
const FILTER = process.argv[2] ? process.argv[2].split(",") : null;
const VIEWPORTS = FILTER
  ? ALL_VIEWPORTS.filter((v) => FILTER.includes(String(v.width)))
  : ALL_VIEWPORTS;

const STOP_COUNT = 6;
const STOP_NAMES = ["promessa", "gargalo", "metodo", "servicos", "prova", "acao"];

const BOOT_WAIT_MS = 6000;
const SETTLE_MS = 1400;

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
    window.dispatchEvent(
      new CustomEvent("hud:goto-phase", { detail: { phase: i } }),
    );
  }, idx);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  await waitRAFs(page, 6);
  return page.evaluate(() => document.body.dataset.activeStop);
}

/** Measure internal overflow of the active stop panel (hard law: no overflow). */
async function measureOverflow(page, idx) {
  return page.evaluate((i) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${i}"]`);
    if (!stop) return { error: "no stop el" };
    const inner = stop.querySelector(".stop-inner");
    if (!inner) return { error: "no inner" };
    const r = inner.getBoundingClientRect();
    return {
      innerScrollH: inner.scrollHeight,
      innerClientH: inner.clientHeight,
      overflowY: inner.scrollHeight - inner.clientHeight,
      bottom: Math.round(r.bottom),
      top: Math.round(r.top),
      viewportH: window.innerHeight,
      exceedsViewport: Math.round(r.bottom) > window.innerHeight + 1,
      innerWidth: Math.round(r.width),
    };
  }, idx);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];

  for (const vp of VIEWPORTS) {
    // Fresh connection per viewport — the shared pool occasionally drops a page;
    // reconnecting isolates each viewport so one crash doesn't kill the batch.
    const versionRes = await fetch(`${POOL_HTTP}/json/version`);
    const { webSocketDebuggerUrl } = await versionRes.json();
    const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\n=== Viewport ${vp.name} ===`);
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

    for (let idx = 0; idx < STOP_COUNT; idx++) {
      const active = await gotoStop(page, idx);
      await new Promise((r) => setTimeout(r, 300));
      const ovf = await measureOverflow(page, idx);
      const filename = `stop${idx}-${STOP_NAMES[idx]}_${vp.name}.png`;
      await page.screenshot({ path: path.join(OUT_DIR, filename) });

      const copy = await page.evaluate((i) => {
        const el = document.querySelector(`.journey-stop[data-stop="${i}"]`);
        if (!el) return null;
        return {
          headline: el.querySelector(".stop-headline")?.textContent?.replace(/\s+/g, " ").trim(),
          headlineFontPx: (() => {
            const h = el.querySelector(".stop-headline");
            return h ? parseFloat(getComputedStyle(h).fontSize) : null;
          })(),
          bodyFontPx: (() => {
            const b = el.querySelector(".stop-body");
            return b ? parseFloat(getComputedStyle(b).fontSize) : null;
          })(),
        };
      }, idx);

      const rec = {
        viewport: vp.name, stop: idx, name: STOP_NAMES[idx],
        activeStop: active, filename,
        headlineFontPx: copy?.headlineFontPx, bodyFontPx: copy?.bodyFontPx,
        innerWidth: ovf.innerWidth, overflowY: ovf.overflowY,
        exceedsViewport: ovf.exceedsViewport, panelBottom: ovf.bottom, viewportH: ovf.viewportH,
      };
      results.push(rec);
      console.log(
        `  stop ${idx} (${STOP_NAMES[idx]}): active=${active} ` +
        `hlFont=${copy?.headlineFontPx}px bodyFont=${copy?.bodyFontPx}px ` +
        `panelW=${ovf.innerWidth}px overflowY=${ovf.overflowY}px ` +
        `bottom=${ovf.bottom}/${ovf.viewportH} exceeds=${ovf.exceedsViewport}`,
      );
    }

    // Mobile sidebar: closed + open states (on stop 0).
    if (vp.mobile) {
      await gotoStop(page, 0);
      await new Promise((r) => setTimeout(r, 300));

      // Closed state — hamburger visible, top decluttered.
      await page.screenshot({ path: path.join(OUT_DIR, `sidebar-closed_${vp.name}.png`) });
      const burgerVisible = await page.evaluate(() => {
        const b = document.getElementById("topnav-burger");
        if (!b) return false;
        return getComputedStyle(b).display !== "none";
      });

      // Open the drawer via the hamburger click.
      await page.evaluate(() => document.getElementById("topnav-burger")?.click());
      await new Promise((r) => setTimeout(r, 700)); // slide-in transition
      await page.screenshot({ path: path.join(OUT_DIR, `sidebar-open_${vp.name}.png`) });

      const drawerState = await page.evaluate(() => {
        const open = document.body.classList.contains("nav-drawer-open");
        const drawer = document.getElementById("topnav-drawer");
        const r = drawer?.getBoundingClientRect();
        const chapters = Array.from(document.querySelectorAll("#topnav-drawer .topnav-chapter"))
          .map((c) => c.textContent.replace(/\s+/g, " ").trim());
        const langBtns = Array.from(document.querySelectorAll("#topnav-drawer .topnav-lang-btn"))
          .map((a) => a.textContent.trim());
        return {
          bodyOpen: open,
          drawerRightEdge: r ? Math.round(r.right) : null,
          drawerWidth: r ? Math.round(r.width) : null,
          drawerTransform: drawer ? getComputedStyle(drawer).transform : null,
          chapters, langBtns,
        };
      });
      console.log(
        `  [sidebar] burgerVisible=${burgerVisible} open=${drawerState.bodyOpen} ` +
        `width=${drawerState.drawerWidth}px chapters=${drawerState.chapters.length} ` +
        `lang=[${drawerState.langBtns.join(",")}]`,
      );
      console.log(`  [sidebar] labels: ${drawerState.chapters.join(" | ")}`);
      results.push({ viewport: vp.name, sidebar: { burgerVisible, ...drawerState } });

      // Close by clicking a chapter — proves auto-close on select.
      await page.evaluate(() => {
        const c = document.querySelector("#topnav-drawer .topnav-chapter[data-phase='2']");
        c?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 700));
      const closedAfterSelect = await page.evaluate(() =>
        !document.body.classList.contains("nav-drawer-open"));
      console.log(`  [sidebar] closedAfterChapterSelect=${closedAfterSelect}`);
      results.push({ viewport: vp.name, sidebarAutoClose: closedAfterSelect });
    }

    await page.close();
    browser.disconnect();
  }

  const outName = FILTER ? `results-${FILTER.join("-")}.json` : "results.json";
  fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(results, null, 2));
  console.log("\nDone. Screenshots + " + outName + " in", OUT_DIR);
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
