# SEO / discovery + infra — build evidence

Branch: `feature/phase4b2-rework` · validated against `dist/` from two isolated
builds (preview = `PUBLIC_SITE_URL` unset, prod = `PUBLIC_SITE_URL=https://vhxco.com`).
Domain: **https://vhxco.com** (0 `.io` in dist).

## 1. `<head>` (BaseLayout, PT `/` + EN `/en/`)

PT `dist/index.html` (grep of head tags):

```
<meta name="theme-color" content="#00d7e4">              (brand cyan, was #000)
<link rel="canonical" href="https://vhxco.com/">
<link rel="alternate" hreflang="pt-BR" href="https://vhxco.com/">
<link rel="alternate" hreflang="en"    href="https://vhxco.com/en/">
<link rel="alternate" hreflang="x-default" href="https://vhxco.com/">
og:type=website · og:site_name=VHXCO · og:title · og:description
og:url=https://vhxco.com/ · og:image=https://vhxco.com/og-pt.png (1200x630 + alt)
og:locale=pt_BR · og:locale:alternate=en_US
twitter:card=summary_large_image · twitter:title/description/image
<link rel="icon" x-icon /favicon.ico> + 32x32 + 16x16
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

EN `dist/en/index.html`: canonical `https://vhxco.com/en/`, og:url `.../en/`,
og:image `og-en.png`, og:locale `en_US` / alternate `pt_BR`. hreflang cluster
identical (PT-root + EN-/en/ + x-default→root); hreflang `en` = `/en/` matches
its canonical (trailing-slash consistent).

## 2. OG images

`public/og-pt.png` and `public/og-en.png` — 1200×630, 8-bit, branded (logo +
tagline over dark cyan-glow bg). Referenced as absolute vhxco.com URLs.
NOTE: simple/functional; flagged for a polished neural-mesh pass later.

## 3. robots.txt (`dist/robots.txt`)

```
User-agent: *  → Allow: / , Disallow: /dev/
Explicit AI UAs: GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web,
                 PerplexityBot, Google-Extended, CCBot  (all Allow: /)
Sitemap: https://vhxco.com/sitemap-index.xml
```

Not a 404 — served from `/public`.

## 4. Sitemap (`@astrojs/sitemap`, `site: https://vhxco.com`)

`dist/sitemap-index.xml` + `dist/sitemap-0.xml`. URLs:

```
https://vhxco.com/
https://vhxco.com/en/
```

`grep -c '/dev/' sitemap-0.xml` → **0** (filter `!page.includes('/dev/')` works).

## 5. llms.txt (`dist/llms.txt`)

Standard format: `# VHXCO` H1 + `>` summary + `## Pages` / `## Services` /
`## Contact` with vhxco.com links. Present, not 404.

## 6. JSON-LD (PT + EN)

Both parse as valid JSON. `@graph` = `[Organization, WebSite, Service×4]`.

- Organization: `@id`, `url`, `logo`, `slogan`, `areaServed=BR`, `contactPoint`
  (email `contato@vhxco.com`, PT+EN).
- WebSite: `@id`, `url`, `inLanguage` (pt-BR / en), `publisher`→org `@id`.
- Service×4: `@id`-provider ref, `serviceType`, `areaServed`.
- **All URLs contain vhxco.com — 0 `.io`** (verified: `grep -rIl 'vhxco\.io' dist` → 0).
- `sameAs` OMITTED — no verified VHXCO social profiles (flagged for Vitor).

## 7. Noindex gate (build flag `PUBLIC_SITE_URL`)

| Build   | `PUBLIC_SITE_URL`   | `noindex` in PT/EN  |
| ------- | ------------------- | ------------------- |
| Preview | unset               | **1 / 1** (present) |
| Prod    | `https://vhxco.com` | **0 / 0** (absent)  |

Fail-closed: only `https://vhxco.com` is indexable; preview/dev/unset → noindex.
Wired via `Dockerfile` ARG/ENV `PUBLIC_SITE_URL` + `.env.example`.

## 8. nginx + 404

`nginx.conf`:

- `server_tokens off`
- Security headers (repeated per-`location` — nginx drops server-level
  `add_header` inside locations that set their own): `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`.
- `error_page 404 /404.html` (already present) → `src/pages/404.astro`.

`dist/404.html`: branded bilingual (PT+EN), `noindex, follow`, links back to `/`
(funnel), no raw nginx page.

## Build

`pnpm build` (via `npx pnpm@10.15.0`) GREEN in isolated worktree both runs.
Only warning: pre-existing three.js `journey-state` chunk >500kB (not introduced here).
