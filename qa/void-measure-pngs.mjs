/**
 * void-measure-pngs.mjs — Post-capture void metric for Phase 4b-1 PNGs.
 *
 * Reads the 11 screenshots from qa/screenshots/phase4b1-void/,
 * measures non-black pixel ratio in the central crop (excludes HUD and slider),
 * and reports per-t pass/fail.
 *
 * Usage: node qa/void-measure-pngs.mjs
 * Prereq: node qa/void-check.mjs must have run first to produce the PNGs.
 */

import sharp from "../node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/index.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/phase4b1-void");

// Central region crop (matches void-check.mjs ratios)
const CROP_MARGIN_X = 0.2;
const CROP_MARGIN_Y = 0.15;
const CROP_BOTTOM_MARGIN = 0.2;

// Luminance threshold: pixel "non-black" if any RGB channel > 12
const BLACK_THRESHOLD = 12;
// Pass threshold: ≥3% of central pixels must be lit
const VOID_PASS_THRESHOLD = 0.03;

const T_VALUES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

async function measurePng(filepath) {
  const meta = await sharp(filepath).metadata();
  const w = meta.width;
  const h = meta.height;

  const x0 = Math.floor(w * CROP_MARGIN_X);
  const y0 = Math.floor(h * CROP_MARGIN_Y);
  const cropW = Math.floor(w * (1 - 2 * CROP_MARGIN_X));
  const cropH = Math.floor(h * (1 - CROP_MARGIN_Y - CROP_BOTTOM_MARGIN));

  const { data } = await sharp(filepath)
    .extract({ left: x0, top: y0, width: cropW, height: cropH })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = meta.channels || 3;
  const totalPixels = cropW * cropH;
  let nonBlack = 0;
  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    if (r > BLACK_THRESHOLD || g > BLACK_THRESHOLD || b > BLACK_THRESHOLD) {
      nonBlack++;
    }
  }
  return {
    ratio: nonBlack / totalPixels,
    nonBlack,
    total: totalPixels,
    w,
    h,
    cropW,
    cropH,
  };
}

async function run() {
  console.log("=== PHASE 4b-1 VOID METRIC (PNG post-processing) ===\n");
  const results = [];
  let allPassed = true;

  for (const t of T_VALUES) {
    const tStr = t.toFixed(1);
    const filename = `t${tStr.replace(".", "_")}.png`;
    const filepath = path.join(OUT_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.log(`  t=${tStr}: SKIP — file not found: ${filename}`);
      continue;
    }

    const metric = await measurePng(filepath);
    const passed = metric.ratio >= VOID_PASS_THRESHOLD;
    if (!passed) allPassed = false;

    results.push({ t, filename, ...metric, passed });

    const status = passed ? "PASS" : "FAIL (VOID)";
    console.log(
      `  t=${tStr}: ${status} — ${(metric.ratio * 100).toFixed(1)}% non-black` +
        ` (${metric.nonBlack}/${metric.total} px in ${metric.cropW}x${metric.cropH} crop)`,
    );
  }

  console.log(
    `\nOverall: ${allPassed ? "ALL PASS — zero void frames" : "VOID FRAMES DETECTED"}`,
  );

  const jsonPath = path.join(OUT_DIR, "metrics.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Metrics written to: ${jsonPath}`);
}

run().catch((err) => {
  console.error("Measurement failed:", err);
  process.exit(1);
});
