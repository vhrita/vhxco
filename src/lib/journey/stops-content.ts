/**
 * stops-content.ts — Journey stop copy for PT and EN.
 *
 * PT copy is VERBATIM from the copy-improvement plan §4 (source of truth):
 *   agentic/docs/plans/vhxco-website-copy-improvement.md
 * EN copy (§5) preserves concision / rhythm — NOT literal word-for-word.
 *
 * Locked decisions applied (D1–D6, override the doc where they differ):
 *   D1  N=6: new SERVIÇOS stop (index 3) between MÉTODO and PROVA.
 *   D2  hero = concrete promise + tagline as a subtle closing line on the
 *       ACTION stop (index 5), below the form (`taglineClose`).
 *   D3  PROVA transparency line is professional (no dev jargon):
 *       "Acompanhe cada etapa do seu projeto, em tempo real."
 *   D5  Gabriel = discreet link to the Play Store (rendered in JourneyStop).
 *   D6  Gabriel = "no ar na Play Store" (no revenue claim).
 *
 * headline: "\n" = <br> in templates.
 * body: null = no body copy for this stop.
 *
 * V1 pain-first order: PROMESSA → GARGALO → MÉTODO → SERVIÇOS → PROVA → AÇÃO.
 */

export type StopLocale = "pt" | "en";

export interface ServiceCard {
  /** Card number label, e.g. "01" */
  num: string;
  /** Card title (service name) */
  title: string;
  /** 1–2 line deliverable line */
  desc: string;
}

export interface StopContent {
  /** Eyebrow label (small caps, ≤4 words) */
  eyebrow: string;
  /** Headline (≤8 words, ≤2 lines). "\n" = line break. */
  headline: string;
  /** Body paragraph (≤25 words). null = omitted. */
  body: string | null;
  /** HUD hint text (only for non-action stops) */
  hudHint: string | null;
  /** Service cards (SERVIÇOS stop only) — rendered as compact cards */
  cards?: ServiceCard[];
  /** Subtle closing tagline (ACTION stop only, D2) — below the form */
  taglineClose?: string;
}

// ---------------------------------------------------------------------------
// PT copy — VERBATIM from copy-improvement plan §4 (+ D2/D3/D6 overrides)
// ---------------------------------------------------------------------------

const PT_STOPS: StopContent[] = [
  // Stop 0 — PROMESSA (Attention) — D2
  {
    eyebrow: "VHXCO · SOFTWARE HOUSE AGÊNTICA",
    headline: "Software sob medida.\nConstruído por agentes.",
    body: "Um engenheiro sênior no comando. Agentes de IA\nna execução. Semanas, não meses.",
    hudHint: "viajar",
  },
  // Stop 1 — GARGALO (Interest)
  {
    eyebrow: "O GARGALO",
    headline: "Software bom sempre foi\ncaro e lento.",
    body: "Agência cobra por mês. Freelancer some.\nE o trabalho manual segue comendo sua margem.",
    hudHint: "continuar",
  },
  // Stop 2 — MÉTODO (Desire)
  {
    eyebrow: "COMO FUNCIONA",
    headline: "Agentes que executam,\nnão que sugerem.",
    body: "Agentes planejam, codam, testam e entregam.\nUm engenheiro sênior revisa cada linha antes de chegar a você.",
    hudHint: "ver o que entregamos",
  },
  // Stop 3 — SERVIÇOS (Desire / oferta) — NEW (D1, D4: no price)
  {
    eyebrow: "O QUE ENTREGAMOS",
    headline: "Três formas de começar.",
    body: null,
    hudHint: "ver prova",
    cards: [
      {
        num: "01",
        title: "Software sob medida",
        desc: "MVP, sistema ou app — do zero à produção. Escopo e preço fechados antes de começar.",
      },
      {
        num: "02",
        title: "Automação agêntica",
        desc: "Processos manuais passam a rodar sozinhos.",
      },
      {
        num: "03",
        title: "Diagnóstico Agentic — grátis",
        desc: "Seu plano de ação em 7 dias.",
      },
    ],
  },
  // Stop 4 — PROVA (Desire / trust) — D3 transparency, D5 link, D6 no revenue claim
  {
    eyebrow: "PROVA VIVA",
    headline: "Você está\ndentro de uma.",
    body: "Este site foi construído por agentes. O Gabriel —\nnosso app no ar na Play Store — também.\nAcompanhe cada etapa do seu projeto, em tempo real.",
    hudHint: "começar",
  },
  // Stop 5 — AÇÃO (Action) — D2 tagline close
  // Body trimmed to 1 line: form 4-campos must fit in 375×667 viewport.
  {
    eyebrow: "DIAGNÓSTICO AGENTIC",
    headline: "Conte seu gargalo.\nReceba o plano.",
    body: "Gratuito. Em 7 dias, sem compromisso.",
    hudHint: null, // action stop: no hint, has form
    taglineClose: "Construído por agentes. Feito para pessoas.",
  },
];

// ---------------------------------------------------------------------------
// EN copy — concision-preserving translation (not literal), plan §5
// ---------------------------------------------------------------------------

const EN_STOPS: StopContent[] = [
  // Stop 0 — PROMISE (Attention) — D2
  {
    eyebrow: "VHXCO · AGENTIC SOFTWARE HOUSE",
    headline: "Custom software.\nBuilt by agents.",
    body: "A senior engineer in command. AI agents\nexecuting. Weeks, not months.",
    hudHint: "travel",
  },
  // Stop 1 — BOTTLENECK (Interest)
  {
    eyebrow: "THE BOTTLENECK",
    headline: "Good software has always\nbeen slow and expensive.",
    body: "Agencies bill by the month. Freelancers vanish.\nAnd manual work keeps eating your margin.",
    hudHint: "continue",
  },
  // Stop 2 — METHOD (Desire)
  {
    eyebrow: "HOW IT WORKS",
    headline: "Agents that execute.\nNot that suggest.",
    body: "Agents plan, code, test and ship.\nA senior engineer reviews every line before it reaches you.",
    hudHint: "see what we deliver",
  },
  // Stop 3 — SERVICES (Desire / offer) — NEW (D1, D4: no price)
  {
    eyebrow: "WHAT WE DELIVER",
    headline: "Three ways to start.",
    body: null,
    hudHint: "see proof",
    cards: [
      {
        num: "01",
        title: "Custom software",
        desc: "MVP, system or app — zero to production. Fixed scope and price upfront.",
      },
      {
        num: "02",
        title: "Agentic automation",
        desc: "Manual processes start running themselves.",
      },
      {
        num: "03",
        title: "Agentic Diagnostic — free",
        desc: "Your action plan in 7 days.",
      },
    ],
  },
  // Stop 4 — PROOF (Desire / trust) — D3, D5, D6
  {
    eyebrow: "LIVE PROOF",
    headline: "You are\ninside one.",
    body: "This site was built by agents. So was Gabriel —\nour app, live on the Play Store.\nFollow every step of your project, in real time.",
    hudHint: "get started",
  },
  // Stop 5 — ACTION (Action) — D2 tagline close
  {
    eyebrow: "AGENTIC DIAGNOSTIC",
    headline: "Tell us your bottleneck.\nGet the plan.",
    body: "Free. In 7 days, no strings attached.",
    hudHint: null, // action stop: no hint, has form
    taglineClose: "Built by agents. Made for people.",
  },
];

// ---------------------------------------------------------------------------
// Gabriel Play Store link (D5) — verified live (com.gabriel.biblia, HTTP 200).
// ---------------------------------------------------------------------------

export const GABRIEL_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.gabriel.biblia";

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/** All 6 stop content entries for the given locale (V1 pain-first order). */
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
    { label: "Promessa", short: "INI" },
    { label: "Gargalo", short: "GAR" },
    { label: "Método", short: "MET" },
    { label: "Serviços", short: "SRV" },
    { label: "Prova", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
  en: [
    { label: "Promise", short: "INI" },
    { label: "Bottleneck", short: "GAR" },
    { label: "Method", short: "MET" },
    { label: "Services", short: "SRV" },
    { label: "Proof", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
} as const;
