/* ============================================================
   sfx.js — sound effects generated IN CODE with the Web Audio API.

   PRD enhancement #6: audio "juice" with ZERO assets and $0 cost —
   just oscillators + gain envelopes. Behind the same sound idea as
   speech; both default on. Like speech, the AudioContext must be
   created/resumed inside a user gesture (the Start tap) or iOS keeps
   it suspended — so call unlock() there.
   ============================================================ */

let ctx = null;
let soundOn = true;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) ctx = new C();
  }
  return ctx;
}

/* Create/resume the context during a gesture (Start tap). */
export function unlock() {
  const c = ac();
  if (c && c.state === "suspended") c.resume();
}

/* One note with a soft attack/decay so it doesn't click. */
function tone(freq, start, dur, { type = "sine", peak = 0.15 } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function guard() { return soundOn && ac() != null; }

/* a bright rising two-note "ding" for a correct answer */
export function correct() {
  if (!guard()) return;
  tone(660, 0, 0.12, { type: "triangle" });
  tone(880, 0.10, 0.16, { type: "triangle" });
}

/* a soft, NON-punishing low blip for a wrong tap (gentle by design) */
export function wrong() {
  if (!guard()) return;
  tone(300, 0, 0.18, { type: "sine", peak: 0.10 });
}

/* a tiny click for general taps / reveals */
export function tap() {
  if (!guard()) return;
  tone(520, 0, 0.06, { type: "square", peak: 0.06 });
}

/* a little ascending arpeggio for the reward screen */
export function fanfare() {
  if (!guard()) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.22, { type: "triangle" }));
}

export function setSound(on) { soundOn = !!on; }
