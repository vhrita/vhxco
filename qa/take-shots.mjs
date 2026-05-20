/**
 * qa/take-shots.mjs
 * Puppeteer-core screenshot rig for the VHXCO Astro site.
 *
 * Phase navigation strategy:
 *   - Primary: window.__phaseStore.goToPhase(N) — exposed in DEV mode by BaseLayout.astro
 *     via createPhaseOrchestrator(). This calls orchestrator.goToPhase() directly.
 *   - Fallback: window.dispatchEvent(new CustomEvent('hud:goto-phase', { detail: { phase: N } }))
 *     This is the same path the TopNav buttons use; BaseLayout wires it to orchestrator.goToPhase.
 *
 * Phases are 0-indexed internally (0..4), but labelled 1-5 in CLI args for human friendliness.
 *
 * Active phase detection: .phase[data-active] — set by phase-orchestrator subscription.
 * Transition settle time: SCROLL_LOCK_MANUAL_MS = 1200ms in orchestrator, we wait 1500ms.
 *
 * Preloader: #preloader fades after ~3800ms boot sequence + flash via #preFlash.
 *            We wait for #preloader to have class 'done', with 10s max timeout.
 *
 * Usage:
 *   node qa/take-shots.mjs [--out <dir>] [--phase <n>] [--viewports <list>]
 *
 * Chromium: uses /opt/homebrew/bin/chromium (macOS Homebrew).
 *           Falls back to env CHROMIUM_PATH if set.
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--phase') args.phase = argv[++i];
    else if (argv[i] === '--viewports') args.viewports = argv[++i];
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:4321';

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = cliArgs.out
  ? path.resolve(cliArgs.out)
  : path.join(REPO_ROOT, 'qa', 'screenshots', TIMESTAMP);

// Phases requested (1-indexed in CLI, 0-indexed internally)
const ALL_PHASES = [0, 1, 2, 3, 4];
const PHASES = cliArgs.phase
  ? cliArgs.phase.split(',').map((p) => parseInt(p.trim(), 10) - 1)
  : ALL_PHASES;

// Viewports: width only; height calculated below
const DEFAULT_VIEWPORTS = [375, 480, 640, 768, 1024, 1280, 1920];
const VIEWPORTS = cliArgs.viewports
  ? cliArgs.viewports.split(',').map((v) => parseInt(v.trim(), 10))
  : DEFAULT_VIEWPORTS;

// Chromium binary
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH || '/opt/homebrew/bin/chromium';

// Phases that have internal scroll content (0-indexed)
// DataRoom = phase 3 (Prova), Diagnose = phase 4 (Diagnose)
const SCROLLABLE_PHASES = new Set([3, 4]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function viewportHeight(width) {
  return width <= 480 ? 667 : Math.round(width * (9 / 16));
}

async function waitForPreloaderDone(page, timeoutMs = 12000) {
  try {
    // Wait for #preloader to get class 'done' (fires after ~3.8s boot)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('preloader');
        return !el || el.classList.contains('done');
      },
      { timeout: timeoutMs }
    );
    // Extra buffer for flash + scramble to settle
    await sleep(600);
  } catch {
    console.warn('  [warn] preloader timeout — continuing anyway');
  }
}

async function navigateToPhase(page, phaseIdx) {
  // Try __phaseStore first (DEV mode global)
  const success = await page.evaluate((idx) => {
    if (window.__phaseStore && typeof window.__phaseStore.goToPhase === 'function') {
      window.__phaseStore.goToPhase(idx);
      return true;
    }
    // Fallback: CustomEvent (same path TopNav uses)
    window.dispatchEvent(
      new CustomEvent('hud:goto-phase', { detail: { phase: idx } })
    );
    return false;
  }, phaseIdx);

  if (!success) {
    console.log(`    [nav] used hud:goto-phase fallback for phase ${phaseIdx}`);
  }

  // Wait for transition to settle (orchestrator uses SCROLL_LOCK_MANUAL_MS = 1200ms)
  await sleep(1500);
}

async function scrollToBottom(page) {
  // Find active phase element and scroll it to bottom
  await page.evaluate(() => {
    const el = document.querySelector('.phase[data-active]');
    if (el) el.scrollTop = el.scrollHeight;
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(400);
}

async function scrollToTop(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.phase[data-active]');
    if (el) el.scrollTop = 0;
    else window.scrollTo(0, 0);
  });
  await sleep(200);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runViewport(browser, width, consoleErrorsMap, summary) {
  const height = viewportHeight(width);
  const label = `${width}w`;
  console.log(`\n[viewport] ${width}x${height}`);

  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Collect console errors
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({ type: 'console.error', text: msg.text() });
      }
    });
    page.on('pageerror', (err) => {
      errors.push({ type: 'pageerror', text: err.message });
    });

    // Navigate
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for preloader boot sequence to complete
    console.log('  waiting for preloader...');
    await waitForPreloaderDone(page);
    console.log('  preloader done');

    // Screenshot each phase
    for (const phaseIdx of PHASES) {
      const phaseLabel = phaseIdx + 1; // human-readable 1-5
      console.log(`  phase ${phaseLabel}...`);

      await navigateToPhase(page, phaseIdx);

      // Primary screenshot (viewport, no scroll)
      const filename = `${label}-phase${phaseLabel}.png`;
      const filepath = path.join(OUT_DIR, filename);
      await page.screenshot({ path: filepath, fullPage: false });
      console.log(`    saved ${filename}`);
      summary.push({ file: filename, viewport: width, phase: phaseLabel, scrolled: false });

      // Scrolled screenshot for phases with internal overflow
      if (SCROLLABLE_PHASES.has(phaseIdx)) {
        await scrollToBottom(page);
        const scrollFilename = `${label}-phase${phaseLabel}-scrolled.png`;
        const scrollFilepath = path.join(OUT_DIR, scrollFilename);
        await page.screenshot({ path: scrollFilepath, fullPage: false });
        console.log(`    saved ${scrollFilename}`);
        summary.push({
          file: scrollFilename,
          viewport: width,
          phase: phaseLabel,
          scrolled: true,
        });
        await scrollToTop(page);
      }
    }

    consoleErrorsMap[label] = errors;
    if (errors.length > 0) {
      console.log(`  [errors] ${errors.length} console error(s) captured`);
    }
  } catch (err) {
    console.error(`  [FAIL] viewport ${width}: ${err.message}`);
    consoleErrorsMap[label] = [{ type: 'viewport-crash', text: err.message }];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function main() {
  // Ensure output directory exists
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Phases: ${PHASES.map((p) => p + 1).join(', ')}`);
  console.log(`Viewports: ${VIEWPORTS.join(', ')}`);
  console.log(`Chromium: ${CHROMIUM_PATH}`);

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // Allow WebGL (Three.js)
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

  const consoleErrorsMap = {};
  const summary = [];

  try {
    // Process viewports sequentially to avoid memory pressure
    for (const width of VIEWPORTS) {
      await runViewport(browser, width, consoleErrorsMap, summary);
    }
  } finally {
    await browser.close();
  }

  // Write console-errors.json
  const errorsPath = path.join(OUT_DIR, 'console-errors.json');
  await fs.writeFile(errorsPath, JSON.stringify(consoleErrorsMap, null, 2));
  console.log(`\nconsole-errors.json written (${errorsPath})`);

  // Write summary.json
  const summaryPath = path.join(OUT_DIR, 'summary.json');
  await fs.writeFile(
    summaryPath,
    JSON.stringify({ timestamp: TIMESTAMP, outDir: OUT_DIR, shots: summary }, null, 2)
  );
  console.log(`summary.json written — ${summary.length} screenshots`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
