// Tiny synthesized delight sounds (no audio assets). Off by default and
// opt-in per browser via localStorage; never plays without a user gesture.

const STORAGE_KEY = "nexus.soundpack.enabled";

export function isSoundEnabled() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* storage unavailable — sound preference simply won't persist */
  }
}

const TONES = {
  coin: [880, 0.09],
  spin: [520, 0.12],
  win: [660, 0.14],
  fanfare: [784, 0.22],
  deny: [180, 0.16],
};

let context = null;

export function playSound(kind = "coin") {
  if (!isSoundEnabled()) return;
  const [frequency, duration] = TONES[kind] || TONES.coin;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    context = context || new AudioCtx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  } catch {
    /* audio is delight-only; never break the app over it */
  }
}
