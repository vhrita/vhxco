/**
 * DiagnoseForm.tsx — React island for stop 4 (Diagnose / Ação)
 *
 * Fase 4a sub-passo 4: merged from V1 mockup DiagnoseForm4.astro spec +
 * existing Formspree logic.
 *
 * a11y/func leva (2026-07-14):
 *   - Programmatic labels: each field prompt is now a real <label htmlFor> tied
 *     to the input `id` (the terminal "prompt" spans were NOT labels for a
 *     screen reader). Every field is announced.
 *   - Client-side validation: `noValidate` stays (custom terminal styling), but
 *     handleSubmit now validates name (required) + email (required + pattern)
 *     BEFORE fetch. Invalid → inline error (role=alert, aria-describedby),
 *     focus moves to the first invalid field, submit blocked. No more silent
 *     unreachable leads.
 *   - Error copy: networkFailure now points to a real, actionable fallback
 *     (contato@vhxco.com) — no dead-end "email in the footer" (there is none).
 *   - Consent: discreet privacy-policy line under the submit.
 *
 * Preserved:
 *   - Formspree fetch + honeypot + loading/success/error states
 *   - Fallback CTA when formspreeId missing (iter-08 Fix D2)
 *   - i18n: labels prop from Astro (no JSON import in client bundle)
 *   - locale prop
 *
 * Hydration: client:visible — loads only when section scrolls into view.
 * Env: PUBLIC_FORMSPREE_ID must be set in .env.local.
 */

import { useState, useCallback, useRef } from "react";
import { capture } from "@/lib/analytics/posthog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Locale = "pt" | "en";

/** Which field failed client-side validation (null = none). */
type FieldError = { field: "name" | "email"; message: string } | null;

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
    detailsPrompt: string;
    detailsPlaceholder: string;
    submit: string;
    sending: string;
    ok: string;
    promise: string;
    networkFailure: string;
    configMissing: string;
    /** validation copy */
    requiredError: string;
    emailInvalidError: string;
    /** consent line */
    privacyNote: string;
    privacyLink: string;
    /** fallback CTA when Formspree not configured */
    fallbackTag: string;
    fallbackCopy: string;
    fallbackCta: string;
  };
}

// Simple, permissive email shape (same intent as the input `pattern`). Kept in
// sync with the `pattern` attribute below.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  const [fieldError, setFieldError] = useState<FieldError>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Locale-derived privacy page href (crawlable static routes).
  const privacyHref = locale === "en" ? "/privacy" : "/privacidade";

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      const form = e.currentTarget;

      // ── Client-side validation (noValidate is on — we own this) ──
      const nameEl = nameRef.current;
      const emailEl = emailRef.current;
      const nameVal = nameEl?.value.trim() ?? "";
      const emailVal = emailEl?.value.trim() ?? "";

      if (!nameVal) {
        setFieldError({ field: "name", message: labels.requiredError });
        nameEl?.focus();
        return;
      }
      if (!emailVal) {
        setFieldError({ field: "email", message: labels.requiredError });
        emailEl?.focus();
        return;
      }
      if (!EMAIL_RE.test(emailVal)) {
        setFieldError({ field: "email", message: labels.emailInvalidError });
        emailEl?.focus();
        return;
      }
      setFieldError(null);

      if (!formspreeId) {
        setStatus("error");
        return;
      }

      setStatus("loading");

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
          // the field values (name/email/company/details go to Formspree only).
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
    [formspreeId, locale, labels],
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
            href="mailto:contato@vhxco.com?subject=Diagnose%20VHXCO"
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

  const nameInvalid = fieldError?.field === "name";
  const emailInvalid = fieldError?.field === "email";

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
          <label className="term-prompt" htmlFor="df-name">
            {labels.namePrompt}
          </label>
          <input
            ref={nameRef}
            id="df-name"
            className="term-input"
            type="text"
            name="name"
            placeholder={labels.namePlaceholder}
            required
            aria-required="true"
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? "df-field-error" : undefined}
            disabled={status === "loading"}
          />
        </div>

        {/* Email */}
        <div className="term-line">
          <label className="term-prompt" htmlFor="df-email">
            {labels.emailPrompt}
          </label>
          <input
            ref={emailRef}
            id="df-email"
            className="term-input"
            type="email"
            name="email"
            placeholder={labels.emailPlaceholder}
            required
            aria-required="true"
            pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? "df-field-error" : undefined}
            disabled={status === "loading"}
          />
        </div>

        {/* Company */}
        <div className="term-line">
          <label className="term-prompt" htmlFor="df-company">
            {labels.companyPrompt}
          </label>
          <input
            id="df-company"
            className="term-input"
            type="text"
            name="company"
            placeholder={labels.companyPlaceholder}
            disabled={status === "loading"}
          />
        </div>

        {/* Details — multi-line textarea (optional, user elaborates) */}
        <div className="term-line term-line--textarea">
          <label className="term-prompt" htmlFor="df-details">
            {labels.detailsPrompt}
          </label>
          <textarea
            id="df-details"
            className="term-input term-textarea"
            name="details"
            placeholder={labels.detailsPlaceholder}
            rows={2}
            disabled={status === "loading"}
          />
        </div>

        {/* Field validation error (required / invalid email) */}
        {fieldError && (
          <p id="df-field-error" className="term-error-msg" role="alert">
            {fieldError.message}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="term-submit"
          disabled={status === "loading"}
        >
          {status === "loading" ? labels.sending : labels.submit}
        </button>

        {/* Consent — discreet privacy-policy line */}
        <p className="term-consent">
          {labels.privacyNote}{" "}
          <a className="term-consent-link" href={privacyHref}>
            {labels.privacyLink}
          </a>
          .
        </p>

        {/* Promise — "Resposta em até 7 dias" */}
        <p className="term-promise">{labels.promise}</p>

        {/* Network / config error state */}
        {status === "error" && (
          <p className="term-error-msg" role="alert">
            {labels.networkFailure}
          </p>
        )}
      </div>
    </form>
  );
}
