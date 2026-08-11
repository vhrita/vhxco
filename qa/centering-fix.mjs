/**
 * qa/centering-fix.mjs — Validation rig for the :has()→.is-terminal-stop fix.
 *
 * Proves the Diagnose (stop 5) and Contato (stop 6) panels stay HORIZONTALLY
 * centered on mobile WITHOUT depending on the `:has()` selector.
 *
 * What it does per mobile viewport (375×667, 390×844, 412×915):
 *   1. Boots the page, forces the 3D/boot overlay to settle, navigates to the stop.
 *   2. Measures the .stop-inner block's left gap vs right gap (delta ~0 = centered).
 *   3. ROBUSTNESS PROOF: scrubs every CSS rule whose selectorText contains `:has(`
 *      from every stylesheet (emulating a browser where :has() does not apply),
 *      then re-measures. If centering survives, the fix does NOT depend on :has().
 *   4. CONTROL: strips the `.is-terminal-stop` class and confirms centering BREAKS
 *      (reverts left) — proving the class is the actual mechanism now.
 *   5. Also checks desktop (1280×800, 1440×900): terminal max-width cap + left-align.
 *
 * Self-contained: spawns its own `astro dev` and tears it down. Launches the
 * local Playwright chromium via puppeteer-core with the flat lib shim.
 */

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa", "screenshots", "centering-fix");
const PORT = 4399;
// astro preview binds IPv6 loopback (::1) ONLY — verified via probe. Node's
// fetch of "127.0.0.1" or "localhost" (→ IPv4) gets ECONNREFUSED; [::1] works.
const BASE_URL = `http://[::1]:${PORT}`;
const CHROME = "/tmp/pw-browsers/chromium-1234/chrome-linux/chrome";
process.env.LD_LIBRARY_PATH = `/tmp/chrome-libroot/flat:${process.env.LD_LIBRARY_PATH || ""}`;

const FORM_STOP = 5; // Diagnose
const CONTACT_STOP = 6; // Contato

const MOBILE = [
  { name: "375x667", w: 375, h: 667 },
  { name: "390x844", w: 390, h: 844 },
  { name: "412x915", w: 412, h: 915 },
  // 768: still under the 1023.98px terminal-centering breakpoint, but WIDER than
  // the default .stop-inner max-width (36rem=576px). Here the control (stripping
  // .is-terminal-stop) visibly pins the panel LEFT — decisively showing the class
  // is what centers it (mirrors the device bug).
  { name: "768x1024", w: 768, h: 1024 },
];
const DESKTOP = [
  { name: "1280x800", w: 1280, h: 800 },
  { name: "1440x900", w: 1440, h: 900 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Synchronous progress log — survives SIGKILL (unlike buffered stdout to a file).
const PROGRESS = "/tmp/cf-progress.log";
try {
  fs.writeFileSync(PROGRESS, "");
} catch {}
function log(...a) {
  const line = a
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .join(" ");
  console.log(line);
  try {
    fs.appendFileSync(PROGRESS, line + "\n");
  } catch {}
}

// ── preview server lifecycle ──────────────────────────────────────────────────
// Serves the production BUILD (dist/) — the same static HTML+CSS Vitor's device
// loads. Avoids the dev-only vite optimizeDeps esbuild quirk and is more faithful
// to production. Requires `astro build` to have run first.
async function startDev() {
  const proc = spawn(
    path.join(REPO_ROOT, "node_modules/.bin/astro"),
    ["preview", "--port", String(PORT)],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: false },
  );
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return proc;
    } catch {}
    await sleep(1000);
  }
  console.error("[preview] never became ready. Log:\n", log.slice(-2000));
  try {
    proc.kill("SIGKILL");
  } catch {}
  throw new Error("preview server timeout");
}

// ── measurement helpers (run in-page) ─────────────────────────────────────────
async function waitReveal(page) {
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      boot: document.body.dataset.boot || null,
      intro: document.body.dataset.intro || null,
    }));
    if (!s.boot && s.intro !== "active") break;
    await sleep(500);
  }
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
  await sleep(1600);
}

// Measure the active stop's centering. Returns left/right gap of .stop-inner
// relative to the viewport, plus the resolved justify-content of .journey-stop.
async function measure(page, stopIdx) {
  return page.evaluate((idx) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${idx}"]`);
    if (!stop) return { error: "no journey-stop" };
    const inner = stop.querySelector(".stop-inner");
    if (!inner) return { error: "no stop-inner" };
    const r = inner.getBoundingClientRect();
    const vw = window.innerWidth;
    const leftGap = Math.round(r.left);
    const rightGap = Math.round(vw - r.right);
    return {
      vw,
      innerLeft: Math.round(r.left),
      innerRight: Math.round(r.right),
      innerWidth: Math.round(r.width),
      leftGap,
      rightGap,
      delta: leftGap - rightGap,
      justify: getComputedStyle(stop).justifyContent,
      hasTerminalClass: stop.classList.contains("is-terminal-stop"),
    };
  }, stopIdx);
}

// Scrub every rule whose selectorText mentions :has( — emulates a browser with
// no :has() support. Returns how many rules were removed (site-wide).
async function scrubHasRules(page) {
  return page.evaluate(() => {
    let removed = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin
      }
      if (!rules) continue;
      const walk = (parent) => {
        for (let i = parent.cssRules.length - 1; i >= 0; i--) {
          const rule = parent.cssRules[i];
          if (rule.cssRules) walk(rule); // @media etc.
          if (rule.selectorText && rule.selectorText.includes(":has(")) {
            parent.deleteRule(i);
            removed++;
          }
        }
      };
      try {
        walk(sheet);
      } catch {}
    }
    return removed;
  });
}

async function stripTerminalClass(page, stopIdx) {
  await page.evaluate((idx) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${idx}"]`);
    if (stop) stop.classList.remove("is-terminal-stop");
  }, stopIdx);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dev = await startDev();
  log("[preview] ready");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
  });

  const report = { mobile: [], desktop: [] };

  try {
    // ── MOBILE ──
    for (const vp of MOBILE) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.w, height: vp.h });
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.evaluate(() => {
        try {
          localStorage.setItem("vhxco_lang", "pt");
        } catch {}
      });
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await waitReveal(page);
      await sleep(600);

      const rec = { viewport: vp.name };

      for (const [label, stopIdx] of [
        ["form", FORM_STOP],
        ["contact", CONTACT_STOP],
      ]) {
        await gotoStop(page, stopIdx);
        await sleep(1200); // let island hydrate

        // 1) baseline (with our new class rules, :has still present but unused)
        const baseline = await measure(page, stopIdx);
        await page.screenshot({
          path: path.join(OUT_DIR, `${vp.name}-${label}-baseline.png`),
        });

        // 2) robustness: scrub :has rules, re-measure (should be unchanged)
        const removed = await scrubHasRules(page);
        await sleep(200);
        const noHas = await measure(page, stopIdx);
        await page.screenshot({
          path: path.join(OUT_DIR, `${vp.name}-${label}-no-has.png`),
        });

        // 3) control: strip .is-terminal-stop → centering must BREAK
        await stripTerminalClass(page, stopIdx);
        await sleep(200);
        const noClass = await measure(page, stopIdx);
        await page.screenshot({
          path: path.join(OUT_DIR, `${vp.name}-${label}-no-class-control.png`),
        });

        rec[label] = { baseline, hasRulesRemoved: removed, noHas, noClass };
        log(
          `[mobile ${vp.name} ${label}] baseΔ=${baseline.delta} ` +
            `noHasΔ=${noHas.delta} noClassΔ=${noClass.delta}(justify=${noClass.justify}) scrubbed=${removed}`,
        );
      }
      report.mobile.push(rec);
      await page.close();
    }

    // ── DESKTOP (no regression: left-aligned + max-width cap) ──
    for (const vp of DESKTOP) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.w, height: vp.h });
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.evaluate(() => {
        try {
          localStorage.setItem("vhxco_lang", "pt");
        } catch {}
      });
      await page.goto(BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await waitReveal(page);
      await sleep(600);

      const rec = { viewport: vp.name };
      for (const [label, stopIdx] of [
        ["form", FORM_STOP],
        ["contact", CONTACT_STOP],
      ]) {
        await gotoStop(page, stopIdx);
        await sleep(1200);
        const m = await measure(page, stopIdx);
        await page.screenshot({
          path: path.join(OUT_DIR, `${vp.name}-${label}.png`),
        });
        rec[label] = m;
        log(
          `[desktop ${vp.name} ${label}] justify=${m.justify} innerW=${m.innerWidth} leftGap=${m.leftGap} rightGap=${m.rightGap}`,
        );
      }
      report.desktop.push(rec);
      await page.close();
    }
  } finally {
    await browser.close();
    try {
      dev.kill("SIGTERM");
    } catch {}
    await sleep(500);
    try {
      dev.kill("SIGKILL");
    } catch {}
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "measurements.json"),
    JSON.stringify(report, null, 2),
  );
  log("MEASUREMENTS_JSON_WRITTEN");

  // Verdicts
  log("\n===== VERDICTS =====");
  const CENTER_TOL = 8; // px — centered when |delta| <= tol
  let allPass = true;
  for (const rec of report.mobile) {
    for (const label of ["form", "contact"]) {
      const b = rec[label].baseline;
      const nh = rec[label].noHas;
      const nc = rec[label].noClass;
      const baseCentered = Math.abs(b.delta) <= CENTER_TOL;
      const noHasCentered = Math.abs(nh.delta) <= CENTER_TOL;
      // control: centering should break (delta grows) OR justify no longer center
      const controlBroke =
        Math.abs(nc.delta) > CENTER_TOL || nc.justify !== "center";
      const pass = baseCentered && noHasCentered && controlBroke;
      allPass = allPass && pass;
      log(
        `${rec.viewport} ${label}: baseΔ=${b.delta} noHasΔ=${nh.delta} ` +
          `noClassΔ=${nc.delta}(justify=${nc.justify}) rulesScrubbed=${rec[label].hasRulesRemoved} → ` +
          `${pass ? "PASS" : "FAIL"}`,
      );
    }
  }
  for (const rec of report.desktop) {
    for (const label of ["form", "contact"]) {
      const m = rec[label];
      log(
        `${rec.viewport} ${label}: justify=${m.justify} innerWidth=${m.innerWidth} leftGap=${m.leftGap} rightGap=${m.rightGap}`,
      );
    }
  }
  log(`\nOVERALL: ${allPass ? "PASS ✅" : "FAIL ❌"}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
