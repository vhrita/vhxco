/**
 * capture-2560.mjs — 4K proof (large-screen scaling). Lighter than the full rig:
 * one viewport, a subset of the densest/most representative stops, fresh
 * connection, generous per-step retries so the shared pool's flakiness doesn't
 * lose the run.
 */
import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(path.resolve(__dirname, ".."), "qa/screenshots/responsive");
const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";
const STOP_NAMES = ["promessa", "gargalo", "metodo", "servicos", "prova", "acao"];
const STOPS = [0, 1, 3, 4, 5]; // representative + densest

async function connect() {
  const { webSocketDebuggerUrl } = await (await fetch(`${POOL_HTTP}/json/version`)).json();
  return puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
}

async function captureStop(idx) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let browser;
    try {
      browser = await connect();
      const page = await browser.newPage();
      await page.setViewport({ width: 2560, height: 1440 });
      await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 6000));
      await page.evaluate((i) => window.dispatchEvent(
        new CustomEvent("hud:goto-phase", { detail: { phase: i } })), idx);
      await new Promise((r) => setTimeout(r, 1600));
      const m = await page.evaluate((i) => {
        const stop = document.querySelector(`.journey-stop[data-stop="${i}"]`);
        const inner = stop?.querySelector(".stop-inner");
        const h = stop?.querySelector(".stop-headline");
        const b = stop?.querySelector(".stop-body");
        const r = inner?.getBoundingClientRect();
        return {
          hlFont: h ? parseFloat(getComputedStyle(h).fontSize) : null,
          bodyFont: b ? parseFloat(getComputedStyle(b).fontSize) : null,
          panelW: r ? Math.round(r.width) : null,
          overflowY: inner ? inner.scrollHeight - inner.clientHeight : null,
          bottom: r ? Math.round(r.bottom) : null,
          exceeds: r ? Math.round(r.bottom) > window.innerHeight + 1 : null,
          vh: window.innerHeight,
        };
      }, idx);
      await page.screenshot({ path: path.join(OUT_DIR, `stop${idx}-${STOP_NAMES[idx]}_2560x1440.png`) });
      console.log(`  stop ${idx} (${STOP_NAMES[idx]}): hlFont=${m.hlFont}px bodyFont=${m.bodyFont}px ` +
        `panelW=${m.panelW}px overflowY=${m.overflowY}px bottom=${m.bottom}/${m.vh} exceeds=${m.exceeds}`);
      await page.close();
      browser.disconnect();
      return m;
    } catch (e) {
      console.log(`  stop ${idx} attempt ${attempt} failed: ${e.message}`);
      try { browser?.disconnect(); } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

const results = {};
for (const idx of STOPS) results[idx] = await captureStop(idx);
fs.writeFileSync(path.join(OUT_DIR, "results-2560.json"), JSON.stringify(results, null, 2));
console.log("Done 2560.");
