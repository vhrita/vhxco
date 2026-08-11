/**
 * qa/shortheight-grid.mjs — Grid measurement rig for the short-height top-jam bug.
 *
 * Reproduces + measures the Diagnose (stop 5) + Contato (stop 6) terminal panels
 * across a width×height grid on Chromium. For each cell it measures the .stop-inner
 * block's gaps on BOTH axes (top/bottom/left/right) relative to the viewport, plus
 * whether the content actually OVERFLOWS the viewport (scrollHeight > innerHeight).
 *
 * The bug: `@media (max-height:760px){ .is-terminal-stop{ align-items:flex-start } }`
 * top-jams the panel even when it FITS — leaving a big empty gap below.
 *
 * Serves the local production BUILD (dist/) via `astro preview`. Run `astro build`
 * first. Output tag (before/after) passed as argv[2].
 */

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TAG = process.argv[2] || "run";
const SHOT = process.argv.includes("--shots");
const OUT_DIR = path.join(REPO_ROOT, "qa", "screenshots", "shortheight-fix");
const PORT = 4400;
const BASE_URL = `http://[::1]:${PORT}`;
const CHROME = "/tmp/pw-browsers/chromium-1234/chrome-linux/chrome";
process.env.LD_LIBRARY_PATH = `/tmp/chrome-libroot/flat:${process.env.LD_LIBRARY_PATH || ""}`;

const FORM_STOP = 5; // Diagnose (06)
const CONTACT_STOP = 6; // Contato (07)

const WIDTHS = [375, 390, 411, 500, 700, 900, 1100, 1280];
const HEIGHTS = [480, 600, 667, 740, 759, 760, 800];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startPreview() {
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
    await sleep(800);
  }
  console.error("[preview] timeout. Log:\n", log.slice(-1500));
  try {
    proc.kill("SIGKILL");
  } catch {}
  throw new Error("preview timeout");
}

async function waitReveal(page) {
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      boot: document.body.dataset.boot || null,
      intro: document.body.dataset.intro || null,
    }));
    if (!s.boot && s.intro !== "active") break;
    await sleep(400);
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
  await sleep(900);
}

async function measure(page, stopIdx) {
  return page.evaluate((idx) => {
    const stop = document.querySelector(`.journey-stop[data-stop="${idx}"]`);
    if (!stop) return { error: "no journey-stop" };
    const inner = stop.querySelector(".stop-inner");
    if (!inner) return { error: "no stop-inner" };
    const r = inner.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gapL = Math.round(r.left);
    const gapR = Math.round(vw - r.right);
    const gapT = Math.round(r.top);
    const gapB = Math.round(vh - r.bottom);
    const cs = getComputedStyle(stop);
    return {
      vw,
      vh,
      innerW: Math.round(r.width),
      innerH: Math.round(r.height),
      gapT,
      gapB,
      gapL,
      gapR,
      dX: gapL - gapR, // >0 = pinned left
      dY: gapT - gapB, // <0 = pinned top (gap below)
      overflow: Math.round(r.height) > vh, // panel taller than viewport
      alignItems: cs.alignItems,
      justify: cs.justifyContent,
      flexDir: cs.flexDirection,
    };
  }, stopIdx);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dev = await startPreview();
  console.log("[preview] ready");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
  });

  const rows = [];
  for (const stop of [FORM_STOP, CONTACT_STOP]) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("vhxco_lang", "pt");
      } catch {}
    });
    // navigate once at a neutral size, then resize per cell
    await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
    await page.goto(BASE_URL + "/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await waitReveal(page);
    await gotoStop(page, stop);

    for (const h of HEIGHTS) {
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await sleep(250);
        const m = await measure(page, stop);
        rows.push({ stop, w, h, ...m });
        if (
          SHOT &&
          (w === 390 || w === 1100) &&
          (h === 667 || h === 480 || h === 800)
        ) {
          const label = stop === FORM_STOP ? "06form" : "07contact";
          await page.screenshot({
            path: path.join(OUT_DIR, `${TAG}-${label}-${w}x${h}.png`),
          });
        }
      }
    }
    await page.close();
  }

  // dump JSON + a readable table
  fs.writeFileSync(
    path.join(OUT_DIR, `measures-${TAG}.json`),
    JSON.stringify(rows, null, 2),
  );
  const fmt = (n) => String(n).padStart(5);
  const lines = [];
  for (const stop of [FORM_STOP, CONTACT_STOP]) {
    lines.push(
      `\n=== STOP ${stop === FORM_STOP ? "06 (Diagnose/form)" : "07 (Contato)"} — TAG=${TAG} ===`,
    );
    lines.push(
      `  ${["w", "h", "gapT", "gapB", "gapL", "gapR", "dX", "dY", "ovf", "align"].map((s) => String(s).padStart(5)).join(" ")}`,
    );
    for (const r of rows.filter((x) => x.stop === stop)) {
      if (r.error) {
        lines.push(`  ${r.w}x${r.h} ERROR ${r.error}`);
        continue;
      }
      const flag = [];
      if (!r.overflow && r.gapB - r.gapT > 40) flag.push("TOPJAM");
      if (Math.abs(r.dX) > 12) flag.push("XPIN");
      lines.push(
        `  ${[r.w, r.h, r.gapT, r.gapB, r.gapL, r.gapR, r.dX, r.dY, r.overflow ? "Y" : "n", r.alignItems].map((s) => String(s).padStart(5)).join(" ")}  ${flag.join(",")}`,
      );
    }
  }
  const table = lines.join("\n");
  fs.writeFileSync(path.join(OUT_DIR, `table-${TAG}.txt`), table);
  console.log(table);

  await browser.close();
  try {
    dev.kill("SIGKILL");
  } catch {}
  console.log(`\n[done] wrote measures-${TAG}.json / table-${TAG}.txt`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
