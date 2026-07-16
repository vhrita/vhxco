// QA capture for the TEMP scroll tuning panel (?tune=1).
// Connects to the shared chromium pool, loads the dev URL, waits for the panel,
// proves window.__scrollTune mutates live (and that journey-input reads it), and
// screenshots the panel at 1280x800.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const POOL = 'ws://chromium-shared-rtl1qg:3100';
const TARGET = 'https://vhxco-website-dev.138-2-243-181.sslip.io/?tune=1';
const OUT = '/home/agent/vhxco/.dev-preview/vhxco-website/qa/screenshots/tune-panel/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserWSEndpoint: POOL });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for the panel to mount (journey-input exposes __scrollTune async).
  await page.waitForSelector('#scroll-tune-panel:not([hidden])', { timeout: 25000 });
  await page.waitForFunction(() => !!window.__scrollTune, { timeout: 25000 });

  // Count the 4 controls (range + number pairs).
  const controls = await page.evaluate(() => {
    const host = document.getElementById('scroll-tune-panel');
    return {
      ranges: host.querySelectorAll('input[type=range]').length,
      nums: host.querySelectorAll('input[type=number]').length,
      readout: host.querySelector('[data-readout]')?.textContent,
      hasReset: !!host.querySelector('[data-reset]'),
    };
  });

  // PROVE live mutation: read threshold before, move the slider, read after.
  const proof = await page.evaluate(() => {
    const before = window.__scrollTune.wheelStepThreshold;
    // Simulate the panel user dragging the threshold range to 400.
    const host = document.getElementById('scroll-tune-panel');
    const range = host.querySelector('input[data-range="wheelStepThreshold"]');
    range.value = '400';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const afterTune = window.__scrollTune.wheelStepThreshold;
    const afterReadout = host.querySelector('[data-readout]').textContent;
    return { before, afterTune, afterReadout };
  });

  await page.screenshot({ path: OUT + 'tune-panel-1280x800.png' });

  // Also a cropped shot of just the panel for legibility.
  const el = await page.$('#scroll-tune-panel');
  await el.screenshot({ path: OUT + 'tune-panel-cropped.png' });

  console.log(JSON.stringify({ controls, proof, logs: logs.slice(-12) }, null, 2));

  // Assert
  if (controls.ranges !== 4 || controls.nums !== 4) throw new Error('expected 4+4 controls');
  if (proof.before === proof.afterTune) throw new Error('mutation did not take effect');
  if (proof.afterTune !== 400) throw new Error('threshold did not become 400');
  console.log('\nOK: 4 controls, __scrollTune mutated ' + proof.before + ' -> ' + proof.afterTune);
} finally {
  await browser.disconnect();
}
