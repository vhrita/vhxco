// boot-driver.ts
//
// Pure driver for the boot/loading sequence. NO visual chrome of its own —
// the ONLY loading UI is the brain forming on the canvas, driven by the
// bootProgress store (uBootProgress uniform, read in render-loop.ts).
//
// Replaces the old Preloader.astro overlay (rings / SYNAPSE OS meta / progress
// bar / boot-step ticker / white flash), which was removed. This module keeps
// only the *behavior*:
//   - RAF loop advancing bootProgress 0 → 1 over TOTAL_MS (forms the brain)
//   - onBootComplete() dispatches window 'bootComplete' (drives dolly + reveal)
//   - [data-scramble] plain-text reveal after completion
//   - prefers-reduced-motion: jump to 1.0 + complete in 200ms, no scramble anim
//
// Imported for side-effects by BaseLayout.astro (client script). Idempotent.

import { bootProgress } from '@/lib/neural-engine/boot-progress';

// Formation time of the brain. Was 4600 (progressive genesis: staggered soma
// births 0→0.70 + per-edge axon growth). Trimmed 4600 → 2600 (−2000ms) per Vitor
// — the genesis still reads (network substantially formed by ~0.82 ≈2.1s) but the
// loading feels ~2s snappier before the dolly fires at 1.0 (render-loop.ts intro
// state machine). ONLY the genesis duration changed; the mechanic (bootProgress
// 0→1, dolly handoff, journey:intro-done) is untouched.
const TOTAL_MS = 2600;

// Char pool for the [data-scramble] reveal effect.
const SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:',.<>?/~`";

let _started = false;

/**
 * Start the boot driver. Safe to call once; subsequent calls are no-ops.
 */
export function startBootDriver(): void {
  if (_started) return;
  _started = true;

  // ── QA-only boot-debug hook (opt-in via ?bootDebug=<0..1>) ─────────────────
  // Freezes the genesis at a fixed bootProgress so QA can capture deterministic
  // frames of the brain FORMING (nodes sprouting, axons growing) instead of
  // racing the ~4.6s RAF. NO effect unless the flag is present → production
  // untouched. Mirrors the ?introDebug pattern already in render-loop.ts.
  //   ?bootDebug=0.45  → sets bootProgress=0.45 and stops the driver there.
  //   ?bootDebug       → (no value) defaults to 0.5.
  // The camera parks far (render-loop treats bootDebug like introDebug), so the
  // whole forming network is framed for the shot.
  const bootDebugMatch =
    typeof window !== "undefined"
      ? /[?&]bootDebug(?:=([0-9]*\.?[0-9]+))?\b/.exec(window.location.search)
      : null;
  if (bootDebugMatch) {
    const p = bootDebugMatch[1] !== undefined ? parseFloat(bootDebugMatch[1]) : 0.5;
    bootProgress.set(Math.max(0, Math.min(1, p)));
    // Do NOT start the RAF driver — hold this frozen value indefinitely.
    return;
  }

  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  // ── Scramble helper ───────────────────────────────────────────────────────
  // Shuffles characters of a text element, then resolves to the real text.
  function scrambleHeading(el: HTMLElement, durationMs: number): void {
    if (reducedMotion) {
      el.style.opacity = '0';
      requestAnimationFrame(() => {
        el.style.transition = `opacity 400ms ease`;
        el.style.opacity = '1';
      });
      return;
    }

    const original = el.textContent ?? '';
    const chars = original.split('');
    const settled = new Array(chars.length).fill(false);
    const startTime = performance.now();

    function tick(now: number): void {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      let allDone = true;
      const result = chars.map((ch, i) => {
        if (ch === ' ' || ch === '\n') return ch;
        const threshold = (i + 1) / chars.length;
        if (progress >= threshold || settled[i]) {
          settled[i] = true;
          return ch;
        }
        allDone = false;
        return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      });

      el.textContent = result.join('');

      if (!allDone) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = original; // guarantee final state
      }
    }

    requestAnimationFrame(tick);
  }

  // ── Completion handler ────────────────────────────────────────────────────
  // No visual chrome to tear down anymore — just fire the event + reveal content.
  function onBootComplete(): void {
    const delay = reducedMotion ? 0 : 400;
    setTimeout(() => {
      // Phase components subscribe to this to run HTML-aware scramble + dolly.
      window.dispatchEvent(new CustomEvent('bootComplete'));

      // Scramble plain-text [data-scramble] elements (no HTML children).
      const targets = document.querySelectorAll<HTMLElement>('[data-scramble]');
      targets.forEach((el, i) => {
        if (el.childElementCount > 0) return;
        const duration = 600 + i * 100;
        scrambleHeading(el, duration);
      });
    }, delay);
  }

  // ── Main boot tick ────────────────────────────────────────────────────────
  if (reducedMotion) {
    bootProgress.set(1.0);
    setTimeout(onBootComplete, 200);
    return;
  }

  const start = performance.now();

  function tickBoot(now: number): void {
    const elapsed = now - start;
    const progress = Math.min(elapsed / TOTAL_MS, 1.0);

    bootProgress.set(progress);

    if (progress < 1.0) {
      requestAnimationFrame(tickBoot);
    } else {
      onBootComplete();
    }
  }
  requestAnimationFrame(tickBoot);
}
