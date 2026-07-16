# QA Screenshot Rig

Automated visual regression capture using Puppeteer + local Chromium.

## Requirements

- `pnpm install` (adds `puppeteer-core` dev dep)
- Chromium at `/opt/homebrew/bin/chromium` (Homebrew: `brew install chromium`)
- Dev server not already running on port 4321

## Usage

### Full run — all viewports, all phases

```bash
pnpm qa:shots
```

Captures 7 viewports × 5 phases + scrolled variants on phases 4–5.
~50–55 screenshots per run. Output in `qa/screenshots/<timestamp>/`.

### Subset — quick smoke test

```bash
pnpm qa:shots --viewports 375,1280 --phase 1
```

### Single viewport, single phase

```bash
pnpm qa:shots --viewports 1024 --phase 3
```

### Custom output directory

```bash
pnpm qa:shots --out qa/screenshots/before-fix
```

## Output

```
qa/screenshots/<timestamp>/
  375w-phase1.png
  375w-phase2.png
  ...
  1920w-phase5.png
  1920w-phase5-scrolled.png   # phases 4+5 have internal scroll
  console-errors.json          # JS errors per viewport
  summary.json                 # manifest of all screenshots
```

## Phase reference

| CLI `--phase` | Internal index | Label       |
|---------------|----------------|-------------|
| 1             | 0              | Núcleo      |
| 2             | 1              | Engenharia  |
| 3             | 2              | Ecossistema |
| 4             | 3              | Prova       |
| 5             | 4              | Diagnose    |

## Viewports (default)

375, 480, 640, 768, 1024, 1280, 1920

## Environment variables

| Var             | Default                        | Description           |
|-----------------|--------------------------------|-----------------------|
| `CHROMIUM_PATH` | `/opt/homebrew/bin/chromium`   | Chromium binary path  |
| `QA_BASE_URL`   | `http://localhost:4321`        | Dev server URL        |

## How phase navigation works

`take-shots.mjs` uses `window.__phaseStore.goToPhase(N)` — exposed in DEV mode
by BaseLayout. Falls back to `window.dispatchEvent(new CustomEvent('hud:goto-phase', ...))`.

## Notes

- Screenshots are gitignored. Only `qa/screenshots/.gitkeep` is committed.
- `qa/.dev.log` / `qa/.dev.pid` are also gitignored.
- The script waits up to 12s for the preloader boot sequence (~3.8s) to finish.
