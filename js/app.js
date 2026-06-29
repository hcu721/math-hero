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

import { runSelfTest, SKILLS } from "./skills.js";
import { renderVisual, revealVisual } from "./visuals.js";
import * as speech from "./speech.js";
import * as sfx from "./sfx.js";
import * as progress from "./progress.js";
import * as curriculum from "./curriculum.js";

/* ---- config ---- */
// Round length is PER-SKILL now (curriculum.roundLength → 5/7/10); set on the session at start.
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

/* ---- local zero-padded day key (NEVER toISOString — UTC flips the "day" mid-
   afternoon in US zones). Used for the once-per-day daily-return coin. ---- */
const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---- DOM handles ---- */
const $ = (id) => document.getElementById(id);
const screens = document.querySelectorAll(".screen");
const els = {
  // board (home)
  logo: $("logo"),
  jar: $("jar"),
  jarFill: $("jar-fill"),
  coinAmt: $("coin-amt"),
  seasonLine: $("season-line"),
  tiles: $("tiles"),
  avatarBox: $("avatar-box"),
  // play
  dots: $("dots"),
  prompt: $("prompt"),
  visual: $("visual"),
  choices: $("choices"),
  feedback: $("feedback"),
  hintBtn: $("hint-btn"),
  replayBtn: $("replay-btn"),
  // reward
  rewardTitle: $("reward-title"),
  rewardStars: $("reward-stars"),
  rewardCoins: $("reward-coins"),
  rewardSpeed: $("reward-speed"),
  confetti: $("confetti"),
  homeBtn: $("home-btn"),
  // hidden parent panel
  panel: $("parent-panel"),
  panelRows: $("panel-rows"),
  panelUnlock: $("panel-unlock"),
  panelClose: $("panel-close"),
};

/* A persistent full-screen confetti layer. The markup's #confetti lives
   INSIDE the reward screen (hidden during play), so play-time bursts must
   go here instead, or they never show. */
const fxLayer = document.createElement("div");
fxLayer.className = "confetti";
document.body.append(fxLayer);

/* ---- session state ---- */
let skill = null;     // set when a tile is tapped (or a ?skill=<id> dev preview)
let session = null;   // { problems[], index, correctFirstTry, sessionMs, _priorAvg }
let demoing = false;  // true while the worked-example walkthrough is on screen

function showScreen(name) {
  screens.forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
}

/* ============ BOARD (home) ============ */
const JAR_GOAL = 120;   // coins to "wake the shop" — a near-term fill-to-goal target (cosmetic, Phase A)

function showBoard() { renderBoard(); showScreen("board"); }

/* Draw the bounded picker from curriculum.board(): mastered chips → the 2 live
   tiles → the single next-up padlock → a quiet pip row for the far-locked rest
   (NOT a wall of 13 padlocks). */
function renderBoard() {
  const cells = curriculum.board();                         // [{id,label,len,level,state}]
  const live = cells.filter((c) => c.state === "live");
  const mastered = cells.filter((c) => c.state === "mastered");
  const locked = cells.filter((c) => c.state === "locked");
  const nextUp = locked[0] || null;
  const farLocked = locked.slice(1);

  els.seasonLine.textContent =
    `Season ${progress.getCycle()} · ${mastered.length} of ${cells.length} unlocked`;

  els.tiles.innerHTML = "";
  if (mastered.length) { const r = rowEl(); mastered.forEach((c) => r.append(tileEl(c, "🏆"))); els.tiles.append(r); }
  if (live.length)     { const r = rowEl(); live.forEach((c) => r.append(tileEl(c, "⭐")));     els.tiles.append(r); }
  if (nextUp)          { const r = rowEl(); r.append(tileEl({ ...nextUp, state: "next" }, "🔒")); els.tiles.append(r); }
  if (farLocked.length) {
    const pips = document.createElement("div");
    pips.className = "locked-pips";
    farLocked.forEach(() => { const d = document.createElement("span"); d.className = "lp"; pips.append(d); });
    els.tiles.append(pips);
  }

  renderJar();
  renderAvatar();
}

function rowEl() { const r = document.createElement("div"); r.className = "tile-row"; return r; }

function tileEl(c, glyph) {
  const t = document.createElement("button");
  t.className = `tile ${c.state}`;
  const tappable = c.state === "live" || c.state === "mastered";
  t.disabled = !tappable;
  const levels = (c.state === "live" || c.state === "mastered")
    ? `<span class="levels">${["E", "M", "H"].map((L) => `<span class="lvl ${L === c.level ? "on" : ""}">${L}</span>`).join("")}</span>`
    : "";
  t.innerHTML =
    `<span class="tile-name">${glyph} ${c.label}</span>` +
    (c.state === "live" ? `<span class="tile-sub">${c.len} questions</span>` : "") +
    levels;
  if (tappable) t.addEventListener("click", () => startRound(SKILLS[c.id]));
  return t;
}

function renderJar() {
  const coins = progress.getCoins();
  els.coinAmt.textContent = coins;
  els.jarFill.style.width = Math.min(100, Math.round((coins / JAR_GOAL) * 100)) + "%";
}

/* The BLAND starter avatar (Phase A: free defaults only; the part-swap shop is Phase B).
   Drawn back→front: back-hair, legs, shorts, feet, torso, arms+hands, top, head, face, bangs. */
function renderAvatar() {
  const sk = "#f4c89a", hair = "#6b4226", gray = "#d2d2da", gray2 = "#c4c4cc";
  els.avatarBox.innerHTML = `
    <svg viewBox="0 0 240 300" xmlns="http://www.w3.org/2000/svg">
      <path d="M60 102 Q58 182 92 198 L148 198 Q182 182 180 102 Q180 46 120 46 Q60 46 60 102 Z" fill="${hair}"/>
      <rect x="100" y="226" width="18" height="64" rx="9" fill="${sk}"/>
      <rect x="122" y="226" width="18" height="64" rx="9" fill="${sk}"/>
      <rect x="98" y="224" width="20" height="34" rx="6" fill="${gray2}"/>
      <rect x="122" y="224" width="20" height="34" rx="6" fill="${gray2}"/>
      <ellipse cx="106" cy="292" rx="12" ry="8" fill="${sk}"/>
      <ellipse cx="134" cy="292" rx="12" ry="8" fill="${sk}"/>
      <path d="M86 158 Q120 148 154 158 L150 232 Q120 244 90 232 Z" fill="${sk}"/>
      <rect x="60" y="162" width="16" height="66" rx="8" fill="${sk}" transform="rotate(9 68 195)"/>
      <rect x="164" y="162" width="16" height="66" rx="8" fill="${sk}" transform="rotate(-9 172 195)"/>
      <circle cx="62" cy="228" r="10" fill="${sk}"/>
      <circle cx="178" cy="228" r="10" fill="${sk}"/>
      <path d="M90 160 Q120 153 150 160 L148 228 Q120 238 92 228 Z" fill="${gray}"/>
      <circle cx="86" cy="170" r="11" fill="${gray}"/>
      <circle cx="154" cy="170" r="11" fill="${gray}"/>
      <rect x="110" y="146" width="20" height="16" fill="${sk}"/>
      <circle cx="64" cy="104" r="10" fill="${sk}"/>
      <circle cx="176" cy="104" r="10" fill="${sk}"/>
      <circle cx="120" cy="102" r="54" fill="${sk}"/>
      <ellipse cx="101" cy="107" rx="9" ry="11" fill="#fff"/><ellipse cx="139" cy="107" rx="9" ry="11" fill="#fff"/>
      <circle cx="101" cy="109" r="5.5" fill="#3a2e3f"/><circle cx="139" cy="109" r="5.5" fill="#3a2e3f"/>
      <path d="M111 125 Q120 132 129 125" fill="none" stroke="#b5557a" stroke-width="3" stroke-linecap="round"/>
      <path d="M68 102 Q66 50 120 49 Q174 50 172 102 Q150 74 120 78 Q90 74 68 102 Z" fill="${hair}"/>
    </svg>`;
}

/* ---- hidden parent report: long-press the logo ~2s (no address bar in the
   installed PWA, so she can't stumble in). pointer-based, cancels on a 10px drag. ---- */
function bindLongPress(el, ms, fn) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; cancel(); timer = setTimeout(fn, ms); });
  el.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

function openPanel() {
  const cells = curriculum.board();
  els.panelRows.innerHTML = cells.map((c) => {
    const st = progress.getSkill(c.id);
    const acc = st.attempts ? Math.round((st.firstTry / st.attempts) * 100) : 0;
    const badge = c.state === "mastered" ? "🏆" : c.state === "live" ? "⭐" : "🔒";
    return `<div class="panel-row"><span class="pr-skill">${badge} ${c.label}</span>` +
           `<span class="pr-stat">${acc}% &middot; ${st.firstTry}/${st.attempts}</span></div>`;
  }).join("");
  els.panel.hidden = false;
}
function closePanel() { els.panel.hidden = true; }
function parentUnlock() {
  const live = curriculum.liveIds();
  if (live.length) { progress.forceClearThisCycle(live[0]); curriculum.advanceIfComplete(); }
  closePanel();
  renderBoard();
}

function startRound(s) {
  skill = s;
  // iOS: unlock speech AND audio INSIDE this tap, or the first cues are silent.
  speech.unlock();
  sfx.unlock();

  const len = curriculum.roundLength(skill.id);     // per-skill round length (5 / 7 / 10)
  const cycle = progress.getCycle();
  // generate(cycle) is the E/M/H ESCALATOR HOOK — generators ignore the arg today, so
  // passing it is harmless now and avoids a retrofit when difficulty scaling lands.
  const problems = Array.from({ length: len }, () => skill.generate(cycle));
  const hist = progress.getAll().times[skill.id] || [];
  session = {
    problems, len, index: 0, correctFirstTry: 0, sessionMs: 0,
    cleanFlags: [], roundId: `${skill.id}:${now()}`, _committed: false,
    // capture the kid's PRIOR rolling average BEFORE this round folds in
    _priorAvg: hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null,
  };

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
  for (let i = 0; i < session.len; i++) {
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
  els.visual.innerHTML = ""; // wipe any stale visual from the previous round: a no-visual FLASH
                             // skill (addfacts) never fills this box, so an earlier skill's
                             // ten-frame would otherwise linger behind the equation. Each branch
                             // below re-fills the box if THIS problem has a visual.

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
    session.cleanFlags.push(clean ? 1 : 0);   // one 1/0 per PROBLEM → feeds the gate + coins (finishRound)
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
    // Only a miss on the SCORED (final / one-shot) question poisons first-try accuracy.
    // An identify-step slip (subitize naming a flashed frame) still gets the re-look help
    // below, but doesn't count against mastery — that skill's gate is "totals first-try."
    const isFinalQ = !p.steps || p._step === p.steps.length - 1;
    if (isFinalQ) p._wrongOnce = true;
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
  if (session.index >= session.len) finishSession();
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
  if (session._committed) return;        // idempotency: commit a round exactly once
  session._committed = true;

  // ONE atomic write: folds first-try flags, pays coins, fires the +25 jackpot on a fresh
  // mastery (guarded). roundId guards against a double-invoke.
  const summary = progress.finishRound({
    skillId: skill.id, cleanFlags: session.cleanFlags, roundId: session.roundId,
  });
  const daily = progress.claimDailyReturn(localDayKey());   // +3 on the first completed round of a new day
  // advanceIfComplete returns the NEW cycle number iff that mastery just completed the whole Season.
  const newCycle = summary.newlyMastered ? curriculum.advanceIfComplete() : null;
  const seasonDone = newCycle ? newCycle - 1 : 0;          // the Season she just finished (frames the reset as a win)

  const correct = summary.cleanCount;
  els.rewardStars.textContent = "⭐".repeat(correct) + "☆".repeat(session.len - correct);
  els.rewardTitle.textContent =
    seasonDone ? `Season ${seasonDone} complete! 🎉🏆`
    : summary.newlyMastered ? "Skill unlocked! 🏆"
    : (correct === session.len ? "Perfect! 🎉" : "You did it! 🎉");

  let coinMsg = `+${summary.coinsEarned} 🪙`;
  if (summary.newBest) coinMsg += "  ·  New best! ✨";
  if (daily.granted) coinMsg += `  ·  +${daily.amount} daily`;
  els.rewardCoins.textContent = coinMsg;
  // Season-complete reframes the upcoming board reset as a fresh chapter, not erased trophies.
  els.rewardSpeed.textContent = seasonDone
    ? "You finished the whole board! A fresh Season begins. 🌟"
    : speedLine();

  showScreen("reward");
  sfx.fanfare();
  if (!reduceMotion) bigConfetti();
  if ((summary.newlyMastered || seasonDone) && !reduceMotion) {   // jackpot / Season fountain: extra bursts
    setTimeout(bigConfetti, 450);
    setTimeout(() => sfx.fanfare(), 380);
    if (seasonDone) setTimeout(bigConfetti, 900);                 // one more for the Season milestone
  }
  speech.speak(
    seasonDone ? `Wow! You finished Season ${seasonDone}! A whole new Season is ready for you.`
      : summary.newlyMastered ? "You unlocked a new skill! Amazing."
      : (correct === session.len ? "Perfect round! You are a number hero." : "Great job!")
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
els.hintBtn.addEventListener("click", onHint);
els.replayBtn.addEventListener("click", onReplay);
els.homeBtn.addEventListener("click", showBoard);          // "Back to board" after a round

// hidden parent report: long-press the ⭐ logo ~2s
bindLongPress(els.logo, 2000, openPanel);
els.panelUnlock.addEventListener("click", parentUnlock);
els.panelClose.addEventListener("click", closePanel);

// best-effort: ask the browser to keep our storage so a week-dark Safari TAB doesn't
// evict coins/avatar/Seasons (the installed PWA icon is exempt, but this is free insurance).
progress.requestPersistentStorage();

const params = new URLSearchParams(location.search);
if (params.has("debug")) runSelfTest();                    // self-test is pure; safe on a real device
// dev: ?seed=N pre-clears the first N spine skills (for screenshots of a mid-Season board)
const seedN = +(params.get("seed") || 0);
if (seedN > 0) {
  for (const id of curriculum.SEQUENCE.slice(0, seedN)) {
    const flags = Array(curriculum.roundLength(id)).fill(1);
    progress.finishRound({ skillId: id, cleanFlags: flags });
    progress.finishRound({ skillId: id, cleanFlags: flags });
  }
}
// dev: ?skill=<id> jumps straight into that skill's round (audio unlocks on the first tap)
const previewId = params.get("skill");
if (previewId && SKILLS[previewId]) startRound(SKILLS[previewId]);
else showBoard();

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
