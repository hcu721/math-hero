/* ============================================================
   curriculum.js — the SPINE + the bounded-picker gate.

   This module owns: the fixed teaching ORDER of the 15 skills, each skill's
   ROUND LENGTH, and the rule that turns the per-skill mastery record (from
   progress.js) into the board's tile states. It is PURE LOGIC — no DOM — so the
   engine (app.js) asks it "what's on the board / how long is this round / did
   the Season just complete?" and renders the answer. That keeps it
   headless-testable (see runGateTest at the bottom).

   THE BOUNDED PICKER (the heart of it): exactly WINDOW (=2) tiles are "live"
   (pickable) at once. The window is computed CURSORLESS — `live` is just the two
   lowest-index skills in SEQUENCE that aren't cleared THIS cycle. No stored
   cursor to desync if she masters the later live tile first. As she clears
   skills the window slides forward on its own; clearing all 15 advances the
   Season (progress.maybeAdvanceCycle), which re-opens everything.
   ============================================================ */

import * as progress from "./progress.js";
import { SKILLS } from "./skills.js";

/* The spine — foundation-first teaching order. The picker walks this in order. */
export const SEQUENCE = [
  // Tier 1 foundation (round = 5)
  "subitize", "addfacts", "teen",
  // Strategy (round = 7)
  "make10", "bridge", "bonds", "subbond", "doubles", "neardouble",
  // Place-value within 50 (round = 10 — Howard's locked call)
  "plus10", "skip10", "plus9", "addtens", "addones", "more",
];

/* Per-skill round length. Set PER SKILL (not reflexively by tier) so it's easy
   to retune one skill from the parent panel. Defaults to 5. */
const LEN = {
  subitize: 5, addfacts: 5, teen: 5,
  make10: 7, bridge: 7, bonds: 7, subbond: 7, doubles: 7, neardouble: 7,
  plus10: 10, skip10: 10, plus9: 10, addtens: 10, addones: 10,
  more: 5,   // entry-gate level: a quick 5-question number-sense exercise (Howard, 2026-06-28)
};
export function roundLength(id) { return LEN[id] || 5; }

export const WINDOW = 2;   // how many tiles are "live" (pickable) at once

/* The ≤2 lowest-index skills not yet cleared this cycle. Cursorless: derived
   purely from progress, so mastering the later live tile first still slides the
   window correctly. */
export function liveIds() {
  const live = [];
  for (const id of SEQUENCE) {
    if (!progress.isClearedThisCycle(id)) {
      live.push(id);
      if (live.length === WINDOW) break;
    }
  }
  return live;
}

/* State of ONE tile this cycle: 'mastered' | 'live' | 'locked'. */
export function tileState(id) {
  if (progress.isClearedThisCycle(id)) return "mastered";
  return liveIds().includes(id) ? "live" : "locked";
}

/* The whole board, in spine order, for the renderer.
   `level: "E"` drives the E·M·H teaser pips — only E is real in Phase A; M/H are
   ghosted (the deferred difficulty escalator). */
export function board() {
  const live = new Set(liveIds());
  return SEQUENCE.map((id) => ({
    id,
    label: SKILLS[id] ? SKILLS[id].label : id,
    len: roundLength(id),
    level: "E",
    state: progress.isClearedThisCycle(id) ? "mastered" : (live.has(id) ? "live" : "locked"),
  }));
}

/* Has the whole Season been cleared (all 15 mastered this cycle)? */
export function seasonComplete() { return SEQUENCE.every((id) => progress.isClearedThisCycle(id)); }

/* Call after a mastery: if the Season is complete, advance it (re-opens all
   skills; coins + avatar persist). Returns the new cycle number, or null. */
export function advanceIfComplete() { return progress.maybeAdvanceCycle(SEQUENCE); }

/* ------------------------------------------------------------
   Headless gate test — run in node, or via the app's ?debug hook:
     node --input-type=module -e "import('./js/curriculum.js').then(m=>process.exit(m.runGateTest()?0:1))"
   Asserts cold-start, the window sliding GAPLESSLY regardless of master order,
   Season completion + advance, and the per-cycle reset (a rusty pass must NOT
   re-master from stale flags after a Season advance — the W2.2 regression).
   ------------------------------------------------------------ */
export function runGateTest() {
  let ok = true;
  const out = [];
  const assert = (name, cond) => { if (!cond) ok = false; out.push((cond ? "ok   " : "FAIL ") + name); };
  const idx = (id) => SEQUENCE.indexOf(id);
  const clear = (id) => {                       // master a skill = 2 perfect rounds
    const flags = Array(roundLength(id)).fill(1);
    progress.finishRound({ skillId: id, cleanFlags: flags });
    progress.finishRound({ skillId: id, cleanFlags: flags });
  };

  // every SEQUENCE id must be a real skill
  assert("every spine id exists in SKILLS", SEQUENCE.every((id) => !!SKILLS[id]));
  assert("spine has 15 skills", SEQUENCE.length === 15);

  // 1) cold start
  progress.wipe();
  let b = board();
  assert("cold: first two live", b[0].state === "live" && b[1].state === "live");
  assert("cold: third locked", b[2].state === "locked");
  assert("cold: none mastered", b.every((t) => t.state !== "mastered"));
  assert("cold: live = subitize+addfacts", liveIds().join() === "subitize,addfacts");

  // 2) master the SECOND live tile first → window slides gaplessly
  progress.wipe();
  clear("addfacts");                            // index 1 (the 2nd live)
  assert("addfacts now mastered", tileState("addfacts") === "mastered");
  assert("window slid to subitize+teen", liveIds().join() === "subitize,teen");
  const lockedIdx = board().filter((t) => t.state === "locked").map((t) => idx(t.id));
  const liveIdx = liveIds().map(idx);
  assert("no locked tile precedes a live tile", Math.min(...lockedIdx) > Math.max(...liveIdx));

  // 3) clear the whole Season → completes, advances, resets to cold start
  progress.wipe();
  for (const id of SEQUENCE) clear(id);
  assert("season complete after all 15", seasonComplete());
  assert("advance returns cycle 2", advanceIfComplete() === 2);
  assert("cycle now 2", progress.getCycle() === 2);
  assert("post-advance back to cold start", liveIds().join() === "subitize,addfacts");
  assert("post-advance none mastered", board().every((t) => t.state !== "mastered"));

  // 4) REGRESSION (W2.2): after advance, a rusty 0.6 pass must NOT re-master
  const rusty = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0];  // 6/10 on a 10-problem skill
  progress.finishRound({ skillId: "more", cleanFlags: rusty });
  progress.finishRound({ skillId: "more", cleanFlags: rusty });
  assert("rusty 0.6 does NOT re-master post-advance", progress.isClearedThisCycle("more") === false);

  out.forEach((l) => console.log(l));
  console.log(ok ? "✅ curriculum gate-test passed" : "❌ curriculum gate-test FAILED");
  return ok;
}
