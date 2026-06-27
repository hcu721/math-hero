/* ============================================================
   app.js — the conductor. A tiny state machine that moves between
   three screens and runs one session of the day's skill:

        home  ──Start──▶  play (5 problems)  ──last──▶  reward
          ▲                                                │
          └──────────────── Back home ─────────────────────┘

   It wires the leaf modules (skills / visuals / speech / sfx /
   progress) to the DOM declared in index.html. Element IDs here MUST
   match that file. The engine is skill-agnostic: it dispatches the
   per-problem `visual` to visuals.js and honours an optional
   `mode:'flash'` (subitizing) — it never knows which skill is playing.
   ============================================================ */

import { todaysSkill, runSelfTest, SKILLS } from "./skills.js";
import { renderVisual, revealVisual } from "./visuals.js";
import * as speech from "./speech.js";
import * as sfx from "./sfx.js";
import * as progress from "./progress.js";

/* ---- config ---- */
const PROBLEMS_PER_SESSION = 5;
const PRAISE = ["Nice!", "You got it!", "Yes!", "Smooth!"];   // generic (retry) praise
// gentle, no-penalty nudges on a wrong tap (shown + spoken; emoji stripped from audio)
const NUDGE = [
  "Almost! Take another look. 👀",
  "So close! Look again. 👀",
  "Not quite. Check the pattern. 🤔",
  "Good try! Look once more. 👀",
  "Almost there! Have another look. 👀",
  "Close one! Try again. 💪",
  "Nice try! Look and see. 👀",
];
const pick = (a) => a[Math.floor(Math.random() * a.length)]; // random item from a list

/* ---- reduce-motion: honour the system setting (PRD risk #7) ---- */
const reduceMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
if (reduceMotion) document.body.classList.add("no-motion");

/* ---- which skill? default = +10; ?skill=<id> overrides for preview ---- */
function pickSkill() {
  const id = new URLSearchParams(location.search).get("skill");
  return (id && SKILLS[id]) ? SKILLS[id] : todaysSkill();
}

/* ---- DOM handles ---- */
const $ = (id) => document.getElementById(id);
const screens = document.querySelectorAll(".screen");
const els = {
  homeSkill: $("home-skill"),
  homeStreak: $("home-streak"),
  startBtn: $("start-btn"),
  dots: $("dots"),
  prompt: $("prompt"),
  visual: $("visual"),
  choices: $("choices"),
  feedback: $("feedback"),
  hintBtn: $("hint-btn"),
  replayBtn: $("replay-btn"),
  rewardTitle: $("reward-title"),
  rewardStars: $("reward-stars"),
  rewardSpeed: $("reward-speed"),
  confetti: $("confetti"),
  homeBtn: $("home-btn"),
};

/* A persistent full-screen confetti layer. The markup's #confetti lives
   INSIDE the reward screen (hidden during play), so play-time bursts must
   go here instead, or they never show. */
const fxLayer = document.createElement("div");
fxLayer.className = "confetti";
document.body.append(fxLayer);

/* ---- session state ---- */
let skill = pickSkill();
let session = null;   // { problems[], index, correctFirstTry, sessionMs, _priorAvg }
let demoing = false;  // true while the worked-example walkthrough is on screen

function showScreen(name) {
  screens.forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
}

/* ============ HOME ============ */
function initHome() {
  skill = pickSkill();
  els.homeSkill.textContent = skill.label;
  els.homeStreak.textContent = `🔥 Streak: ${progress.getStreak()} days`;
  showScreen("home");
}

function startSession() {
  // iOS: unlock speech AND audio INSIDE this tap, or the first cues are silent.
  speech.unlock();
  sfx.unlock();

  const problems = Array.from({ length: PROBLEMS_PER_SESSION }, () => skill.generate());
  session = { problems, index: 0, correctFirstTry: 0, sessionMs: 0 };

  buildDots();
  showScreen("play");

  // #4 worked-example demo — only the FIRST time she ever meets this skill
  if (!progress.hasSeen(skill.id)) {
    runDemo(() => { progress.markSeen(skill.id); renderProblem(); });
  } else {
    renderProblem();
  }
}

/* ============ WORKED-EXAMPLE DEMO (#4) ============ */
function runDemo(done) {
  demoing = true;
  const p = skill.example();
  setPrompt(p);
  showSolved(p);                  // the demo reveals everything, so show the solved sentence
  setFeedback(`That's ${p.answer}. ${skill.explain}`, "soft");
  renderVisual(els.visual, p.visual);
  revealVisual(els.visual, p.visual, { animate: false, full: true });   // show the COMPLETE pattern
  speech.speak(`Watch. ${skill.explain}`);
  [...els.dots.children].forEach((d) => d.classList.remove("done", "current"));

  // one big "Got it!" button stands in for the choices during the demo
  els.choices.hidden = false;     // in case a prior flash left it hidden
  els.choices.innerHTML = "";
  const b = document.createElement("button");
  b.className = "btn btn-go";
  b.textContent = "Got it! ▶";
  b.style.gridColumn = "1 / -1";          // span the full 3-col choices grid
  b.addEventListener("click", () => { sfx.tap(); demoing = false; done(); });
  els.choices.append(b);
}

/* ============ PLAY ============ */
function buildDots() {
  els.dots.innerHTML = "";
  for (let i = 0; i < PROBLEMS_PER_SESSION; i++) {
    const d = document.createElement("span");
    d.className = "dot";
    els.dots.append(d);
  }
}

function updateDots() {
  [...els.dots.children].forEach((d, i) => {
    d.classList.toggle("done", i < session.index);
    d.classList.toggle("current", i === session.index);
  });
}

function current() { return session.problems[session.index]; }

function renderProblem() {
  const p = current();
  clearTimeout(p._flashTimer);
  clearTimeout(p._lockTimer);
  p._answered = false;
  p._wrongOnce = false;
  p._shownPattern = false;
  p._predictPrompted = false;
  p._loggedMiss = false;

  setFeedback("", "");
  updateDots();
  showVisual();             // clear any leftover flash-hide (subitize dots / addfacts equation)
  showPrompt();
  els.choices.hidden = false;

  if (p.steps) {            // multi-step problem (Quick Add): name each frame, then the total
    p._step = 0;
    p._startedAt = now();
    renderStep(p);
    return;
  }

  setPrompt(p);
  renderChoices(p);
  if (p.mode === "flash") {
    flash(p);                       // subitizing: flash the group, hide it, then answer
  } else {
    renderVisual(els.visual, p.visual);
    speech.speak(p.spoken);
    p._startedAt = now();
  }
}

/* Render one step of a multi-step problem: its prompt + choices, and the shared
   visual with that step's emphasis. A `flash` step shows the frame briefly then hides
   it (recognise, don't count); a non-flash step HOLDS the visual (e.g. the total). */
function renderStep(p) {
  const step = p.steps[p._step];
  setFeedback("", "");                                    // clear the "Yes!" from the previous step
  setPrompt(step);
  renderChoices(p);                                       // reads p.steps[p._step].choices
  if (step.flash) {
    flashStep(p);
  } else {
    showVisual();
    renderVisual(els.visual, { ...p.visual, emphasize: step.emphasize });
    speech.speak(step.spoken || step.prompt);
  }
}

/* Flash the current step's frame (with its emphasis), hiding the answers for the
   look, then hide the frame and bring the answers in. `ms` lets a re-flash hang
   longer. Used by Quick Add's identify steps (the total step holds, doesn't flash). */
function flashStep(p, ms = p.flashMs ?? 2000) {
  const step = p.steps[p._step];
  clearTimeout(p._flashTimer);
  els.choices.classList.add("flash-hide");
  showVisual();
  renderVisual(els.visual, { ...p.visual, emphasize: step.emphasize });
  speech.speak(step.spoken || step.prompt);
  p._flashTimer = setTimeout(() => {
    hideVisual();
    els.choices.classList.remove("flash-hide");
  }, ms);
}

/* Render the equation, colour-coded to the dots when the skill provides it
   (yellow = known, green = added); plain text otherwise. */
function setPrompt(p) {
  if (p.promptHtml) els.prompt.innerHTML = p.promptHtml;
  else els.prompt.textContent = p.prompt;
}

/* On a CORRECT answer, complete the number sentence — swap the "?" for the answer
   in green (the abstract "A" of concrete→representational→abstract). Only ever
   called on a win, so it never leaks the answer during the problem. */
function showSolved(p) {
  if (p.solvedHtml) els.prompt.innerHTML = p.solvedHtml;
}

/* Flash skills hide the flashed thing but KEEP its box in the layout (visibility,
   not display) so nothing shifts when the answers return: the DOTS for subitize, the
   EQUATION (prompt) for addfacts. No-ops for non-flash skills (class never present). */
const showVisual = () => els.visual.classList.remove("flash-hide");
const hideVisual = () => els.visual.classList.add("flash-hide");
const showPrompt = () => els.prompt.classList.remove("flash-hide");
const hidePrompt = () => els.prompt.classList.add("flash-hide");

/* Flash the group with NO answers in view (less distraction — she recognises the
   group, she doesn't match it against the options), then hide the dots and reveal
   the choices. Reused by 🔊 replay so she can peek again. `ms` lets a re-flash hang
   longer than the first look (ten-frames take a beat more to read than dice). */
function flash(p, ms = p.flashMs ?? 1800) {
  clearTimeout(p._flashTimer);
  // keep the answers in the layout (so nothing shifts when they return) but
  // INVISIBLE during the flash — she recognises the group, doesn't match options
  els.choices.hidden = false;
  els.choices.classList.add("flash-hide");
  if (p.visual) { showVisual(); renderVisual(els.visual, p.visual); }
  else showPrompt();                          // no visual (addfacts): the EQUATION is what flashes
  speech.speak(p.spoken);
  p._flashTimer = setTimeout(() => {
    if (p.visual) hideVisual(); else hidePrompt();   // hide the dots OR the equation (keep the box)
    setFeedback(p.visual ? "Now — how many? 👆" : "Now — what's the answer? 👆", "soft");
    els.choices.classList.remove("flash-hide");      // reveal the answers in the reserved space
    p._startedAt = now();                            // time only the thinking, not the flash
  }, ms);
}

function renderChoices(p) {
  els.choices.innerHTML = "";
  const q = p.steps ? p.steps[p._step] : p;   // a stepped problem draws the current step's choices
  for (const value of q.choices) {
    const b = document.createElement("button");
    b.className = "btn choice";
    b.textContent = value;
    b.addEventListener("click", () => onChoice(b, value, p));
    els.choices.append(b);
  }
}

function onChoice(btn, value, p) {
  if (p._answered) return;
  const q = p.steps ? p.steps[p._step] : p;   // the active question: a step, or the whole problem

  if (value === q.answer) {
    // ---- correct ----
    if (p.steps && p._step < p.steps.length - 1) {
      // an identify step (left / right): quick confirm, then on to the next step
      btn.classList.add("is-right");
      disableChoices();
      sfx.correct();
      setFeedback("Yes!", "good");
      setTimeout(() => { p._step++; renderStep(p); }, 750);
      return;
    }

    // the final question (the total), or a normal one-shot problem → full solve
    p._answered = true;
    clearTimeout(p._flashTimer);
    clearTimeout(p._lockTimer);
    const clean = !p._wrongOnce;
    // record the silent time only on a clean first-try solve
    if (clean) {
      session.correctFirstTry++;
      session.sessionMs += now() - p._startedAt;
      progress.recordTime(skill.id, now() - p._startedAt);
    }
    btn.classList.add("is-right");
    showPrompt();                   // addfacts: un-hide the equation so the solved form shows
    showSolved(p);                  // complete the equation: "7 + 3 = 10"
    disableChoices();
    sfx.correct();
    // #2 strategy-praise on a clean solve ("you used the move"); gentle generic on a recovery.
    const praise = clean ? pick([].concat(skill.win)) : pick(PRAISE);
    setFeedback(praise, "good");
    showVisual();
    const revealMs = p.visual?.revealOnWin
      ? revealVisual(els.visual, p.visual, { animate: !reduceMotion, full: true }) || 0
      : 0;
    celebrateThenAdvance(praise, revealMs, p.holdMs || 0);   // p.holdMs: extra dwell (addtens, subitize)
  } else {
    // ---- wrong: NO penalty, let her retry ----
    p._wrongOnce = true;
    if (!p._loggedMiss) { progress.logMiss(skill.id, q, value); p._loggedMiss = true; }   // log the active question
    btn.classList.add("is-wrong");
    btn.disabled = true;
    sfx.wrong();
    const nudge = pick(NUDGE);
    setFeedback(nudge, "soft");
    if (p.mode === "flash") {
      // legacy flash skills: re-flash (don't hold the group), hanging longer on a retry
      flash(p, p.reflashMs);
    } else if (p.steps) {
      speech.speak(nudge);
      if (p.steps[p._step].flash) flashStep(p, p.reflashMs);   // identify step: re-flash for another look
      else lockChoicesBriefly(p);                              // held step (total): just a beat, retry
    } else {
      speech.speak(nudge);
      showVisual();             // un-hide the box before re-showing the pattern
      revealVisual(els.visual, p.visual, { animate: !reduceMotion });
      lockChoicesBriefly(p);    // a beat to LOOK at the pattern (anti-mash, QA risk #3)
    }
  }
}

function disableChoices() {
  [...els.choices.children].forEach((b) => (b.disabled = true));
}

/* After a wrong tap, disable every choice for a short beat, then re-enable the
   ones still in play (the wrong ones stay out). This stops her mashing all three
   buttons without looking at the revealed pattern — and, as a side effect, stops
   stacked wrong-sounds / nudges. NOT a penalty: it's a pacing beat (PRD risk #3). */
function lockChoicesBriefly(p) {
  disableChoices();
  clearTimeout(p._lockTimer);
  p._lockTimer = setTimeout(() => {
    if (p._answered) return;
    [...els.choices.children].forEach((b) => {
      if (!b.classList.contains("is-wrong")) b.disabled = false;
    });
  }, reduceMotion ? 700 : 1000);
}

function setFeedback(text, kind) {
  els.feedback.textContent = text;
  els.feedback.className = `feedback ${kind || ""}`.trim();
}

/* Hold on the correct answer until BOTH the spoken praise has finished AND the
   celebration has played, then move on. When there's a reveal animation, the
   confetti waits until it lands (after the last wave of dots) and we hold long
   enough for it to show. Hard safety cap covers iOS not reporting speech end. */
function celebrateThenAdvance(praise, revealMs = 0, holdMs = 0) {
  if (!reduceMotion) {
    if (revealMs > 0) setTimeout(miniConfetti, revealMs);   // burst once the dots land
    else miniConfetti();
  }
  const base = reduceMotion ? 600 : 1150;
  // `holdMs` lingers EXTRA on the finished screen (e.g. addtens: time to read the
  // worked equation) — added after the confetti, so the burst still fires on time.
  const minDelay = Math.max(base, revealMs > 0 ? revealMs + 650 : 0) + holdMs;
  let speechDone = false, minDone = false, advanced = false;
  const finish = () => {
    if (advanced || !(speechDone && minDone)) return;
    advanced = true;
    nextProblem();
  };
  speech.speak(praise, { onEnd: () => { speechDone = true; finish(); } });
  setTimeout(() => { minDone = true; finish(); }, minDelay);
  setTimeout(() => { speechDone = minDone = true; finish(); }, minDelay + 1600);
}

function nextProblem() {
  session.index++;
  if (session.index >= PROBLEMS_PER_SESSION) finishSession();
  else renderProblem();
}

/* Hint: "Show me the pattern". #3 predict-before-reveal — the FIRST press
   nudges her to commit a guess; only then does the pattern get revealed,
   so the hint is retrieval practice, not a free answer. */
function onHint() {
  const p = current();
  // ignore during the demo (wrong problem on screen) and during the subitize
  // flash (answers invisible — nothing to guess against yet)
  if (demoing || !p || p._answered || els.choices.classList.contains("flash-hide")) return;

  if (!p._wrongOnce && !p._predictPrompted) {
    p._predictPrompted = true;
    setFeedback("Take your best guess first — then I'll show you. 🤔", "soft");
    speech.speak("Take your best guess first.");
    sfx.tap();
    return;
  }

  p._shownPattern = true;
  showVisual();
  showPrompt();               // addfacts: re-show the hidden equation on a hint
  if (p.steps) renderVisual(els.visual, { ...p.visual, emphasize: p.steps[p._step].emphasize });
  else revealVisual(els.visual, p.visual, { animate: !reduceMotion });
  setFeedback(skill.explain, "soft");
  speech.speak(skill.explain);
}

function onReplay() {
  const p = current();
  // not during the demo (wrong question), nor after answering (would cut the praise)
  if (demoing || !p || p._answered) return;
  if (p.mode === "flash") flash(p);   // #4: re-show the group, not just re-speak with nothing to see
  else if (p.steps) {
    const step = p.steps[p._step];
    if (step.flash) flashStep(p);     // re-flash the frame to peek again
    else speech.speak(step.spoken || step.prompt);
  } else speech.speak(p.spoken);
}

/* ============ REWARD ============ */
function finishSession() {
  updateDots();

  const correct = session.correctFirstTry;
  progress.addStars(correct);

  els.rewardStars.textContent =
    "⭐".repeat(correct) + "☆".repeat(PROBLEMS_PER_SESSION - correct);

  els.rewardTitle.textContent =
    correct === PROBLEMS_PER_SESSION ? "Perfect! 🎉" : "You did it! 🎉";

  els.rewardSpeed.textContent = speedLine();

  showScreen("reward");
  sfx.fanfare();
  if (!reduceMotion) bigConfetti();
  speech.speak(
    correct === PROBLEMS_PER_SESSION
      ? "Perfect session! You are a number hero."
      : "Great job! You finished today's mission."
  );
}

/* "Getting faster" gauge — self-referential, never a threshold.
   Compares this session's average solve time to the kid's OWN prior
   rolling average. No history yet → a neutral, encouraging line. */
function speedLine() {
  const solved = session.correctFirstTry;
  if (solved === 0) return "Nice effort — let's try again next time! 💪";

  const thisAvg = session.sessionMs / solved;
  const prior = session._priorAvg;

  if (prior == null) return "Let's see how fast you get this summer! ⚡";
  if (thisAvg <= prior * 0.92) return "Getting faster! ⚡⚡";
  if (thisAvg <= prior * 1.08) return "Nice and steady. ⚡";
  return "Taking your time — that's totally fine. 🙂";
}

/* ---- confetti (gated by reduce-motion before being called) ---- */
const EMOJI = ["⭐", "🎉", "✨", "💥", "🌟", "🎊"];
function spawnConfetti(n, dur) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.textContent = EMOJI[Math.floor(Math.random() * EMOJI.length)];
    s.style.left = Math.random() * 100 + "vw";
    s.style.animationDelay = Math.random() * 150 + "ms";
    s.style.animationDuration = dur + "ms";
    fxLayer.append(s);
    setTimeout(() => s.remove(), dur + 300);
  }
}
// the per-answer burst is short (≈1s) so it completes within the dwell above
function miniConfetti() { spawnConfetti(10, 1000); }
function bigConfetti() { spawnConfetti(40, 1600); }

/* ---- monotonic-ish timer ---- */
function now() { return (window.performance?.now?.() ?? Date.now()); }

/* ============ WIRE IT UP ============ */
els.startBtn.addEventListener("click", () => {
  // capture the prior rolling average ONCE, before this session adds to it
  const hist = progress.getAll().times[skill.id] || [];
  startSession();
  session._priorAvg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
});
els.hintBtn.addEventListener("click", onHint);
els.replayBtn.addEventListener("click", onReplay);
els.homeBtn.addEventListener("click", initHome);

// Optional self-test: open index.html?debug to run generator asserts.
if (new URLSearchParams(location.search).has("debug")) runSelfTest();

initHome();

/* ---- PWA: register the service worker for offline + installability.
   Only on a real http(s) origin (skips file://, where it would throw)
   and only where supported. Kept dead last and deferred to `load` so it
   never competes with the first paint or the game logic. A failure here
   just means no offline cache — the app still runs fine online. */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => {
      // not fatal — the app still runs online; we log (not swallow) so a
      // failed install is visible when verifying the deploy on the device
      console.warn("Service worker registration failed:", err);
    });
  });
}
