/**
 * qa/capture-phase4b2-final.mjs
 * Consolidated FINAL QA rig for the phase4b2 polish leva.
 *
 * Captures, per viewport (375x667 / 768x1024 / 1280x800 / 1920x1080):
 *   - hero-normal   : normal mode, AFTER the intro dolly lands (data-intro gone
 *                     + journey:intro-done fired). Proves the reveal regression
 *                     is NOT present — headline + subcopy + CTA visible.
 *   - stopN (0..4)  : window.__journey.setJourneyProgress(stopProgress(N)) then
 *                     shot — proves each of the 5 stops shows its copy.
 *   - reduced-motion: emulated prefers-reduced-motion:reduce — static brain +
 *                     content revealed + loop parked.
 *   - no-webgl      : WebGL disabled via CDP + page stub — proves static
 *                     fallback, no black screen / no console error.
 *
 * Also asserts (JSON out):
 *   - determinism: setJourneyProgress(t) camera snapshot bit-identical across
 *     two reloads for t = 0 / 0.5 / 1.0.
 *   - console cleanliness per page.
 *   - hard law: no page/element overflow at each viewport.
 *
 * Uses the shared chromium pool (CDP), dev server (window.__journey needs DEV).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "screenshots", "phase4b2-final");

const WS = process.env.POOL_WS || "ws://chromium-shared-rtl1qg:3100";
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:4323";

const VIEWPORTS = [
  { name: "375x667", width: 375, height: 667 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: BASE, viewports: {}, determinism: {}, errors: {} };

async function newPage(browser, vp, { reducedMotion = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ ...vp, deviceScaleFactor: 1 });
  if (reducedMotion) {
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
  }
  return page;
}

function attachConsole(page, bucket) {
  const errs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      errs.push({ type: m.type(), text: m.text() });
    }
  });
  page.on("pageerror", (e) => errs.push({ type: "pageerror", text: e.message }));
  report.errors[bucket] = errs;
  return errs;
}

async function waitLanded(page, timeout = 20000) {
  // data-intro removed by render-loop on dolly land (or immediately in RM).
  const t0 = Date.now();
  let landed = false;
  while (Date.now() - t0 < timeout) {
    landed = await page.evaluate(
      () => document.body.dataset.intro !== "active",
    );
    if (landed) break;
    await sleep(120);
  }
  return landed;
}

async function contentProbe(page) {
  return page.evaluate(() => {
    const active = document.body.dataset.activeStop ?? "(none)";
    const stopEl = document.querySelector(
      `.journey-stop[data-stop="${active}"]`,
    );
    const cs = stopEl ? getComputedStyle(stopEl) : null;
    const headline = stopEl?.querySelector(".stop-headline");
    const body = stopEl?.querySelector(".stop-body");
    const cta = document.getElementById("persistent-cta");
    const ctaCs = cta ? getComputedStyle(cta) : null;
    // Overflow check: does any visible content exceed the viewport?
    const docOverflow =
      document.documentElement.scrollHeight > window.innerHeight + 2 ||
      document.documentElement.scrollWidth > window.innerWidth + 2;
    const innerOverflow = stopEl
      ? (() => {
          const inner = stopEl.querySelector(".stop-inner");
          if (!inner) return false;
          return (
            inner.scrollHeight > inner.clientHeight + 2 ||
            inner.scrollWidth > inner.clientWidth + 2
          );
        })()
      : false;
    return {
      activeStop: active,
      stopVisible: cs ? cs.opacity : "(no stop el)",
      headlineText: headline ? (headline.textContent || "").trim().slice(0, 70) : "(none)",
      bodyText: body ? (body.textContent || "").trim().slice(0, 70) : "(none)",
      ctaOpacity: ctaCs ? ctaCs.opacity : "(no cta)",
      ctaDisplay: ctaCs ? ctaCs.display : "(no cta)",
      docOverflow,
      innerOverflow,
    };
  });
}

async function shot(page, file) {
  await page.screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`    saved ${file}`);
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.connect({ browserWSEndpoint: WS });
  console.log(`connected pool=${WS} base=${BASE}`);

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.name} ===`);
    report.viewports[vp.name] = {};

    // ── NORMAL: wait for dolly land, capture hero revealed ──────────────────
    {
      const page = await newPage(browser, vp);
      attachConsole(page, `${vp.name}:normal`);
      await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
      const landed = await waitLanded(page);
      await sleep(1600); // settle reveal (400ms boot delay + 400ms opacity + buffer)
      const probe = await contentProbe(page);
      report.viewports[vp.name].heroNormal = { landed, ...probe };
      console.log(`  normal landed=${landed} stopVisible=${probe.stopVisible} headline="${probe.headlineText}" cta=${probe.ctaOpacity} docOverflow=${probe.docOverflow} innerOverflow=${probe.innerOverflow}`);
      await shot(page, `${vp.name}-hero-revealed-normal.png`);

      // 5 stops via __journey
      const hasJourney = await page.evaluate(() => !!window.__journey);
      report.viewports[vp.name].journeyHook = hasJourney;
      if (hasJourney) {
        for (let s = 0; s < 5; s++) {
          await page.evaluate((idx) => {
            const j = window.__journey;
            j.setJourneyProgress(j.stopProgress(idx));
          }, s);
          await sleep(700);
          const p = await contentProbe(page);
          report.viewports[vp.name][`stop${s}`] = p;
          console.log(`  stop${s}: active=${p.activeStop} headline="${p.headlineText}" body="${p.bodyText}" docOF=${p.docOverflow} innerOF=${p.innerOverflow} cta=${p.ctaOpacity}/${p.ctaDisplay}`);
          // Save interior stop shots for 1280 (representative) + all stop2 as a sample
          if (vp.name === "1280x800" || s === 2) {
            await shot(page, `${vp.name}-stop${s}.png`);
          }
          // form fields on stop 4
          if (s === 4) {
            const formFields = await page.evaluate(() => {
              const form = document.querySelector('.journey-stop[data-stop="4"]');
              if (!form) return { count: 0 };
              const inputs = form.querySelectorAll("input:not([type=hidden]), textarea");
              return { count: inputs.length, tags: Array.from(inputs).map((i) => (i.getAttribute("name") || i.tagName)) };
            });
            report.viewports[vp.name].stop4Form = formFields;
            console.log(`  stop4 form fields: ${JSON.stringify(formFields)}`);
          }
        }
      }
      await page.close();
    }

    // ── REDUCED MOTION ───────────────────────────────────────────────────────
    {
      const page = await newPage(browser, vp, { reducedMotion: true });
      attachConsole(page, `${vp.name}:reduced-motion`);
      await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
      const landed = await waitLanded(page, 8000);
      await sleep(1000);
      const probe = await contentProbe(page);
      report.viewports[vp.name].reducedMotion = { landed, ...probe };
      console.log(`  reduced-motion landed=${landed} stopVisible=${probe.stopVisible} headline="${probe.headlineText}" docOF=${probe.docOverflow}`);
      await shot(page, `${vp.name}-reduced-motion.png`);
      await page.close();
    }

    // ── NO WEBGL — disable via CDP + stub getContext for gl ─────────────────
    {
      const page = await newPage(browser, vp);
      attachConsole(page, `${vp.name}:no-webgl`);
      // Stub HTMLCanvasElement.getContext to refuse webgl BEFORE any script runs.
      await page.evaluateOnNewDocument(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (typeof type === "string" && /webgl/i.test(type)) return null;
          return orig.call(this, type, ...rest);
        };
        // Also nuke the constructor so isWebGLAvailable's early guard trips too.
        try {
          delete window.WebGLRenderingContext;
          delete window.WebGL2RenderingContext;
        } catch {}
      });
      await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(2500);
      const nw = await page.evaluate(() => {
        const flag = document.body.dataset.webgl ?? "(unset)";
        const canvas = document.getElementById("webgl");
        const fb = document.getElementById("webgl-fallback-live");
        const fbCs = fb ? getComputedStyle(fb) : null;
        const stop0 = document.querySelector('.journey-stop[data-stop="0"]');
        const stop0Cs = stop0 ? getComputedStyle(stop0) : null;
        return {
          webglFlag: flag,
          canvasPresent: !!canvas,
          fallbackDisplay: fbCs ? fbCs.display : "(no fb)",
          stop0Opacity: stop0Cs ? stop0Cs.opacity : "(no stop0)",
          headline: (stop0?.querySelector(".stop-headline")?.textContent || "").trim().slice(0, 70),
        };
      });
      report.viewports[vp.name].noWebgl = nw;
      console.log(`  no-webgl flag=${nw.webglFlag} canvasPresent=${nw.canvasPresent} fallbackDisplay=${nw.fallbackDisplay} stop0=${nw.stop0Opacity} headline="${nw.headline}"`);
      await shot(page, `${vp.name}-no-webgl.png`);
      await page.close();
    }
  }

  // ── DETERMINISM: camera snapshot at t=0/0.5/1.0 across two reloads ─────────
  console.log(`\n=== determinism ===`);
  async function snapshotSet() {
    const page = await newPage(browser, { name: "det", width: 1280, height: 800 });
    await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // wait for engine + __journey
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const ok = await page.evaluate(() => !!window.__journey && !!window.__engine);
      if (ok) break;
      await sleep(120);
    }
    await waitLanded(page);
    const snaps = {};
    for (const t of [0, 0.5, 1.0]) {
      await page.evaluate((tt) => window.__journey.setJourneyProgress(tt), t);
      await sleep(250);
      snaps[t] = await page.evaluate(() => window.__journey.getCameraSnapshot());
    }
    await page.close();
    return snaps;
  }
  const runA = await snapshotSet();
  const runB = await snapshotSet();
  const detMatch = {};
  for (const t of [0, 0.5, 1.0]) {
    detMatch[t] = JSON.stringify(runA[t]) === JSON.stringify(runB[t]);
  }
  report.determinism = { runA, runB, match: detMatch };
  console.log(`  determinism match: ${JSON.stringify(detMatch)}`);

  await browser.disconnect();
  await fs.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nreport.json written. done.`);
}

run().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
