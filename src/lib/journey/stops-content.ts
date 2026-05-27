/**
 * stops-content.ts — Journey stop copy for PT and EN.
 *
 * PT copy is VERBATIM from lead-strategy.md §3 (the source of truth).
 * EN copy preserves concision / rhythm — NOT literal word-for-word translation.
 * Per lead-strategy §3 note: "preservar a concisão, não traduzir literal."
 *
 * headline: "\n" = <br> in templates.
 * body: null = no body copy for this stop.
 *
 * V1 pain-first order: PRESENTE → PROBLEMA → MÉTODO → PROVA → AÇÃO.
 */

export type StopLocale = "pt" | "en";

export interface StopContent {
  /** Eyebrow label (small caps, ≤4 words) */
  eyebrow: string;
  /** Headline (≤8 words, ≤2 lines). "\n" = line break. */
  headline: string;
  /** Body paragraph (≤25 words). null = omitted. */
  body: string | null;
  /** HUD hint text (only for non-action stops) */
  hudHint: string | null;
}

// ---------------------------------------------------------------------------
// PT copy — VERBATIM from lead-strategy.md §3
// ---------------------------------------------------------------------------

const PT_STOPS: StopContent[] = [
  // Stop 0 — PRESENTE (Attention)
  {
    eyebrow: "VHXCO",
    headline: "Sua operação ainda\npensa como ontem.",
    body: "O mundo já virou agentic. A maioria\ndas empresas ainda não percebeu.",
    hudHint: "viajar",
  },
  // Stop 1 — PROBLEMA (Interest)
  {
    eyebrow: "O GARGALO",
    headline: "Trabalho manual\nconsome seu futuro.",
    body: "Horas em tarefas que um agente faria sozinho.\nCusto que escala. Margem que some.",
    hudHint: "continuar",
  },
  // Stop 2 — MÉTODO (Desire)
  {
    eyebrow: "COMO ELEVAMOS",
    headline: "Agentes que executam,\nnão que sugerem.",
    body: "Construímos software movido por IA que faz o trabalho —\ndo código ao deploy. Você decide; eles operam.",
    hudHint: "ver prova",
  },
  // Stop 3 — PROVA (Desire / trust)
  {
    eyebrow: "PROVA VIVA",
    headline: "Você está\ndentro de uma.",
    body: "Este cérebro foi construído por agentes.\nComo o Gabriel — nosso app, no ar, com clientes pagantes.",
    hudHint: "começar",
  },
  // Stop 4 — AÇÃO (Action)
  {
    eyebrow: "DIAGNÓSTICO AGENTIC",
    headline: "Onde sua operação\npode chegar.",
    body: "Conte seu maior gargalo. Em 7 dias devolvemos\num plano de elevação. Gratuito, sem compromisso.",
    hudHint: null, // action stop: no hint, has form
  },
];

// ---------------------------------------------------------------------------
// EN copy — concision-preserving translation (not literal)
// Per lead-strategy §3: "preserve the concisão, não traduzir literal"
// ---------------------------------------------------------------------------

const EN_STOPS: StopContent[] = [
  // Stop 0 — PRESENT (Attention)
  {
    eyebrow: "VHXCO",
    headline: "Your operation still\nthinks like yesterday.",
    body: "The world has already gone agentic.\nMost companies haven't noticed yet.",
    hudHint: "travel",
  },
  // Stop 1 — PROBLEM (Interest)
  {
    eyebrow: "THE BOTTLENECK",
    headline: "Manual work\nis consuming your future.",
    body: "Hours on tasks an agent could run alone.\nCosts that scale. Margins that vanish.",
    hudHint: "continue",
  },
  // Stop 2 — METHOD (Desire)
  {
    eyebrow: "HOW WE ELEVATE",
    headline: "Agents that execute.\nNot that suggest.",
    body: "We build AI-powered software that does the work —\nfrom code to deploy. You decide; they operate.",
    hudHint: "see proof",
  },
  // Stop 3 — PROOF (Desire / trust)
  {
    eyebrow: "LIVE PROOF",
    headline: "You are\ninside one.",
    body: "This brain was built by agents.\nLike Gabriel — our app, live, with paying customers.",
    hudHint: "get started",
  },
  // Stop 4 — ACTION (Action)
  {
    eyebrow: "AGENTIC DIAGNOSTIC",
    headline: "Where your operation\ncan go.",
    body: "Tell us your biggest bottleneck. In 7 days we return\nan elevation plan. Free, no strings attached.",
    hudHint: null, // action stop: no hint, has form
  },
];

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/** All 5 stop content entries for the given locale (V1 pain-first order). */
export function getStopsContent(locale: StopLocale): StopContent[] {
  return locale === "en" ? EN_STOPS : PT_STOPS;
}

/** Single stop content by 0-based index. */
export function getStopContent(index: number, locale: StopLocale): StopContent {
  const stops = locale === "en" ? EN_STOPS : PT_STOPS;
  const stop = stops[index];
  if (!stop) {
    throw new Error(`stops-content: no stop at index ${index}`);
  }
  return stop;
}

/** Labels for the TopNav (0-based, V1 order). */
export const STOP_NAV_LABELS = {
  pt: [
    { label: "Presente", short: "PRE" },
    { label: "Problema", short: "PRB" },
    { label: "Método", short: "MET" },
    { label: "Prova", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
  en: [
    { label: "Present", short: "PRE" },
    { label: "Problem", short: "PRB" },
    { label: "Method", short: "MET" },
    { label: "Proof", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
} as const;
