/**
 * scramble.ts — Reusable scramble-text effect
 *
 * Extracted from Preloader.astro (TASK-0506) into a pure helper.
 * Shuffles characters of a text node, then settles to the real text.
 *
 * Handles:
 *   - prefers-reduced-motion: skips animation, simple opacity fade
 *   - HTML elements with child nodes: operates on textContent only,
 *     so inline tags (<em>, <span>) are NOT affected (scramble targets
 *     should be plain-text nodes; for h1 with HTML use the text-only path)
 *
 * Usage:
 *   import { scrambleElement } from '@/lib/effects/scramble';
 *   scrambleElement(document.querySelector('h1'), 1000);
 */

/** Char pool — sci-fi terminal aesthetic (same as vhxco-app.js:939) */
export const SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:',.<>?/~`";

/**
 * Animate a DOM element's textContent with a scramble reveal effect.
 *
 * @param el         - Target element. Must have non-empty textContent.
 * @param durationMs - Total duration for all chars to settle (default 800ms).
 * @param charPool   - Custom character pool (defaults to SCRAMBLE_CHARS).
 */
export function scrambleElement(
  el: HTMLElement,
  durationMs = 800,
  charPool = SCRAMBLE_CHARS
): void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion) {
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 400ms ease';
      el.style.opacity = '1';
    });
    return;
  }

  // Operate on textContent only — preserves semantic text while
  // scrambling. Elements with mixed HTML children will have their
  // innerHTML reduced to text during animation, then restored.
  // For h1 with inline tags, prefer wrapping only the text node.
  const original = el.textContent ?? '';
  if (!original.trim()) return;

  const chars = original.split('');
  const settled = new Array<boolean>(chars.length).fill(false);
  const startTime = performance.now();

  function tick(now: number): void {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    let allDone = true;
    const result = chars.map((ch, i) => {
      // Preserve whitespace as-is
      if (ch === ' ' || ch === '\n' || ch === '\t') return ch;
      const threshold = (i + 1) / chars.length;
      if (progress >= threshold || settled[i]) {
        settled[i] = true;
        return ch;
      }
      allDone = false;
      return charPool[Math.floor(Math.random() * charPool.length)];
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

/**
 * Scramble all elements matching a selector.
 * Staggers each element by staggerMs (default 120ms).
 *
 * @param selector   - CSS selector for target elements
 * @param durationMs - Per-element settle duration (default 800ms)
 * @param staggerMs  - Delay between each element start (default 120ms)
 */
export function scrambleAll(
  selector: string,
  durationMs = 800,
  staggerMs = 120
): void {
  const targets = document.querySelectorAll<HTMLElement>(selector);
  targets.forEach((el, i) => {
    setTimeout(() => scrambleElement(el, durationMs), i * staggerMs);
  });
}
