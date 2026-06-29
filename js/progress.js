/* ============================================================
   progress.js — localStorage persistence (the app's long-term memory).

   v2 (Practice Board): adds the durable state the kid-driven loop needs on top
   of the v1 bits. The mental model:

     • There is ONE source of long-term truth (this store). The in-memory
       session/round is throwaway — force-closing the app only loses the
       current round, never coins or mastery (PRD: no mid-round resume).
     • Mastery is a PER-CYCLE checkpoint, NOT permanent. Clearing every skill in
       a cycle advances the "Season" (cycle++), which RE-OPENS all skills for
       another pass; coins + the avatar PERSIST across Seasons.
     • The +25 unlock JACKPOT fires once per skill per cycle — guarded so a
       reload/replay can't double-pay it. Daily-return fires once per local day.
     • Storage failures (Safari private mode, or no localStorage in Node) fall
       back to an in-memory store, so the app still runs AND the logic stays
       unit-testable headlessly.

   WHO READS WHAT (one record, several consumers):
     • the mastery GATE (isMastered) — slides the bounded picker window
     • the COIN faucet (finishRound) — same first-try signal pays coins
     • the hidden PARENT PANEL — per-skill accuracy + masteryAcc snapshot
   ============================================================ */

const KEY = "mathhero.v1";       // storage key — unchanged so any existing data survives
const BAK = "mathhero.v1.bak";   // last-known-good mirror (corruption fallback)
const SCHEMA = 2;

/* ---- the locked "Small & tidy" faucet + the mastery gate, as named constants
   so the parent panel can be used to retune them by eye later ---- */
export const COIN_FINISH = 1;         // finishing a round
export const COIN_FIRST_TRY = 1;      // each first-try-clean problem
export const COIN_JACKPOT = 25;       // unlocking a skill (mastery) — every cycle, the "big number"
export const COIN_NEW_BEST = 5;       // beating your OWN best clean-count for a skill (helps a stuck kid)
export const COIN_DAILY = 3;          // first completed round of a new local day
export const RECENT_CAP = 20;         // rolling first-try window the gate reads
export const MASTERY_ACC = 0.80;      // gate: first-try accuracy over recent[]
export const MASTERY_MIN_ROUNDS = 2;  // gate: rounds completed THIS cycle (so every skill = 2 sittings)
export const MASTERY_MIN_SAMPLE = 8;  // gate: minimum recent[] samples (the plan's "min ~8 problems" floor)

/* ---- tiny storage shim: real localStorage in the browser, an in-memory object
   everywhere else (Node tests, private mode). Never throws. ---- */
const hasLS = (() => {
  try { return typeof localStorage !== "undefined" && !!localStorage; } catch (_) { return false; }
})();
const mem = {};
const store = {
  get(k) { if (hasLS) { try { return localStorage.getItem(k); } catch (_) {} } return k in mem ? mem[k] : null; },
  set(k, v) { if (hasLS) { try { localStorage.setItem(k, v); return; } catch (_) {} } mem[k] = v; },
};

/* Probe whether REAL localStorage actually persists. iOS Safari private mode
   PASSES the truthiness check above but THROWS on setItem, so persistence
   silently falls back to the in-memory store and is lost on reload. The parent
   panel uses this to warn that progress won't survive a refresh. */
let _storageOK = null;
export function storageWorks() {
  if (_storageOK !== null) return _storageOK;
  if (!hasLS) { _storageOK = false; return _storageOK; }
  try { localStorage.setItem("__mh_probe", "1"); localStorage.removeItem("__mh_probe"); _storageOK = true; }
  catch (_) { _storageOK = false; }
  return _storageOK;
}

/* ---- the FREE "bland starter" avatar: only skin is a free *choice*; every
   other slot has a plain free default, and all variety is bought in Phase B ---- */
function defaultAvatar() {
  return {
    skin: 0,
    hair: "straight", hairColor: 0,
    eyes: "default", mouth: "smile", makeup: "none",
    top: "basic", topColor: 0,
    bottom: "basic", bottomColor: 0,
    shoes: "bare", shoesColor: 0,
    accessory: "none",
  };
}

const blank = () => ({
  schema: SCHEMA,
  /* ---- v2: Practice Board ---- */
  coins: 0,
  cycle: 1,                 // the "Season" counter (starts at 1)
  avatar: defaultAvatar(),  // currently equipped look
  owned: {},                // { itemId: true } — bought inventory (empty until the Phase-B shop)
  skills: {},               // LIFETIME record: { id: {attempts, firstTry, recent:[1,0,…cap20], bestRound, masteryAcc?} }
  cycleRounds: {},          // rounds completed THIS cycle per skill (reset each Season)
  cycleMastered: {},        // skills cleared THIS cycle (doubles as the once-per-cycle jackpot guard)
  cycleBest: {},            // best first-try-clean count THIS cycle per skill (re-arms the +5 each Season)
  lastRounds: [],           // recently committed roundIds — idempotency guard against a double-invoke
  lastDailyKey: "",         // local "YYYY-MM-DD" of the last daily-return grant
  /* ---- v1: kept so existing engine features + any saved data keep working ---- */
  times: {},                // { skillId: [ms,…] } — silent "getting faster" gauge
  missLog: [],              // parent miss-log
  starsTotal: 0,
  seenSkills: {},           // drives the once-ever worked-example demo
  // reserved for future use (declared so the shape is forward-compatible)
  streak: 0, bestStreak: 0, days: {},
});

function isValid(o) { return o && typeof o === "object" && typeof o.coins === "number"; }
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};   // coerce a structural field
const arr = (v) => (Array.isArray(v) ? v : []);

/* Load with a fallback chain: healthy main key → last-known-good mirror → fresh
   blank. CRITICAL (W2.1): a JSON-valid save can still be STRUCTURALLY corrupt
   (e.g. `skills:null` from a bad write), which would crash the hot path AND
   poison the mirror. So we COERCE every structural field to its expected type,
   and refresh the mirror from the SANITIZED object — never the raw string.
   Shallow-merge over blank() keeps old saves forward-compatible. */
function load() {
  for (const k of [KEY, BAK]) {
    const raw = store.get(k);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const merged = {
        ...blank(), ...parsed,
        avatar: { ...defaultAvatar(), ...obj(parsed.avatar) },
        skills: obj(parsed.skills),
        cycleRounds: obj(parsed.cycleRounds),
        cycleMastered: obj(parsed.cycleMastered),
        cycleBest: obj(parsed.cycleBest),
        owned: obj(parsed.owned),
        times: obj(parsed.times),
        seenSkills: obj(parsed.seenSkills),
        missLog: arr(parsed.missLog),
        lastRounds: arr(parsed.lastRounds),
      };
      if (isValid(merged)) {
        if (k === KEY) store.set(BAK, JSON.stringify(merged));   // mirror the SANITIZED state, not raw
        return merged;
      }
    } catch (_) { /* try the next source */ }
  }
  return blank();
}

function save(state) { store.set(KEY, JSON.stringify(state)); }

/* ============================================================
   v2: Practice Board
   ============================================================ */

export function getAll() { return load(); }
export function getCoins() { return load().coins; }
export function getCycle() { return load().cycle; }
export function getSkill(id) { return load().skills[id] || { attempts: 0, firstTry: 0, recent: [], bestRound: 0 }; }
export function getCycleRounds(id) { return load().cycleRounds[id] || 0; }
export function isClearedThisCycle(id) { return !!load().cycleMastered[id]; }
export function getAvatar() { return load().avatar; }

/* first-try accuracy over the rolling window (0..1) — the number the gate and
   the parent panel both read. */
export function accuracyOf(rec) {
  const r = (rec && rec.recent) || [];
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
}

/* The mastery GATE — a pure function over a record + this-cycle round count.
   ONE source of truth: curriculum.js imports this to compute tile states, and
   finishRound() uses it to detect the unlock moment. */
export function isMastered(rec, roundsThisCycle) {
  if (!rec || roundsThisCycle < MASTERY_MIN_ROUNDS) return false;
  if (!Array.isArray(rec.recent) || rec.recent.length < MASTERY_MIN_SAMPLE) return false;
  return accuracyOf(rec) >= MASTERY_ACC;
}

/* Commit ONE finished round atomically (single write). Folds the per-problem
   first-try flags into the lifetime record, bumps this cycle's round count,
   detects a FRESH mastery (idempotent +25 jackpot), and pays the round's coins.
   MUST be called exactly once per completed round (the engine guards that).

     cleanFlags : array of 1/0, one per problem (1 = answered first-try clean)
     surprise   : ×2 the round's coins (Phase C; pass false in Phase A)

   Returns a summary the reward screen uses. */
export function finishRound({ skillId, cleanFlags, surprise = false, roundId = null }) {
  const s = load();

  // W2.4 idempotency: if this exact round was already committed (a synchronous
  // double-invoke from the engine), return a no-op summary without mutating. The
  // id is generated at round START by the caller. (A reload can't reach here —
  // there is no mid-round resume, so the round is never re-committed across loads.)
  if (roundId && s.lastRounds.includes(roundId)) {
    const r0 = s.skills[skillId] || { recent: [], bestRound: 0 };
    return {
      cleanCount: cleanFlags.reduce((a, b) => a + b, 0), newBest: false,
      masteredNow: isMastered(r0, s.cycleRounds[skillId] || 0), newlyMastered: false,
      coinsEarned: 0, totalCoins: s.coins, roundsThisCycle: s.cycleRounds[skillId] || 0, duplicate: true,
    };
  }

  const rec = s.skills[skillId] || (s.skills[skillId] = { attempts: 0, firstTry: 0, recent: [], bestRound: 0 });
  if (!Array.isArray(rec.recent)) rec.recent = [];   // defensive against a malformed record
  const cleanCount = cleanFlags.reduce((a, b) => a + b, 0);

  // lifetime record
  rec.attempts += cleanFlags.length;
  rec.firstTry += cleanCount;
  rec.recent = rec.recent.concat(cleanFlags).slice(-RECENT_CAP);
  if (cleanCount > (rec.bestRound || 0)) rec.bestRound = cleanCount;   // lifetime PB (for the parent panel)

  // W2.3: the +5 "New best!" compares against this CYCLE's best, so it re-arms
  // each Season (a lifetime best would make it near-unwinnable after cycle 1 —
  // and it's meant to reward a kid who's improving).
  const newBest = cleanCount > (s.cycleBest[skillId] || 0);
  if (newBest) s.cycleBest[skillId] = cleanCount;

  // this-cycle round count
  s.cycleRounds[skillId] = (s.cycleRounds[skillId] || 0) + 1;

  // fresh mastery? (the cycleMastered guard stops a reload/replay re-firing the jackpot)
  const masteredNow = isMastered(rec, s.cycleRounds[skillId]);
  const newlyMastered = masteredNow && !s.cycleMastered[skillId];
  if (newlyMastered) {
    s.cycleMastered[skillId] = true;
    if (rec.masteryAcc == null) rec.masteryAcc = accuracyOf(rec);   // W5: snapshot acc AT the unlock (cleared each Season)
  }

  // coins: (finish + first-try) × surprise, then the un-multiplied milestone jackpot
  let coins = COIN_FINISH + cleanCount * COIN_FIRST_TRY;
  if (newBest) coins += COIN_NEW_BEST;
  if (surprise) coins *= 2;
  if (newlyMastered) coins += COIN_JACKPOT;
  s.coins += coins;

  if (roundId) s.lastRounds = s.lastRounds.concat(roundId).slice(-8);

  save(s);
  return {
    cleanCount, newBest, masteredNow, newlyMastered,
    coinsEarned: coins, totalCoins: s.coins,
    roundsThisCycle: s.cycleRounds[skillId],
  };
}

/* Daily-return coin on the FIRST completed round of a new local day (NOT on
   app-open — the faucet is tied to the learning move). todayKey = local
   "YYYY-MM-DD", computed by the caller so this stays clock-agnostic. Idempotent
   per day, with a backward-clock guard. */
export function claimDailyReturn(todayKey) {
  const s = load();
  if (!todayKey || s.lastDailyKey === todayKey) return { granted: false, totalCoins: s.coins };
  if (s.lastDailyKey && todayKey < s.lastDailyKey) return { granted: false, totalCoins: s.coins };  // clock moved back
  s.lastDailyKey = todayKey;
  s.coins += COIN_DAILY;
  save(s);
  return { granted: true, amount: COIN_DAILY, totalCoins: s.coins };
}

/* If EVERY skill in the sequence is cleared this cycle, advance the Season:
   reset the per-cycle state (re-opening every skill) while coins + avatar
   PERSIST. Returns the new cycle number, or null if not all cleared yet. */
export function maybeAdvanceCycle(sequenceIds) {
  const s = load();
  if (!sequenceIds.length || !sequenceIds.every((id) => s.cycleMastered[id])) return null;
  s.cycle += 1;
  s.cycleRounds = {};
  s.cycleMastered = {};
  s.cycleBest = {};
  // W2.2: mastery is PER-CYCLE, so clear the gate's accuracy window + the unlock
  // snapshot — a returning skill must re-prove itself THIS Season. Keep
  // attempts/firstTry/bestRound (lifetime totals the parent panel wants).
  for (const id in s.skills) {
    if (s.skills[id]) { s.skills[id].recent = []; s.skills[id].masteryAcc = null; }
  }
  save(s);
  return s.cycle;
}

/* Parent escape hatch (stuck kid): mark a skill cleared THIS cycle WITHOUT coins
   or a jackpot, so a plateaued window can slide. Mastery integrity is preserved —
   it never fakes first-try accuracy, it just opens the gate for that one tile. */
export function forceClearThisCycle(skillId) {
  const s = load();
  s.cycleMastered[skillId] = true;
  save(s);
}

/* Wipe ALL progress to a blank slate. Used by curriculum.js#runGateTest, and
   available for a future guarded parent "reset" action. DESTRUCTIVE. */
export function wipe() { save(blank()); }

/* ---- avatar (shape reserved now; the shop that fills `owned` is Phase B) ---- */
export function equip(slot, value) { const s = load(); s.avatar[slot] = value; save(s); return s.avatar; }
export function buy(itemId) { const s = load(); s.owned[itemId] = true; save(s); }
export function isOwned(itemId) { return !!load().owned[itemId]; }

/* Best-effort: ask the browser to keep our storage so iOS is less likely to
   evict it (which would wipe mastery). Safe to call once at startup. */
export async function requestPersistentStorage() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) {}
  return false;
}

/* ============================================================
   v1: kept intact (the running engine already calls these)
   ============================================================ */

/* Record one answer's time (ms). Returns the kid's PRIOR rolling average BEFORE
   this time is folded in, so the silent gauge can compare "this vs. usual". */
export function recordTime(skillId, ms) {
  const s = load();
  const arr = s.times[skillId] || [];
  const prior = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  arr.push(ms);
  s.times[skillId] = arr.slice(-50);   // rolling, not all-time
  save(s);
  return prior;
}

/* Quietly log a missed problem for the parent miss-log. */
export function logMiss(skillId, problem, chose) {
  const s = load();
  s.missLog.push({ skillId, prompt: problem.prompt, answer: problem.answer, chose, at: new Date().toISOString() });
  s.missLog = s.missLog.slice(-200);   // cap so storage can't grow unbounded
  save(s);
}

export function addStars(n) { const s = load(); s.starsTotal += n; save(s); return s.starsTotal; }

/* Worked-example demo: show a skill's walkthrough only the FIRST time ever. */
export function hasSeen(skillId) { return !!load().seenSkills[skillId]; }
export function markSeen(skillId) { const s = load(); s.seenSkills[skillId] = true; save(s); }

export function getStreak() { return load().streak; }
export function getMissLog() { return load().missLog; }
