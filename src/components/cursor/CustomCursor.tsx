/**
 * CustomCursor — React island (client:idle)
 *
 * Activates ONLY when:
 *   @media (pointer: fine) and (prefers-reduced-motion: no-preference)
 *
 * ADR D6 — custom cursor a11y guards.
 * On non-match (touch / reduced-motion): renders null, OS cursor stays.
 * Listens for matchMedia changes → deactivates if user enables reduced-motion
 * mid-session.
 *
 * Visual system:
 *   #cursor         — dot + ring, mix-blend-mode: difference, z=9999
 *   #cursorTrail    — 2D canvas particle trail, z=9998
 *   .click-ripple   — DOM-injected ripple on click, z=9997
 *   body[data-cursor="custom"] { cursor: none } — toggled by this component
 *
 * Trail hue: hsla(200, 80%, 70%, α) — brand kit cyan family.
 * Max 60 particles. Spawn rate tied to mouseSpeed (frame-skip when slow).
 */

import { useEffect } from 'react';

const TRAIL_MAX = 60;
const TRAIL_HUE = 200; // brand kit cyan hue

interface TrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export default function CustomCursor() {
  useEffect(() => {
    const mq = window.matchMedia(
      '(pointer: fine) and (prefers-reduced-motion: no-preference)',
    );

    let cleanup: (() => void) | null = null;

    function activate() {
      // Already activated guard
      if (document.getElementById('cursor')) return;

      // ── Toggle body attribute (CSS: body[data-cursor="custom"] { cursor: none })
      document.body.dataset['cursor'] = 'custom';

      // ── Create cursor element
      const cursorEl = document.createElement('div');
      cursorEl.id = 'cursor';
      document.body.appendChild(cursorEl);

      // ── Create trail canvas
      const trailCanvas = document.createElement('canvas');
      trailCanvas.id = 'cursorTrail';
      document.body.appendChild(trailCanvas);

      const trailCtx = trailCanvas.getContext('2d')!;

      // ── State
      let mx = window.innerWidth / 2;
      let my = window.innerHeight / 2;
      let cx = mx;
      let cy = my;
      let mouseSpeed = 0;
      let prevMx = mx;
      let prevMy = my;
      let rafCursor = 0;
      let rafTrail = 0;
      let isActive = true;

      const trailParticles: TrailParticle[] = [];

      // ── Resize canvas
      function resizeTrail() {
        const dpr = Math.min(window.devicePixelRatio, 2);
        trailCanvas.width = window.innerWidth * dpr;
        trailCanvas.height = window.innerHeight * dpr;
        trailCanvas.style.width = window.innerWidth + 'px';
        trailCanvas.style.height = window.innerHeight + 'px';
      }
      resizeTrail();

      // ── Cursor tick (smooth follow)
      function tickCursor() {
        if (!isActive) return;
        const dx = mx - prevMx;
        const dy = my - prevMy;
        mouseSpeed = lerp(mouseSpeed, Math.sqrt(dx * dx + dy * dy), 0.15);
        prevMx = mx;
        prevMy = my;
        cx = lerp(cx, mx, 0.22);
        cy = lerp(cy, my, 0.22);
        cursorEl.style.transform = `translate(${cx}px, ${cy}px)`;
        rafCursor = requestAnimationFrame(tickCursor);
      }
      rafCursor = requestAnimationFrame(tickCursor);

      // ── Spawn trail particle
      function spawnTrailParticle() {
        if (mouseSpeed < 1.5) return;
        const count = Math.min(3, Math.floor(mouseSpeed / 8) + 1);
        for (let i = 0; i < count && trailParticles.length < TRAIL_MAX; i++) {
          trailParticles.push({
            x: cx + (Math.random() - 0.5) * 8,
            y: cy + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 0.8,
            vy: (Math.random() - 0.5) * 0.8,
            life: 1.0,
            size: 1 + Math.random() * 2,
          });
        }
      }

      // ── Trail tick
      function tickTrail() {
        if (!isActive) return;
        const dpr = Math.min(window.devicePixelRatio, 2);
        trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
        spawnTrailParticle();
        for (let i = trailParticles.length - 1; i >= 0; i--) {
          const p = trailParticles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.025;
          if (p.life <= 0) {
            trailParticles.splice(i, 1);
            continue;
          }
          const alpha = p.life * 0.6;
          const sz = p.size * p.life * dpr;
          // Core particle
          trailCtx.beginPath();
          trailCtx.arc(p.x * dpr, p.y * dpr, sz, 0, Math.PI * 2);
          trailCtx.fillStyle = `hsla(${TRAIL_HUE}, 80%, 70%, ${alpha})`;
          trailCtx.fill();
          // Halo
          trailCtx.beginPath();
          trailCtx.arc(p.x * dpr, p.y * dpr, sz * 3, 0, Math.PI * 2);
          trailCtx.fillStyle = `hsla(${TRAIL_HUE}, 80%, 70%, ${alpha * 0.15})`;
          trailCtx.fill();
        }
        rafTrail = requestAnimationFrame(tickTrail);
      }
      rafTrail = requestAnimationFrame(tickTrail);

      // ── Pointer move
      function onPointerMove(e: PointerEvent) {
        mx = e.clientX;
        my = e.clientY;
      }

      // ── Click ripple
      function onBodyClick(e: MouseEvent) {
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = e.clientX + 'px';
        ripple.style.top = e.clientY + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 750);
      }

      // ── Hover detection (cursor link state)
      const HOVER_SELECTOR = 'button, a, input, textarea, [data-cursor="link"]';

      function onPointerOver(e: PointerEvent) {
        const t = e.target as Element | null;
        if (t && t.closest(HOVER_SELECTOR)) {
          document.body.classList.add('cursor-hover-link');
        }
      }

      function onPointerOut(e: PointerEvent) {
        const rel = e.relatedTarget as Element | null;
        if (!rel || !rel.closest(HOVER_SELECTOR)) {
          document.body.classList.remove('cursor-hover-link');
        }
      }

      // ── Resize listener
      function onResize() {
        resizeTrail();
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('click', onBodyClick);
      window.addEventListener('resize', onResize);
      document.addEventListener('pointerover', onPointerOver);
      document.addEventListener('pointerout', onPointerOut);

      // ── Deactivate function
      function deactivate() {
        isActive = false;
        cancelAnimationFrame(rafCursor);
        cancelAnimationFrame(rafTrail);

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('click', onBodyClick);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('pointerover', onPointerOver);
        document.removeEventListener('pointerout', onPointerOut);

        delete document.body.dataset['cursor'];
        document.body.classList.remove('cursor-hover-link');

        cursorEl.remove();
        trailCanvas.remove();
      }

      cleanup = deactivate;
    }

    // ── matchMedia change listener (e.g. user enables reduced-motion mid-session)
    function onMqChange(e: MediaQueryListEvent) {
      if (e.matches) {
        activate();
      } else {
        cleanup?.();
        cleanup = null;
      }
    }

    mq.addEventListener('change', onMqChange);

    if (mq.matches) {
      activate();
    }

    return () => {
      mq.removeEventListener('change', onMqChange);
      cleanup?.();
      cleanup = null;
    };
  }, []);

  // No DOM output — all elements are imperatively injected to <body>
  return null;
}
