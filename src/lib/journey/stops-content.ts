/**
 * stops-content.ts — Journey stop copy for PT and EN.
 *
 * PT copy is VERBATIM from the copy-improvement plan v2 §4 (source of truth):
 *   agentic/docs/plans/vhxco-website-copy-improvement-v2.md
 * EN copy (§5) preserves concision / rhythm — NOT literal word-for-word.
 *
 * v2 REPIVOT (outcome-first) — the VHXCO sells RESULT, not software.
 * Locked decisions applied (V1–V6, all approved by Vitor):
 *   V1  hero category-kill: "Não vendemos software. Entregamos resultado."
 *       (keeps "software" in the <h1> for SEO).
 *   V1b eyebrow "RESULTADO POR AGENTES" / "RESULTS BY AGENTS".
 *   V2  trust mechanism "medimos o antes e o depois" (MÉTODO stop) — the
 *       verifiable promise that replaces any "instant result" claim.
 *   V3  mural label "NO AR — FEITO PELA VHXCO" / "LIVE — BUILT BY VHXCO".
 *   V4  mural = 2 verifiable tiles only (Gabriel app + gabriel.vhxco.com).
 *   V5  Diagnóstico card is clickable → jumps to the form (cta: true).
 *   V6  nav label for stop 3: "Serviços" → "Resultados" / "Results".
 *   Inherited from v1: D3 professional transparency, D4 no public price,
 *   D6 no revenue claim (mural mentions no revenue).
 *
 * headline: "\n" = <br> in templates.
 * body: null = no body copy for this stop.
 *
 * Order (unchanged): PROMESSA → GARGALO → MÉTODO → RESULTADOS → PROVA → AÇÃO.
 */

export type StopLocale = "pt" | "en";

/** Lucide icon id for a service card (SVG inline in JourneyStop, no new dep). */
export type ServiceIconId = "trend" | "clock" | "build" | "scan";

export interface ServiceCard {
  /** Lucide icon id — replaces the old num label */
  icon: ServiceIconId;
  /** Card title (result name) */
  title: string;
  /** 1-line benefit (≤8 words) */
  desc: string;
  /** true only on the free-diagnostic card → jumps to the form (V5) */
  cta?: boolean;
}

export interface ProofTile {
  /** Name shown in the chip (e.g. "Gabriel") */
  name: string;
  /** External link — target=_blank rel=noopener */
  url: string;
  /** Short, NEUTRAL tag, no claim (e.g. "app · Play Store") — localized */
  tag: string;
  /** produto (house) | cliente (external, stage 2+) — controls future badge */
  kind: "produto" | "cliente";
  /** Optional logo/thumb (future) — text chip when absent */
  logoSrc?: string;
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
  /** Service cards (RESULTADOS stop only) — rendered as compact cards */
  cards?: ServiceCard[];
  /** Proof mural section label (PROVA stop only) */
  muralLabel?: string;
  /** Proof mural tiles (PROVA stop only) */
  tiles?: ProofTile[];
  /** Subtle closing tagline (ACTION stop only, D2) — below the form */
  taglineClose?: string;
}

// ---------------------------------------------------------------------------
// PT copy — VERBATIM from copy-improvement plan v2 §4
// ---------------------------------------------------------------------------

const PT_STOPS: StopContent[] = [
  // Stop 0 — PROMESSA (Attention) — V1 category-kill, V1b eyebrow
  {
    eyebrow: "VHXCO · RESULTADO POR AGENTES",
    headline: "Não vendemos software.\nEntregamos resultado.",
    body: "Encontramos o gargalo do seu negócio e resolvemos\ncom agentes de IA: mais venda, menos custo, mais tempo livre.\nUm engenheiro sênior responde pelo resultado.",
    hudHint: "viajar",
  },
  // Stop 1 — GARGALO (Interest) — dor do NEGÓCIO
  {
    eyebrow: "O GARGALO",
    headline: "Todo negócio trava\nnum gargalo.",
    body: "Venda que não converte. Operação manual comendo a margem.\nSeu dia engolido por tarefa repetitiva.\nFerramenta genérica não conserta isso.",
    hudHint: "achar o meu",
  },
  // Stop 2 — MÉTODO (Desire) — V2 "medimos o antes e o depois"
  {
    eyebrow: "COMO FUNCIONA",
    headline: "Agentes que executam,\nnão que sugerem.",
    body: "Achamos o gargalo. Agentes planejam, constroem e testam\na solução. Um engenheiro sênior revisa tudo —\ne medimos o antes e o depois.",
    hudHint: "ver o que você ganha",
  },
  // Stop 3 — RESULTADOS (ex-SERVIÇOS) — 4 cards por resultado, V5 card clicável
  {
    eyebrow: "O QUE VOCÊ GANHA",
    headline: "Escolha o resultado.",
    body: null,
    hudHint: "ver prova",
    cards: [
      {
        icon: "trend",
        title: "VENDER MAIS",
        desc: "Conversão, funil, produto — o número sobe.",
      },
      {
        icon: "clock",
        title: "CUSTAR MENOS, SOBRAR TEMPO",
        desc: "Agentes assumem o trabalho manual.",
      },
      {
        icon: "build",
        title: "CONSTRUIR O QUE FALTA",
        desc: "Software sob medida, quando o resultado exige.",
      },
      {
        icon: "scan",
        title: "DIAGNÓSTICO GRÁTIS",
        desc: "Seu gargalo mapeado em 7 dias.",
        cta: true,
      },
    ],
  },
  // Stop 4 — PROVA (Desire / trust) — hook + mural (V3/V4). Gabriel = tile, not body.
  {
    eyebrow: "PROVA VIVA",
    headline: "Você está\ndentro de uma.",
    body: "Este site foi construído pelos nossos agentes.\nE cada projeto você acompanha em tempo real.",
    hudHint: "começar",
    muralLabel: "NO AR — FEITO PELA VHXCO",
    tiles: [
      {
        name: "Gabriel",
        url: "https://play.google.com/store/apps/details?id=com.gabriel.biblia",
        tag: "app · Play Store",
        kind: "produto",
      },
      {
        name: "gabriel.vhxco.com",
        url: "https://gabriel.vhxco.com",
        tag: "site",
        kind: "produto",
      },
    ],
  },
  // Stop 5 — AÇÃO (Action) — V2 eyebrow "GRÁTIS"; form + tagline intocados
  // Body trimmed to 1 line: form 4-campos must fit in 375×667 viewport.
  {
    eyebrow: "DIAGNÓSTICO GRÁTIS",
    headline: "Conte seu gargalo.\nReceba o plano.",
    body: "Gratuito. Em 7 dias, sem compromisso.",
    hudHint: null, // action stop: no hint, has form
    taglineClose: "Construído por agentes. Feito para pessoas.",
  },
];

// ---------------------------------------------------------------------------
// EN copy — concision-preserving translation (not literal), plan v2 §5
// ---------------------------------------------------------------------------

const EN_STOPS: StopContent[] = [
  // Stop 0 — PROMISE (Attention) — V1 category-kill
  {
    eyebrow: "VHXCO · RESULTS BY AGENTS",
    headline: "We don't sell software.\nWe deliver results.",
    body: "We find your business bottleneck and fix it\nwith AI agents: more sales, lower costs, more free time.\nA senior engineer answers for the result.",
    hudHint: "travel",
  },
  // Stop 1 — BOTTLENECK (Interest) — business pain
  {
    eyebrow: "THE BOTTLENECK",
    headline: "Every business stalls\nat a bottleneck.",
    body: "Sales that don't convert. Manual work eating your margin.\nYour day swallowed by repetitive tasks.\nGeneric tools don't fix that.",
    hudHint: "find mine",
  },
  // Stop 2 — METHOD (Desire) — V2 "we measure before and after"
  {
    eyebrow: "HOW IT WORKS",
    headline: "Agents that execute.\nNot that suggest.",
    body: "We find the bottleneck. Agents plan, build and test\nthe fix. A senior engineer reviews everything —\nand we measure before and after.",
    hudHint: "see what you get",
  },
  // Stop 3 — RESULTS (ex-SERVICES) — 4 result cards, V5 clickable card
  {
    eyebrow: "WHAT YOU GET",
    headline: "Pick your result.",
    body: null,
    hudHint: "see proof",
    cards: [
      {
        icon: "trend",
        title: "SELL MORE",
        desc: "Conversion, funnel, product: the number goes up.",
      },
      {
        icon: "clock",
        title: "SPEND LESS, FREE YOUR TIME",
        desc: "Agents take over the manual work.",
      },
      {
        icon: "build",
        title: "BUILD WHAT'S MISSING",
        desc: "Custom software, when the result demands it.",
      },
      {
        icon: "scan",
        title: "FREE DIAGNOSTIC",
        desc: "Your bottleneck mapped in 7 days.",
        cta: true,
      },
    ],
  },
  // Stop 4 — PROOF (Desire / trust) — hook + mural (V3/V4). Gabriel = tile.
  {
    eyebrow: "LIVE PROOF",
    headline: "You are\ninside one.",
    body: "This site was built by our agents.\nAnd you follow every project in real time.",
    hudHint: "get started",
    muralLabel: "LIVE — BUILT BY VHXCO",
    tiles: [
      {
        name: "Gabriel",
        url: "https://play.google.com/store/apps/details?id=com.gabriel.biblia",
        tag: "app · Play Store",
        kind: "produto",
      },
      {
        name: "gabriel.vhxco.com",
        url: "https://gabriel.vhxco.com",
        tag: "website",
        kind: "produto",
      },
    ],
  },
  // Stop 5 — ACTION (Action) — V2 eyebrow "FREE"; form + tagline unchanged
  {
    eyebrow: "FREE DIAGNOSTIC",
    headline: "Tell us your bottleneck.\nGet the plan.",
    body: "Free. In 7 days, no strings attached.",
    hudHint: null, // action stop: no hint, has form
    taglineClose: "Built by agents. Made for people.",
  },
];

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/** All 6 stop content entries for the given locale (outcome-first order). */
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

/** Labels for the TopNav (0-based, outcome-first order). V6: stop 3 = Resultados. */
export const STOP_NAV_LABELS = {
  pt: [
    { label: "Promessa", short: "INI" },
    { label: "Gargalo", short: "GAR" },
    { label: "Método", short: "MET" },
    { label: "Resultados", short: "RES" },
    { label: "Prova", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
  en: [
    { label: "Promise", short: "INI" },
    { label: "Bottleneck", short: "GAR" },
    { label: "Method", short: "MET" },
    { label: "Results", short: "RES" },
    { label: "Proof", short: "PRV" },
    { label: "Diagnose", short: "DIA" },
  ],
} as const;
