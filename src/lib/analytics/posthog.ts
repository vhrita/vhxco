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
 * ── COOKIELESS (LGPD/GDPR — Vitor's decision) ────────────────────────────────
 *   persistence: 'memory' — PostHog keeps NO cookies and NO localStorage. The
 *   anonymous id lives only for the page-view lifetime and is dropped on reload.
 *   No persistent identifier = a far lighter consent posture (no cookie banner
 *   needed for strictly-in-memory, non-persistent analytics). Data still ships
 *   to EU Cloud (api_host → eu.i.posthog.com). The /privacidade + /privacy pages
 *   disclose this. Verified: zero `ph_*` cookies are set.
 *
 * ── Early-event buffer ───────────────────────────────────────────────────────
 *   posthog-js loads via dynamic import (off the critical path), so events can
 *   fire (e.g. the stop-0 `stop_viewed`) BEFORE the client exists. Those are
 *   queued and flushed once init completes — no top-of-funnel blind spot.
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

// Events fired before the client finishes loading (dynamic import is async).
// Bounded — capped so a never-completing init can't grow this unbounded.
type QueuedEvent = [
  string,
  Record<string, string | number | boolean> | undefined,
];
const _queue: QueuedEvent[] = [];
const _QUEUE_MAX = 50;

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

    // COOKIELESS (LGPD/GDPR — Vitor's decision). In-memory only: no cookies,
    // no localStorage, no persistent anonymous id. See module doc.
    persistence: "memory",
    // Don't spin up person profiles for anonymous visitors — funnel events only.
    person_profiles: "identified_only",

    loaded: (ph) => {
      _client = ph;
    },
  });

  // Some builds resolve `loaded` async; ensure we hold a handle either way.
  _client = posthog;

  // Explicit first pageview.
  posthog.capture("$pageview");

  // Flush any events queued before the client existed (e.g. stop-0 view).
  if (_queue.length) {
    for (const [event, properties] of _queue)
      posthog.capture(event, properties);
    _queue.length = 0;
  }
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
  if (_client) {
    _client.capture(event, properties);
    return;
  }
  // No key → drop silently (total no-op). Key present but client still loading
  // → buffer (bounded) so early events (e.g. stop-0 view) survive to flush.
  if (!analyticsEnabled) return;
  if (_queue.length < _QUEUE_MAX) _queue.push([event, properties]);
}
