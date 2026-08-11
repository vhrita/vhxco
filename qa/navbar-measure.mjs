/**
 * navbar-measure.mjs — TopNav crowding validation (7-item nav).
 *
 * Drives LOCAL chromium (playwright-core + /tmp/chrome-libroot shim) against the
 * local dev server. For each viewport width it measures getBoundingClientRect of:
 *   - .topnav-logo (right edge)
 *   - first chapter's VISIBLE label (left edge)  — logo overlap check
 *   - last chapter's VISIBLE label (right edge)   — lang-toggle overlap check
 *   - .topnav-lang (left edge)
 *   - .topnav-chapters container width + nav overflow
 *   - burger visible? (hamburger mode)
 * Screenshots the top nav band per width.
 *
 * Usage: LD_LIBRARY_PATH=/tmp/chrome-libroot/flat node qa/navbar-measure.mjs
 */
import pkg from "/home/agent/vhxco/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "qa/screenshots/navbar-fix");
const EXE = "/home/agent/.cache/ms-playwright/chromium-1228/chrome-linux/chrome";
const URL = "http://127.0.0.1:4321/";
const WIDTHS = [1024, 1100, 1180, 1200, 1280, 1920];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const results = [];
for (const w of WIDTHS) {
  const page = await browser.newPage({
    viewport: { width: w, height: 800 },
    locale: "pt-BR",
    extraHTTPHeaders: { "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the boot gate to lift — the TopNav is opacity:0 + clip-path:inset(100%)
  // while body[data-boot="loading"]. Screenshot would be blank otherwise.
  await page
    .waitForFunction(() => document.body.dataset.boot !== "loading", { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1200); // fade-in (500ms) + settle

  const m = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
    };
    const visibleLabel = (chapterEl) => {
      // returns the rect of whichever label span is display:inline (num is always in)
      const spans = chapterEl.querySelectorAll("span");
      let leftmost = null, rightmost = null;
      spans.forEach((s) => {
        if (getComputedStyle(s).display === "none") return;
        const r = s.getBoundingClientRect();
        if (r.width === 0) return;
        if (!leftmost || r.left < leftmost.left) leftmost = r;
        if (!rightmost || r.right > rightmost.right) rightmost = r;
      });
      return {
        left: leftmost ? Math.round(leftmost.left) : null,
        right: rightmost ? Math.round(rightmost.right) : null,
      };
    };
    const chapters = Array.from(document.querySelectorAll(".topnav-chapter"));
    const first = chapters[0];
    const last = chapters[chapters.length - 1];
    const nav = q(".topnav");
    const container = q(".topnav-chapters");
    const burger = q(".topnav-burger");
    const activeVariant = (() => {
      const c = first;
      const full = c.querySelector(".topnav-lbl-full");
      const short = c.querySelector(".topnav-chapter-lbl-short");
      if (full && getComputedStyle(full).display !== "none") return "full";
      if (short && getComputedStyle(short).display !== "none") return "short";
      return "num-only";
    })();
    return {
      htmlLang: document.documentElement.lang,
      logo: rect(q(".topnav-logo")),
      firstChapterLabel: visibleLabel(first),
      firstChapterText: first.textContent.replace(/\s+/g, " ").trim(),
      lastChapterLabel: visibleLabel(last),
      lastChapterText: last.textContent.replace(/\s+/g, " ").trim(),
      lang: rect(q(".topnav-lang")),
      containerW: container ? Math.round(container.getBoundingClientRect().width) : null,
      containerRemAt16: container ? +(container.getBoundingClientRect().width / 16).toFixed(1) : null,
      navScrollW: nav ? nav.scrollWidth : null,
      navClientW: nav ? nav.clientWidth : null,
      navOverflow: nav ? nav.scrollWidth - nav.clientWidth : null,
      burgerVisible: burger ? getComputedStyle(burger).display !== "none" : false,
      labelVariant: activeVariant,
    };
  });

  // checks
  const logoOverlapFirst =
    !m.burgerVisible && m.logo && m.firstChapterLabel.left != null
      ? m.logo.r > m.firstChapterLabel.left
      : false;
  const lastOverlapLang =
    !m.burgerVisible && m.lang && m.lastChapterLabel.right != null
      ? m.lastChapterLabel.right > m.lang.l
      : false;
  const hasOverflow = (m.navOverflow ?? 0) > 1;

  const pass = !logoOverlapFirst && !lastOverlapLang && !hasOverflow;

  const shot = path.join(OUT_DIR, `navbar-${w}.png`);
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: w, height: 90 } });

  const rec = {
    width: w,
    burger: m.burgerVisible,
    variant: m.labelVariant,
    containerPx: m.containerW,
    containerRem: m.containerRemAt16,
    logoRight: m.logo?.r,
    firstLabelLeft: m.firstChapterLabel.left,
    firstText: m.firstChapterText,
    logoOverlapsFirst: logoOverlapFirst,
    gapLogoToFirst:
      m.logo && m.firstChapterLabel.left != null ? m.firstChapterLabel.left - m.logo.r : null,
    lastLabelRight: m.lastChapterLabel.right,
    lastText: m.lastChapterText,
    langLeft: m.lang?.l,
    lastOverlapsLang: lastOverlapLang,
    gapLastToLang:
      m.lang && m.lastChapterLabel.right != null ? m.lang.l - m.lastChapterLabel.right : null,
    navOverflow: m.navOverflow,
    PASS: pass,
    shot,
  };
  results.push(rec);
  console.log(
    `${w}px [${m.htmlLang}] | ${m.burgerVisible ? "BURGER" : "horizontal"} var=${m.labelVariant} ` +
      `cont=${m.containerW}px(${m.containerRemAt16}rem) ` +
      `logoR=${m.logo?.r} first["${m.firstChapterText}"].L=${m.firstChapterLabel.left} gapL=${rec.gapLogoToFirst} ` +
      `last["${m.lastChapterText}"].R=${m.lastChapterLabel.right} langL=${m.lang?.l} gapR=${rec.gapLastToLang} ` +
      `ovf=${m.navOverflow} => ${pass ? "PASS" : "FAIL"}`,
  );
  await page.close();
}

fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
await browser.close();
console.log("\nDone.", OUT_DIR);
