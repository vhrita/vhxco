/**
 * DiagnoseForm.tsx — React island for Phase 05 / Diagnose
 *
 * Terminal-styled contact form. Submits to Formspree via fetch (SSG-safe).
 * Hydration: client:visible — loads only when section scrolls into view.
 *
 * Env requirement: PUBLIC_FORMSPREE_ID must be set in .env.local.
 * If missing, renders a graceful config-missing error message.
 *
 * Features:
 *   - 4 text inputs: name, email, company, brief
 *   - Bottleneck selector: 4 radio-style buttons (ai / auto / iot / full)
 *   - Honeypot anti-spam field (_gotcha)
 *   - Loading / success / error states
 *   - i18n: locale prop → all copy from JSON dict
 *   - Next available slot: +2 business days at 14:30 (Intl.DateTimeFormat)
 */

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Locale = 'pt' | 'en';

interface DiagnoseFormProps {
  /** Page locale — drives all copy via inline dict. */
  locale?: Locale;
  /** Formspree form ID (e.g. "xqakeyzv"). Injected server-side via Astro. */
  formspreeId?: string;
  /** i18n strings passed from Astro (server-rendered, no JSON import needed). */
  labels: {
    formTitle: string;
    formLive: string;
    namePrompt: string;
    namePlaceholder: string;
    emailPrompt: string;
    emailPlaceholder: string;
    companyPrompt: string;
    companyPlaceholder: string;
    bottleneckPrompt: string;
    briefPrompt: string;
    briefPlaceholder: string;
    bn1: string;
    bn2: string;
    bn3: string;
    bn4: string;
    submit: string;
    sending: string;
    ok: string;
    networkFailure: string;
    configMissing: string;
  };
}

// ---------------------------------------------------------------------------
// Next business-day slot helper
// ---------------------------------------------------------------------------

function getNextSlot(locale: Locale): string {
  const d = new Date();
  // advance +2 business days
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  d.setHours(14, 30, 0, 0);

  const intlLocale = locale === 'pt' ? 'pt-BR' : 'en';
  const dateStr = new Intl.DateTimeFormat(intlLocale, {
    day: '2-digit',
    month: '2-digit',
  }).format(d);

  return `${dateStr} 14:30`;
}

// ---------------------------------------------------------------------------
// Bottleneck options
// ---------------------------------------------------------------------------

const BOTTLENECK_VALUES = ['ai', 'auto', 'iot', 'full'] as const;
type BottleneckValue = (typeof BOTTLENECK_VALUES)[number];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiagnoseForm({
  locale = 'pt',
  formspreeId,
  labels,
}: DiagnoseFormProps) {
  const [bottleneck, setBottleneck] = useState<BottleneckValue | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const bottleneckLabels: Record<BottleneckValue, string> = {
    ai: labels.bn1,
    auto: labels.bn2,
    iot: labels.bn3,
    full: labels.bn4,
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!formspreeId) {
        setStatus('error');
        return;
      }

      setStatus('loading');

      const form = e.currentTarget;
      const data = new FormData(form);

      // Append bottleneck selection (not a native form field)
      if (bottleneck) {
        data.set('bottleneck', bottleneck);
      }

      try {
        const res = await fetch(`https://formspree.io/f/${formspreeId}`, {
          method: 'POST',
          body: data,
          headers: { Accept: 'application/json' },
        });

        if (res.ok) {
          setStatus('success');
          form.reset();
          setBottleneck(null);
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    },
    [formspreeId, bottleneck]
  );

  // Config-missing guard
  if (!formspreeId) {
    return (
      <div className="terminal" role="alert">
        <div className="terminal-head">
          <span>{labels.formTitle}</span>
          <span className="terminal-live">{labels.formLive}</span>
        </div>
        <div className="term-body">
          <p className="term-config-error">{labels.configMissing}</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
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

  const nextSlot = getNextSlot(locale);

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
        style={{ display: 'none' }}
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
            disabled={status === 'loading'}
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
            disabled={status === 'loading'}
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
            disabled={status === 'loading'}
          />
        </div>

        {/* Bottleneck */}
        <div className="term-line term-line--stack">
          <span className="term-prompt">{labels.bottleneckPrompt}</span>
          <div className="term-options" role="group" aria-label={labels.bottleneckPrompt}>
            {BOTTLENECK_VALUES.map((val) => (
              <button
                key={val}
                type="button"
                data-v={val}
                className={`term-option-btn${bottleneck === val ? ' active' : ''}`}
                onClick={() => setBottleneck(val)}
                disabled={status === 'loading'}
                aria-pressed={bottleneck === val}
              >
                {bottleneckLabels[val]}
              </button>
            ))}
          </div>
        </div>

        {/* Brief */}
        <div className="term-line term-line--stack">
          <span className="term-prompt">{labels.briefPrompt}</span>
          <textarea
            className="term-area"
            name="brief"
            rows={2}
            placeholder={labels.briefPlaceholder}
            disabled={status === 'loading'}
          />
        </div>

        {/* Next slot display */}
        <div className="term-next-slot" aria-live="polite">
          <span className="term-prompt term-prompt--dim">next slot</span>
          <span className="term-slot-value">{nextSlot}</span>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="term-submit"
          disabled={status === 'loading'}
        >
          {status === 'loading' ? labels.sending : labels.submit}
        </button>

        {/* Error state */}
        {status === 'error' && (
          <p className="term-error-msg" role="alert">
            {labels.networkFailure}
          </p>
        )}
      </div>
    </form>
  );
}
