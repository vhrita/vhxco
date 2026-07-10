/**
 * DiagnoseForm.tsx — React island for stop 4 (Diagnose / Ação)
 *
 * Fase 4a sub-passo 4: merged from V1 mockup DiagnoseForm4.astro spec +
 * existing Formspree logic.
 *
 * Changes from previous version:
 *   - 4 fields only: name, email, company, gargalo (text input)
 *   - Removed: bottleneck radio (bn1-4), brief textarea, nextSlot display
 *   - Button text: "Solicitar diagnóstico" (was configurable — now fixed spec)
 *   - Promise label: "Resposta em até 7 dias." shown below submit
 *   - Labels interface trimmed to 4-field spec (bottleneck/brief keys removed)
 *
 * Preserved from previous version:
 *   - Formspree fetch + honeypot + loading/success/error states
 *   - Fallback CTA when formspreeId missing (iter-08 Fix D2)
 *   - i18n: labels prop from Astro (no JSON import in client bundle)
 *   - locale prop
 *
 * Hydration: client:visible — loads only when section scrolls into view.
 * Env: PUBLIC_FORMSPREE_ID must be set in .env.local.
 */

import { useState, useCallback } from "react";
import { capture } from "@/lib/analytics/posthog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Locale = "pt" | "en";

interface DiagnoseFormProps {
  /** Page locale */
  locale?: Locale;
  /** Formspree form ID. Injected server-side via Astro. */
  formspreeId?: string;
  /** i18n strings passed from Astro (server-rendered). */
  labels: {
    formTitle: string;
    formLive: string;
    namePrompt: string;
    namePlaceholder: string;
    emailPrompt: string;
    emailPlaceholder: string;
    companyPrompt: string;
    companyPlaceholder: string;
    gargaloPrompt: string;
    gargaloPlaceholder: string;
    submit: string;
    sending: string;
    ok: string;
    promise: string;
    networkFailure: string;
    configMissing: string;
    /** fallback CTA when Formspree not configured */
    fallbackTag: string;
    fallbackCopy: string;
    fallbackCta: string;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiagnoseForm({
  locale = "pt",
  formspreeId,
  labels,
}: DiagnoseFormProps) {
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!formspreeId) {
        setStatus("error");
        return;
      }

      setStatus("loading");

      const form = e.currentTarget;
      const data = new FormData(form);

      try {
        const res = await fetch(`https://formspree.io/f/${formspreeId}`, {
          method: "POST",
          body: data,
          headers: { Accept: "application/json" },
        });

        if (res.ok) {
          setStatus("success");
          form.reset();
          // Analytics: submit success. PII-safe — only the EVENT is sent, never
          // the field values (name/email/company/gargalo go to Formspree only).
          capture("diagnose_submit", { locale });
        } else {
          setStatus("error");
          capture("diagnose_error", { locale, reason: "http" });
        }
      } catch {
        setStatus("error");
        capture("diagnose_error", { locale, reason: "network" });
      }
    },
    [formspreeId, locale],
  );

  // Fallback: no Formspree configured — mailto CTA (iter-08 Fix D2)
  if (!formspreeId) {
    return (
      <div className="terminal" role="alert">
        <div className="terminal-head">
          <span>{labels.formTitle}</span>
          <span className="terminal-live term-fallback-tag">
            {labels.fallbackTag}
          </span>
        </div>
        <div className="term-body">
          <p className="term-fallback-copy">{labels.fallbackCopy}</p>
          <a
            href="mailto:vhrita.dev@gmail.com?subject=Diagnose%20VHXCO"
            className="term-submit term-fallback-cta"
            onClick={() => capture("diagnose_fallback_click", { locale })}
          >
            {labels.fallbackCta}
          </a>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="terminal" role="status">
        <div className="terminal-head">
          <span>{labels.formTitle}</span>
          <span className="terminal-live">{labels.formLive}</span>
        </div>
        <div className="term-body">
          <p className="term-success-msg">{labels.ok}</p>
        </div>
      </div>
    );
  }

  return (
    <form
      className="terminal"
      id="termForm"
      onSubmit={handleSubmit}
      autoComplete="off"
      noValidate
    >
      {/* Honeypot — hidden from humans, Formspree discards if filled */}
      <input
        name="_gotcha"
        type="text"
        tabIndex={-1}
        style={{ display: "none" }}
        aria-hidden="true"
      />

      <div className="terminal-head">
        <span>{labels.formTitle}</span>
        <span className="terminal-live">{labels.formLive}</span>
      </div>

      <div className="term-body">
        {/* Name */}
        <div className="term-line">
          <span className="term-prompt">{labels.namePrompt}</span>
          <input
            className="term-input"
            type="text"
            name="name"
            placeholder={labels.namePlaceholder}
            required
            disabled={status === "loading"}
          />
        </div>

        {/* Email */}
        <div className="term-line">
          <span className="term-prompt">{labels.emailPrompt}</span>
          <input
            className="term-input"
            type="email"
            name="email"
            placeholder={labels.emailPlaceholder}
            required
            pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
            disabled={status === "loading"}
          />
        </div>

        {/* Company */}
        <div className="term-line">
          <span className="term-prompt">{labels.companyPrompt}</span>
          <input
            className="term-input"
            type="text"
            name="company"
            placeholder={labels.companyPlaceholder}
            disabled={status === "loading"}
          />
        </div>

        {/* Gargalo — text input (replaces bottleneck radio + brief textarea) */}
        <div className="term-line">
          <span className="term-prompt">{labels.gargaloPrompt}</span>
          <input
            className="term-input"
            type="text"
            name="gargalo"
            placeholder={labels.gargaloPlaceholder}
            disabled={status === "loading"}
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="term-submit"
          disabled={status === "loading"}
        >
          {status === "loading" ? labels.sending : labels.submit}
        </button>

        {/* Promise — "Resposta em até 7 dias" */}
        <p className="term-promise">{labels.promise}</p>

        {/* Error state */}
        {status === "error" && (
          <p className="term-error-msg" role="alert">
            {labels.networkFailure}
          </p>
        )}
      </div>
    </form>
  );
}
