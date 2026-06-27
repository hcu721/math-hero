/* ============================================================
   speech.js — read-aloud wrapper around the Web Speech API.

   The PRD flags this as the #1 risk: on iOS Safari, (a) voices
   load ASYNCHRONOUSLY (the list is empty for the first moment),
   and (b) audio is BLOCKED until a real user gesture. So we:
     - wait for the `voiceschanged` event before trusting voices,
     - "unlock" speech inside the first tap (the Start button),
     - and the app ALWAYS shows text too, so a silent failure
       never hides the problem.
   ============================================================ */

let voices = [];
let preferred = null;
let unlocked = false;
let soundOn = true;            // a future settings screen can flip this

const synth = window.speechSynthesis;
const supported = typeof synth !== "undefined";

/* Pick a clear English voice when the list is ready. */
function loadVoices() {
  if (!supported) return;
  voices = synth.getVoices();
  preferred =
    voices.find(v => /en[-_]US/i.test(v.lang) && /female|samantha|karen|zira/i.test(v.name)) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0] ||
    null;
}

if (supported) {
  loadVoices();
  // iOS fires this once voices are actually available — re-pick then.
  synth.addEventListener?.("voiceschanged", loadVoices);
}

/* Call this INSIDE a user gesture (the Start tap) to satisfy iOS. */
export function unlock() {
  if (!supported || unlocked) return;
  loadVoices();
  // Speaking a near-silent utterance during the gesture primes the engine.
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  try { synth.speak(u); } catch (_) {}
  unlocked = true;
}

/* Emoji read beautifully on screen but speech engines either say them
   aloud ("eyes" for 👀) or stumble — so strip them (plus the joiners and
   variation selectors that glue emoji together) from the SPOKEN copy only.
   The on-screen text keeps its emoji; just don't pass it through here. */
function stripEmoji(s) {
  return s
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Speak a line. Safe to call even if speech is unsupported.
   `onEnd` fires when the line finishes (or immediately if we can't/won't
   speak), so callers can wait for the audio before moving on. */
export function speak(text, { rate = 0.95, pitch = 1.05, onEnd } = {}) {
  const spoken = text ? stripEmoji(text) : "";
  if (!supported || !soundOn || !spoken) { onEnd?.(); return; }
  if (!preferred) loadVoices();         // iOS: voices may have arrived since load — retry the pick
  synth.cancel();                       // never let lines pile up / overlap
  const u = new SpeechSynthesisUtterance(spoken);
  if (preferred) u.voice = preferred;
  u.rate = rate;
  u.pitch = pitch;
  u.lang = preferred?.lang || "en-US";
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }   // 'interrupted' also routes here
  try { synth.speak(u); } catch (_) { onEnd?.(); }
}

export function stop() { if (supported) synth.cancel(); }

export function setSound(on) { soundOn = !!on; if (!soundOn) stop(); }
export function isSupported() { return supported; }
