// webgl-support.ts
// Cheap, side-effect-free probe for WebGL availability.
//
// Why this exists (Fase 5 — a11y/robustness):
//   The neural engine is a WebGL/Three.js scene. On devices where WebGL is
//   absent or disabled (old hardware, locked-down corporate browsers, GPU
//   blocklist, `webgl.disabled` flags) creating a WebGLRenderer THROWS and the
//   canvas paints black. A prospective client on such a machine would see a
//   broken black screen instead of the pitch. This lets the caller detect the
//   condition up-front and degrade to the static fallback (no engine mount,
//   content revealed immediately) rather than mounting a broken canvas.
//
// The probe creates a throwaway <canvas>, tries webgl2 then webgl, and reads
// back a context. It allocates nothing persistent and loses the context after
// the check.

export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  // Some environments expose window.WebGLRenderingContext as undefined when GL
  // is compiled out entirely — bail early.
  if (typeof (window as { WebGLRenderingContext?: unknown }).WebGLRenderingContext === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return false;
    // Proactively release the probe context so we don't hold a GL slot.
    const loseCtx = (gl as WebGLRenderingContext).getExtension?.(
      "WEBGL_lose_context",
    ) as { loseContext?: () => void } | null;
    loseCtx?.loseContext?.();
    return true;
  } catch {
    // getContext can throw (not just return null) on some blocked configs.
    return false;
  }
}
