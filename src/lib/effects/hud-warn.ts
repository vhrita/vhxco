// hud-warn.ts
// HUD warning flash trigger.
// Applies `hud-warn` class to all `.hud-corner` elements, triggering the
// @keyframes hudWarn CSS animation (already in global.css).
//
// Port of vhxco-app.js lines 1031-1038 (hudWarningFlash).

const WARN_CLASS = 'hud-warn';
const SELECTOR = '.hud-corner';

/**
 * Trigger the warn flash on all HUD corner elements.
 *
 * @param durationMs  How long to keep the class applied (default 500ms).
 *                    Should match the CSS animation duration.
 */
export function triggerWarnFlash(durationMs = 500): void {
  if (typeof document === 'undefined') return;

  const corners = document.querySelectorAll<HTMLElement>(SELECTOR);
  corners.forEach((el) => {
    // Force reflow to restart animation if already playing
    el.classList.remove(WARN_CLASS);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void el.offsetWidth;
    el.classList.add(WARN_CLASS);
  });

  setTimeout(() => {
    corners.forEach((el) => el.classList.remove(WARN_CLASS));
  }, durationMs);
}
