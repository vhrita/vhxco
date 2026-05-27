/**
 * void-check.mjs — Phase 4b-1 void validation rig.
 *
 * Drives the journey slider over t ∈ [0, 0.1, ..., 1.0] using the
 * /dev/engine-smoke/ page slider. Captures 11 PNGs to qa/screenshots/phase4b1-void/.
 * Measures non-black pixel ratio in the central canvas region (excludes HUD and slider).
 *
 * Uses puppeteer-core + Chrome-for-Testing with ANGLE Metal for real WebGL rendering.
 *
 * Usage: node qa/void-check.mjs
 * Prerequisites: pnpm build && python3 -m http.server 4321 --directory dist
 *               (run the server in a separate terminal before this script)
 */

import puppeteer from "../node_modules/.pnpm/puppeteer-core@23.11.1/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/phase4b1-void");

const CHROME_EXEC =
  "/Users/vitor/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const CHROME_ARGS = [
  "--no-sandbox",
  "--use-angle=metal",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--enable-gpu",
];

const VIEWPORT = { width: 1280, height: 800 };
const BOOT_WAIT_MS = 4500; // wait for Three.js boot (~3.8s observed)
const RAF_WAIT_FRAMES = 3;
const RAF_WAIT_MS = RAF_WAIT_FRAMES * (1000 / 60); // ~50ms

// Central region crop — exclude top-left HUD and bottom slider
// Margins: 20% from each edge → central 60%x60% of viewport
const CROP_MARGIN_X = 0.2;
const CROP_MARGIN_Y = 0.15; // top HUD is smaller vertically
const CROP_BOTTOM_MARGIN = 0.2; // slider sits at bottom

// Luminance threshold: pixel considered "non-black" if any channel > 12/255
const BLACK_THRESHOLD = 12;

// Minimum non-black ratio to pass void check
const VOID_PASS_THRESHOLD = 0.03; // 3% of central pixels must be lit

function measureVoid(imageBuffer, viewportW, viewportH) {
  // imageBuffer is raw RGBA from puppeteer screenshot({ type: 'png', encoding: 'binary' })
  // We need to parse PNG. Use a simple approach: get pixel data via canvas.
  // Instead, we'll return null here and measure in the browser context.
  return null;
}

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

async function measureVoidInBrowser(
  page,
  cropMarginX,
  cropMarginY,
  cropBottomMargin,
  blackThreshold,
) {
  return page.evaluate(
    (marginX, marginY, bottomMargin, threshold) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return { ratio: 0, error: "no canvas" };

      const w = canvas.width;
      const h = canvas.height;

      // Crop region (central area, exclude HUD top-left and slider bottom)
      const x0 = Math.floor(w * marginX);
      const y0 = Math.floor(h * marginY);
      const x1 = Math.floor(w * (1 - marginX));
      const y1 = Math.floor(h * (1 - bottomMargin));

      const cropW = x1 - x0;
      const cropH = y1 - y0;

      if (cropW <= 0 || cropH <= 0) return { ratio: 0, error: "bad crop" };

      // Copy WebGL canvas to an offscreen 2D canvas, then readback via getImageData.
      // Direct getContext('webgl2') on a canvas already owned by Three.js returns null —
      // this 2D blit approach bypasses that limitation.
      const offscreen = document.createElement("canvas");
      offscreen.width = cropW;
      offscreen.height = cropH;
      const ctx2d = offscreen.getContext("2d");
      if (!ctx2d) return { ratio: 0, error: "no 2d context" };

      // drawImage reads the last committed frame of the WebGL canvas
      ctx2d.drawImage(canvas, x0, y0, cropW, cropH, 0, 0, cropW, cropH);

      let imageData;
      try {
        imageData = ctx2d.getImageData(0, 0, cropW, cropH);
      } catch (e) {
        return { ratio: 0, error: `getImageData: ${String(e)}` };
      }

      const pixels = imageData.data; // Uint8ClampedArray, RGBA
      let nonBlackCount = 0;
      const total = cropW * cropH;
      for (let i = 0; i < total; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];
        if (r > threshold || g > threshold || b > threshold) {
          nonBlackCount++;
        }
      }

      return {
        ratio: nonBlackCount / total,
        nonBlackCount,
        total,
        cropW,
        cropH,
        canvasW: w,
        canvasH: h,
      };
    },
    cropMarginX,
    cropMarginY,
    cropBottomMargin,
    blackThreshold,
  );
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Launching Chrome for Testing with ANGLE Metal...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_EXEC,
    headless: true,
    args: CHROME_ARGS,
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  console.log("Loading /dev/engine-smoke/ ...");
  await page.goto("http://localhost:4321/dev/engine-smoke/");
  console.log(`Waiting ${BOOT_WAIT_MS}ms for boot...`);
  await new Promise((r) => setTimeout(r, BOOT_WAIT_MS));

  const results = [];
  const tValues = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  for (const t of tValues) {
    const tStr = t.toFixed(1);
    console.log(`Capturing t=${tStr}...`);

    // Set slider value and dispatch input event
    await page.evaluate((tVal) => {
      const s = document.getElementById("journey-slider");
      if (!s) throw new Error("slider not found");
      s.value = String(tVal);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, t);

    // Wait for a few RAF cycles
    await waitRAFs(page, 5);
    await new Promise((r) => setTimeout(r, RAF_WAIT_MS));

    // Measure void in browser via WebGL readPixels
    const voidMetric = await measureVoidInBrowser(
      page,
      CROP_MARGIN_X,
      CROP_MARGIN_Y,
      CROP_BOTTOM_MARGIN,
      BLACK_THRESHOLD,
    );

    // Take screenshot
    const filename = `t${tStr.replace(".", "_")}.png`;
    const filepath = path.join(OUT_DIR, filename);
    await page.screenshot({ path: filepath });

    const passed = voidMetric.ratio >= VOID_PASS_THRESHOLD;
    results.push({
      t,
      filename,
      ratio: voidMetric.ratio,
      nonBlack: voidMetric.nonBlackCount,
      total: voidMetric.total,
      passed,
      error: voidMetric.error,
    });

    const emoji = passed ? "✓" : "✗ VOID";
    console.log(
      `  t=${tStr}: ratio=${(voidMetric.ratio * 100).toFixed(1)}% ${emoji}` +
        (voidMetric.error ? ` [${voidMetric.error}]` : ""),
    );
  }

  await browser.close();

  console.log("\n=== VOID CHECK SUMMARY ===");
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(
      `  t=${r.t.toFixed(1)}: ${status} — ${(r.ratio * 100).toFixed(1)}% non-black` +
        (r.error ? ` [err: ${r.error}]` : ""),
    );
    if (!r.passed) allPassed = false;
  }
  console.log(`\nOverall: ${allPassed ? "ALL PASS ✓" : "FAILURES DETECTED ✗"}`);
  console.log(`Screenshots saved to: ${OUT_DIR}`);

  // Write JSON results
  const jsonPath = path.join(OUT_DIR, "results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Results JSON: ${jsonPath}`);
}

run().catch((err) => {
  console.error("Void check failed:", err);
  process.exit(1);
});
