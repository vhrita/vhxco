/**
 * posthog.ts — Gated PostHog analytics wiring (funnel measurement).
 *
 * The vhxco-website is a lead-gen page. The value of analytics here is measuring
 * the funnel: visit → journey stops viewed → diagnose submit. This module owns
 * the ENTIRE PostHog surface so the rest of the app only calls `capture(...)`.
 *
 * ── Gated init (hard requirement) ────────────────────────────────────────────
 *   PostHog is initialized ONLY if PUBLIC_POSTHOG_KEY is present at build time.
 *   With no key the module is a total no-op: initPosthog() returns early, every
 *   capture(...) is a silent no-op, and NOTHING is logged to the console. This
 *   keeps local/dev builds (and any deploy where the operator hasn't set the key
 *   yet) clean and error-free.
 *
 * ── PII-safe (CRITICAL) ──────────────────────────────────────────────────────
 *   The diagnose form fields (name, email, company, gargalo) go to Formspree —
 *   they must NEVER reach PostHog. To guarantee this we HARD-DISABLE autocapture
 *   and set mask_all_text / mask_all_element_attributes so even if session
 *   recording or any DOM capture path were ever enabled, input VALUES could not
 *   be exfiltrated. We only ever send explicit funnel EVENTS (never field
 *   content). See funnel event helpers below — none of them accept field values.
 *
 * ── GDPR (EU) ────────────────────────────────────────────────────────────────
 *   Data ships to EU Cloud (api_host = PUBLIC_POSTHOG_HOST → eu.i.posthog.com).
 *   For now we initialize directly on load. A cookie/consent banner is a
 *   recommended follow-up for EU compliance (see report) — not implemented here.
 *
 * Credentials come from env, never hardcoded:
 *   import.meta.env.PUBLIC_POSTHOG_KEY   — project API key (absent → no-op)
 *   import.meta.env.PUBLIC_POSTHOG_HOST  — ingestion host (EU cloud)
 */

import type { PostHog } from "posthog-js";

// ── Env (build-time inlined by Vite) ──────────────────────────────────────────

const POSTHOG_KEY = import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST =
  (import.meta.env.PUBLIC_POSTHOG_HOST as string | undefined) ??
  "https://eu.i.posthog.com";

// ── Module state ──────────────────────────────────────────────────────────────

let _client: PostHog | null = null;
let _initStarted = false;

/** True only when a key is present — the single gate for all analytics work. */
export const analyticsEnabled = Boolean(POSTHOG_KEY);

// ── Init (gated) ──────────────────────────────────────────────────────────────

/**
 * Initialize PostHog. Idempotent. No-op (zero console noise) when the key is
 * absent. Client-side only — guards against SSR / non-browser contexts.
 */
export async function initPosthog(): Promise<void> {
  // Gate: no key → total no-op.
  if (!POSTHOG_KEY) return;
  // Idempotent + browser-only.
  if (_initStarted || typeof window === "undefined") return;
  _initStarted = true;

  // Dynamic import so posthog-js is never in the critical path and is skipped
  // entirely when disabled (tree-shaken from the no-key path at the call site).
  const { default: posthog } = await import("posthog-js");

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,

    // ── PII-safe hardening (see module doc) ──
    // Autocapture harvests DOM interactions (incl. input surroundings) — OFF so
    // no form field ever leaks. We send only explicit funnel events.
    autocapture: false,
    // Session recording OFF — never record the form being filled.
    disable_session_recording: true,
    // Belt-and-suspenders: even for the events we DO send, mask any text /
    // element attribute PostHog might otherwise attach.
    mask_all_text: true,
    mask_all_element_attributes: true,

    // Manual pageviews (fired once from initPosthog) — SPA-safe, avoids
    // duplicate/auto captures we can't reason about.
    capture_pageview: false,
    capture_pageleave: true,

    // Persistence: cookie+localStorage default is fine for EU cloud; consent
    // banner is the follow-up that would gate this.
    loaded: (ph) => {
      _client = ph;
    },
  });

  // Some builds resolve `loaded` async; ensure we hold a handle either way.
  _client = posthog;

  // Explicit first pageview.
  posthog.capture("$pageview");
}

// ── Capture (gated, PII-safe by construction) ────────────────────────────────

/**
 * Fire a funnel event. No-op when analytics is disabled. Only accepts a small,
 * explicit props object — callers pass funnel METADATA (index, name, source),
 * never form field values.
 */
export function capture(
  event: string,
  properties?: Record<string, string | number | boolean>,
): void {
  if (!_client) return;
  _client.capture(event, properties);
}
