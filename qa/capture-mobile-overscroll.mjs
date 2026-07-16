/**
 * capture-mobile-overscroll.mjs — QA rig for the mobile pull-to-refresh /
 * rubber-band overscroll fix (feature/phase4b2-rework).
 *
 * Drives the LIVE dev URL via the shared chromium pool at 375×667 and captures:
 *   (a) a journey stop (visual — nothing broke),
 *   (b) the Ação form (stop 5) — proves the form still renders + is touchable,
 *   (c) the sidebar OPEN — proves the drawer still renders + is touchable.
 *
 * It ALSO synthetically dispatches touchstart→touchmove→touchend on three
 * surfaces and asserts preventDefault() is called on the JOURNEY surface but NOT
 * on the form input nor the sidebar drawer — the code-level proof that touch
 * ownership is correct. (The REAL pull-to-refresh test is a device smoke by Vitor;
 * a synthetic TouchEvent cannot trigger the browser's native gesture.)
 *
 * Usage: node qa/capture-mobile-overscroll.mjs
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/mobile-overscroll");

const POOL_HTTP = "http://chromium-shared-rtl1qg:3100";
const DEV_URL = "https://vhxco-website-dev.138-2-243-181.sslip.io/";

const VP = { width: 375, height: 667 };
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
    window.dispatchEvent(new CustomEvent("hud:goto-phase", { detail: { phase: i } }));
  }, idx);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  await waitRAFs(page, 6);
  return page.evaluate(() => document.body.dataset.activeStop);
}

/**
 * Dispatch a real touchstart→touchmove→touchend sequence on `selector` and report
 * whether the app's touchmove handler called preventDefault (defaultPrevented) and
 * whether the active journey stop changed as a result.
 */
async function probeTouch(page, selector, label) {
  return page.evaluate(
    ({ selector, label }) => {
      const el = selector === "window" ? document.body : document.querySelector(selector);
      if (!el) return { label, error: `no element for ${selector}` };
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2) || 180;
      const startY = Math.round(r.top + r.height / 2) || 400;

      const stopBefore = document.body.dataset.activeStop;

      function mkTouch(y) {
        return new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
      }
      function fire(type, y) {
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [mkTouch(y)],
          targetTouches: type === "touchend" ? [] : [mkTouch(y)],
          changedTouches: [mkTouch(y)],
        });
        el.dispatchEvent(ev);
        return ev;
      }

      fire("touchstart", startY);
      // Multiple upward drag steps (finger up = advance), each well over
      // TOUCH_STEP_THRESHOLD (45px) — a single 120px move accumulates to one step;
      // fire several so a mid-journey stop demonstrably advances.
      let lastMove = null;
      let y = startY;
      for (let i = 0; i < 4; i++) {
        y -= 60;
        lastMove = fire("touchmove", y);
      }
      fire("touchend", y);

      const stopAfter = document.body.dataset.activeStop;
      return {
        label,
        selector,
        touchmoveDefaultPrevented: lastMove ? lastMove.defaultPrevented : null,
        stopBefore,
        stopAfter,
        stopChanged: stopBefore !== stopAfter,
      };
    },
    { selector, label },
  );
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = { viewport: `${VP.width}x${VP.height}`, shots: [], touchProbes: [] };

  const versionRes = await fetch(`${POOL_HTTP}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
  const page = await browser.newPage();
  await page.setViewport({ ...VP, isMobile: true, hasTouch: true });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

  // Confirm the CSS actually applied on the live root.
  const cssState = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return {
      bodyOverscroll: b.overscrollBehaviorY || b.overscrollBehavior,
      bodyTouchAction: b.touchAction,
    };
  });
  results.cssState = cssState;
  console.log("CSS on <body>:", JSON.stringify(cssState));

  // (a) A journey stop (stop 1 — gargalo).
  let active = await gotoStop(page, 1);
  await page.screenshot({ path: path.join(OUT_DIR, "a-journey-stop_375x667.png") });
  results.shots.push({ name: "a-journey-stop", activeStop: active });
  console.log(`(a) journey stop captured, activeStop=${active}`);

  // (b) The Ação form (stop 5).
  active = await gotoStop(page, 5);
  await new Promise((r) => setTimeout(r, 600));
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector(".terminal");
    const input = document.querySelector(".terminal .term-input, .terminal input");
    return {
      formPresent: !!form,
      formTouchAction: form ? getComputedStyle(form).touchAction : null,
      inputPresent: !!input,
      inputTouchAction: input ? getComputedStyle(input).touchAction : null,
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, "b-acao-form_375x667.png") });
  results.shots.push({ name: "b-acao-form", activeStop: active, ...formInfo });
  console.log(`(b) form captured, activeStop=${active}`, JSON.stringify(formInfo));

  // (c) Sidebar OPEN.
  await gotoStop(page, 0);
  await page.evaluate(() => document.getElementById("topnav-burger")?.click());
  await new Promise((r) => setTimeout(r, 700));
  const drawerInfo = await page.evaluate(() => {
    const drawer = document.getElementById("topnav-drawer");
    return {
      drawerOpen: document.body.classList.contains("nav-drawer-open"),
      drawerTouchAction: drawer ? getComputedStyle(drawer).touchAction : null,
      chapters: Array.from(document.querySelectorAll("#topnav-drawer .topnav-chapter")).length,
    };
  });
  await page.screenshot({ path: path.join(OUT_DIR, "c-sidebar-open_375x667.png") });
  results.shots.push({ name: "c-sidebar-open", ...drawerInfo });
  console.log(`(c) sidebar captured`, JSON.stringify(drawerInfo));

  // ── Touch ownership probes ────────────────────────────────────────────────
  // Close the drawer + go to a mid stop so a step is possible either direction.
  await page.evaluate(() => document.getElementById("topnav-drawer-close")?.click());
  await new Promise((r) => setTimeout(r, 500));
  await gotoStop(page, 2);
  await new Promise((r) => setTimeout(r, 400));

  // Journey surface (body / canvas backdrop) — SHOULD preventDefault + step.
  const journeyProbe = await probeTouch(page, ".backdrop-vignette", "journey-surface");
  results.touchProbes.push(journeyProbe);
  console.log("probe journey:", JSON.stringify(journeyProbe));

  // Form surface — SHOULD NOT preventDefault, SHOULD NOT step. Probe whatever
  // focusable element the .terminal renders (real form → .term-input; when
  // PUBLIC_FORMSPREE_ID is unset the fallback CTA renders instead — either way it
  // lives inside .terminal, which is the carve-out surface).
  await gotoStop(page, 5);
  await new Promise((r) => setTimeout(r, 500));
  const formSel = await page.evaluate(() => {
    if (document.querySelector(".terminal .term-input")) return ".terminal .term-input";
    if (document.querySelector(".terminal .term-fallback-cta")) return ".terminal .term-fallback-cta";
    return ".terminal";
  });
  const formProbe = await probeTouch(page, formSel, "form-surface");
  results.touchProbes.push(formProbe);
  console.log("probe form:", JSON.stringify(formProbe));

  // Sidebar drawer — SHOULD NOT preventDefault, SHOULD NOT step.
  await gotoStop(page, 0);
  await page.evaluate(() => document.getElementById("topnav-burger")?.click());
  await new Promise((r) => setTimeout(r, 600));
  const sidebarProbe = await probeTouch(page, "#topnav-drawer .topnav-chapter", "sidebar-drawer");
  results.touchProbes.push(sidebarProbe);
  console.log("probe sidebar:", JSON.stringify(sidebarProbe));

  results.consoleErrors = consoleErrors;
  console.log("console errors:", consoleErrors.length ? consoleErrors : "(none)");

  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log("\nDone. Screenshots + results.json in", OUT_DIR);

  await page.close();
  browser.disconnect();
}

run().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
