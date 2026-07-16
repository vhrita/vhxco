import puppeteer from 'puppeteer-core';
const b = await puppeteer.connect({ browserWSEndpoint: 'ws://chromium-shared-rtl1qg:3100' });

// (A) Gate proof: WITHOUT ?tune → panel must NOT show.
const p0 = await b.newPage();
await p0.goto('https://vhxco-website-dev.138-2-243-181.sslip.io/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise(r => setTimeout(r, 5000));
const gate = await p0.evaluate(() => ({
  panelHidden: document.getElementById('scroll-tune-panel')?.hidden,
  panelHTML: (document.getElementById('scroll-tune-panel')?.innerHTML || '').length,
  hasScrollTune: !!window.__scrollTune, // still exposed (DEV), just no panel
}));
await p0.close();

// (B) Live-read proof: mutate threshold, then drive wheel and observe stop advance.
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
const logs = [];
p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
await p.goto('https://vhxco-website-dev.138-2-243-181.sslip.io/?tune=1', { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForFunction(() => !!window.__scrollTune && !!window.__journeyInput, { timeout: 25000 });
await new Promise(r => setTimeout(r, 1500));

const live = await p.evaluate(async () => {
  const tune = window.__scrollTune;
  const ji = window.__journeyInput;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Helper: dispatch N wheel events of +deltaY on window (px mode).
  const spin = (n, dy) => {
    for (let i = 0; i < n; i++) {
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, cancelable: true, bubbles: true }));
    }
  };

  // --- CASE 1: TINY threshold=60 → few notches advance a stop ---
  tune.reset();
  tune.wheelStepThreshold = 60;
  tune.settleMs = 0;      // kill the stick so accumulation is unimpeded for the test
  tune.settleDamp = 1;
  const startA = ji.getActiveStop();
  // per-event cap = threshold*0.95 = 57; one event of 100px counts as 57 → 2 events cross 60
  spin(2, 100);
  await sleep(700);
  const afterA = ji.getActiveStop();

  // --- CASE 2: HUGE threshold=500 → same 2 events should NOT advance ---
  // reset to stop 0 first
  window.__journey?.setJourneyProgress?.(0);
  await sleep(300);
  tune.wheelStepThreshold = 500;
  const startB = ji.getActiveStop();
  spin(2, 100); // capped at 475/event → but 2×475=950 ≥ 500 would advance... use 1 event
  // Actually test with ONE event: cap=475 < 500 → cannot cross → no advance.
  const startB1 = ji.getActiveStop();
  // reset accum by waiting out idle decay
  await sleep(300);
  spin(1, 100);
  await sleep(400);
  const afterB1 = ji.getActiveStop();

  return { startA, afterA, thr60_advanced: afterA > startA,
           startB1, afterB1, thr500_singleEvent_advanced: afterB1 > startB1 };
});

console.log('GATE (no ?tune):', JSON.stringify(gate));
console.log('LIVE-READ:', JSON.stringify(live, null, 2));
console.log('LOGS:', JSON.stringify(logs.filter(l=>l.includes('scroll-tune')), null, 2));
await b.disconnect();
