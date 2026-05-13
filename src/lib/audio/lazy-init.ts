// lazy-init.ts
// User-gesture gate for the audio system.
//
// Browsers require a user gesture (click/tap) before AudioContext can be
// created or resumed. This module listens for the first click, then dynamically
// imports synapse-sound so the audio chunk stays OUT of the main bundle.
//
// After init, `window.__audioReady` is set so the engine, phase orchestrator,
// and preloader can call audio functions without importing the module directly.
//
// Mute persistence: if `localStorage.vhxco-mute` is "true" at boot time,
// we still initialize the module but keep it muted so the AudioContext is
// ready for when the user unmutes — and we don't call startAmbient().

declare global {
  interface Window {
    __audioReady: typeof import('./synapse-sound') | undefined;
  }
}

type AudioModule = typeof import('./synapse-sound');

let _initialized = false;

async function _initAudio(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const audio: AudioModule = await import('./synapse-sound');

  // Restore mute preference before starting anything
  const wasMuted = localStorage.getItem('vhxco-mute') === 'true';
  if (wasMuted) {
    // Pre-mute so startAmbient inside unmute won't fire
    // We still expose the module so programmatic control works
    window.__audioReady = audio;
    return;
  }

  audio.startAmbient();
  window.__audioReady = audio;
}

// { once: true } — auto-removes after first fire, no cleanup needed.
document.addEventListener('click', _initAudio, { once: true });

// Required to make this file a TS module — enables `declare global` augmentation.
export {};
