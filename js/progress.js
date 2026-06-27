/* ============================================================
   progress.js — localStorage persistence.

   PHASE 1 scope only: the two things the +10 loop needs —
     1) SILENT response times per skill, for the "getting faster"
        gauge (PRD: timed silently, NEVER shown live, compared to
        the kid's OWN rolling average — never a threshold).
     2) the PARENT MISS-LOG (locked as v1): quietly record which
        problem was missed so Howard can spot weak spots.

   DEFERRED to Phase 2 (schedule.js + a fuller progress model):
   streak, best streak, total stars, AM/PM completion, the summer
   calendar. The keys below leave room for those without building
   them yet.
   ============================================================ */

const KEY = "mathhero.v1";

const blank = () => ({
  times: {},        // { skillId: [ms, ms, ...] }  (rolling, capped)
  missLog: [],      // { skillId, prompt, answer, chose, at }  (capped)
  starsTotal: 0,
  seenSkills: {},   // { skillId: true }  — drives the once-ever worked-example demo
  // reserved for later phases (declared so the shape is forward-compatible):
  streak: 0, bestStreak: 0, days: {},
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch (_) {
    return blank();           // private mode / disabled storage → run anyway
  }
}

function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
}

/* Record one answer's time (ms). Returns the kid's PRIOR rolling
   average BEFORE this time is folded in, so the gauge can compare
   "this session vs. how you usually do." null if no history yet. */
export function recordTime(skillId, ms) {
  const s = load();
  const arr = s.times[skillId] || [];
  const prior = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  arr.push(ms);
  // keep the last 50 only — a *rolling* average, not all-time
  s.times[skillId] = arr.slice(-50);
  save(s);
  return prior;
}

/* Quietly log a missed problem for the parent miss-log. */
export function logMiss(skillId, problem, chose) {
  const s = load();
  s.missLog.push({
    skillId,
    prompt: problem.prompt,
    answer: problem.answer,
    chose,
    at: new Date().toISOString(),
  });
  s.missLog = s.missLog.slice(-200);   // cap so storage can't grow unbounded
  save(s);
}

export function addStars(n) {
  const s = load();
  s.starsTotal += n;
  save(s);
  return s.starsTotal;
}

/* Worked-example demo (#4): show a skill's walkthrough only the
   FIRST time the kid ever meets it. */
export function hasSeen(skillId) { return !!load().seenSkills[skillId]; }
export function markSeen(skillId) {
  const s = load();
  s.seenSkills[skillId] = true;
  save(s);
}

export function getStreak() { return load().streak; }   // 0 until the curriculum phase fills it
export function getMissLog() { return load().missLog; }
export function getAll() { return load(); }
