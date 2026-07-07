// QA-only capture of the reworked brain genesis sequence.
// Connects to the shared chromium pool over CDP, drives the preview build with
// ?bootDebug=<p> (freezes bootProgress at p, parks camera far), and screenshots.
//
// Not shipped — lives in qa/ for this review only.

import puppeteer from "puppeteer-core";

const POOL = "ws://chromium-shared-rtl1qg:3100";
const BASE = "http://10.0.1.74:4399/";
const OUT = "/home/agent/vhxco/vhxco/.claude/worktrees/phase4b2-noold/qa/screenshots/phase4b2-genesis";

// [bootProgress, width, height, label]
const SHOTS = [
  [0.15, 1920, 1080, "genesis-0.15-1920"],
  [0.3, 1920, 1080, "genesis-0.30-1920"],
  [0.45, 1920, 1080, "genesis-0.45-1920"],
  [0.6, 1920, 1080, "genesis-0.60-1920"],
  [0.75, 1920, 1080, "genesis-0.75-1920"],
  [0.85, 1920, 1080, "genesis-0.85-1920"],
  [1.0, 1920, 1080, "genesis-1.00-1920"],
  [0.6, 375, 667, "genesis-0.60-375"],
  [1.0, 375, 667, "genesis-1.00-375"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.connect({ browserWSEndpoint: POOL });
  try {
    for (const [p, w, h, label] of SHOTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      const url = `${BASE}?bootDebug=${p}`;
      const errs = [];
      page.on("console", (m) => {
        if (m.type() === "error") errs.push(m.text());
      });
      page.on("pageerror", (e) => errs.push("PAGEERR " + e.message));
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // RAF render loop never idles the network — wait a fixed beat for the
      // client:only React island to hydrate, WebGL to warm up on SwiftShader,
      // and the frozen genesis frame to paint.
      await sleep(6000);
      // Confirm bootProgress is actually frozen at p (sanity).
      const bp = await page.evaluate(() => {
        // boot-progress store isn't global; read the canvas presence instead.
        const c = document.querySelector("canvas");
        return c ? `${c.width}x${c.height}` : "no-canvas";
      });
      const file = `${OUT}/${label}.png`;
      await page.screenshot({ path: file });
      console.log(
        `[shot] p=${p} ${w}x${h} canvas=${bp} errs=${errs.length}${errs.length ? " :: " + errs.slice(0, 3).join(" | ") : ""} -> ${file}`,
      );
      await page.close();
    }
  } finally {
    await browser.disconnect();
  }
}

main().catch((e) => {
  console.error("CAPTURE FAILED", e);
  process.exit(1);
});
