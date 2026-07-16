// intro-session.ts
//
// Session-scoped "already saw the boot intro" flag.
//
// The artificial loading theater — the brain genesis (~2.6s bootProgress 0→1)
// plus the cinematic entry dolly — is a FIRST-ARRIVAL flourish. On any later
// navigation within the same tab session (notably a PT↔EN language switch, which
// is a full page load to `/` or `/en/`), we must NOT replay it: the visitor has
// already seen the impactful arrival. Instead the content is revealed immediately
// (reusing the instant reduced-motion path — brain already formed, no genesis, no
// dolly). "If a real load is needed, it costs only its real time, never the staged
// 2.6s."
//
// Mechanism: a flag in sessionStorage (scoped to the tab session — cleared when
// the tab closes, so a brand-new session always gets the full intro again). The
// flag is SET in two places (see callers):
//   1. on `journey:intro-done` — the normal completion of the first intro.
//   2. on a PT/EN language-toggle click — covers switching language DURING the
//      genesis, before intro-done has had a chance to fire.
// It is READ at page load by the boot driver (skip genesis) and the render loop
// (skip dolly).
//
// Storage key is shared with the inline reveal script in BaseLayout.astro and the
// language-toggle handler in TopNav.astro — keep them in sync.

const INTRO_SEEN_KEY = "vhxco_intro_seen";

/** True if the boot intro has already played in this tab session. */
export function hasSeenIntro(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    // Storage blocked (private mode / disabled) → degrade to always-play-intro.
    return false;
  }
}

/** Record that the intro has played (or been intentionally skipped) this session. */
export function markIntroSeen(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Storage blocked — degrade gracefully (worst case: intro replays).
  }
}
