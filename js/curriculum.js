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
  // Strategy (round = 7; subfacts is a round-5 mental drill placed by fact-family, see LEN)
  "make10", "bridge", "bonds", "subbond", "subfacts", "doubles", "neardouble",
  // Place-value within 50 (round = 10 — Howard's locked call)
  "plus10", "minus10", "skip10", "plus9", "addtens", "subtens", "addones", "more",
];

/* Per-skill round length. Set PER SKILL (not reflexively by tier) so it's easy
   to retune one skill from the parent panel. Defaults to 5. */
const LEN = {
  subitize: 5, addfacts: 5, teen: 5,
  make10: 7, bridge: 7, bonds: 7, subbond: 7, subfacts: 5, doubles: 7, neardouble: 7,
  plus10: 10, minus10: 10, skip10: 10, plus9: 10, addtens: 10, subtens: 10, addones: 10,
  more: 5,   // entry-gate level: a quick 5-question number-sense exercise (Howard, 2026-06-28)
};
// subfacts: 5 — a mental take-away fluency drill (mirrors addfacts), kept short though it
// lives among the round-7 strategy skills by fact-family placement.
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

/* ------------------------------------------------------------
   CHAPTERS — the avatar/reward loop fires per CHAPTER, not per whole-spine Season.
   A chapter is a contiguous slice of SEQUENCE; sizes 3/7/4/4 (Howard, 2026-06-28) give a
   fast 3-skill first win, then tighter payoffs through the harder place-value back half.
   Defined as SLICES so SEQUENCE stays the single source of teaching order (no duplicated id
   lists to drift). Completion is DERIVED from the per-skill cleared flags — cursorless, like
   liveIds()/seasonComplete() — so there's no new persisted chapter state, and the 2-wide
   picker already forces in-order clearing, so chapters complete as the window passes them.
   ------------------------------------------------------------ */
const CHAPTER_DEFS = [
  // `part`/`icon` = the avatar piece this chapter earns (named in the reward subtitle + the
  // SVG add-on in app.js renderAvatar). part is plain (it's spoken too); icon is screen-only.
  { title: "Foundations", size: 3, part: "Star Clip",  icon: "⭐" },   // subitize, addfacts, teen
  { title: "Strategies",  size: 7, part: "Cape",       icon: "🦸" },   // make10, bridge, bonds, subbond, subfacts, doubles, neardouble
  { title: "Chart Moves", size: 4, part: "Crown",      icon: "👑" },   // plus10, minus10, skip10, plus9
  { title: "Tens & Ones", size: 4, part: "Magic Wand", icon: "🪄" },   // addtens, subtens, addones, more
];

export const CHAPTERS = (() => {
  const out = [];
  let start = 0;
  for (let i = 0; i < CHAPTER_DEFS.length; i++) {
    const def = CHAPTER_DEFS[i];
    out.push({ id: i + 1, title: def.title, part: def.part, icon: def.icon, skills: SEQUENCE.slice(start, start + def.size) });
    start += def.size;
  }
  return out;
})();

/* Which chapter a skill belongs to (or null). */
export function chapterFor(skillId) {
  return CHAPTERS.find((ch) => ch.skills.includes(skillId)) || null;
}

/* Has every skill in this chapter been cleared THIS cycle? (Derived; fires the avatar-part
   payoff in app.js — see the chapter grant.) */
export function chapterComplete(chapterId) {
  const ch = CHAPTERS.find((c) => c.id === chapterId);
  return !!ch && ch.skills.every((id) => progress.isClearedThisCycle(id));
}

/* {done,total} cleared in a chapter — drives the board's "Chapter N · x/y" progress bar. */
export function chapterProgress(chapterId) {
  const ch = CHAPTERS.find((c) => c.id === chapterId);
  if (!ch) return { done: 0, total: 0 };
  return { done: ch.skills.filter((id) => progress.isClearedThisCycle(id)).length, total: ch.skills.length };
}

/* The chapter the player is currently working in: the one holding the first live tile.
   When the whole Season is cleared there are no live tiles, so fall back to the last. */
export function activeChapter() {
  const live = liveIds();
  return live.length ? chapterFor(live[0]) : CHAPTERS[CHAPTERS.length - 1];
}

/* The whole board, in spine order, for the renderer. Each tile carries its chapter so the
   renderer can group tiles and show the active chapter's progress.
   `level: "E"` drives the E·M·H teaser pips — only E is real today; M/H are ghosted. */
export function board() {
  const live = new Set(liveIds());
  return SEQUENCE.map((id) => {
    const ch = chapterFor(id);
    return {
      id,
      label: SKILLS[id] ? SKILLS[id].label : id,
      len: roundLength(id),
      level: "E",
      chapterId: ch ? ch.id : 0,
      chapterTitle: ch ? ch.title : "",
      state: progress.isClearedThisCycle(id) ? "mastered" : (live.has(id) ? "live" : "locked"),
    };
  });
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

  // every SEQUENCE id must be a real skill, and the spine and the round-length table agree
  assert("every spine id exists in SKILLS", SEQUENCE.every((id) => !!SKILLS[id]));
  assert("spine length matches LEN table", SEQUENCE.length === Object.keys(LEN).length);
  assert("every spine id has a round length", SEQUENCE.every((id) => id in LEN));

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
  assert("season complete after all skills cleared", seasonComplete());
  assert("advance returns cycle 2", advanceIfComplete() === 2);
  assert("cycle now 2", progress.getCycle() === 2);
  assert("post-advance back to cold start", liveIds().join() === "subitize,addfacts");
  assert("post-advance none mastered", board().every((t) => t.state !== "mastered"));

  // 4) REGRESSION (W2.2): after advance, a rusty 0.6 pass must NOT re-master
  const rusty = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0];  // 6/10 on a 10-problem skill
  progress.finishRound({ skillId: "more", cleanFlags: rusty });
  progress.finishRound({ skillId: "more", cleanFlags: rusty });
  assert("rusty 0.6 does NOT re-master post-advance", progress.isClearedThisCycle("more") === false);

  // 5) CHAPTERS partition the spine; completion is DERIVED from the cleared flags
  progress.wipe();
  assert("chapters cover the whole spine", CHAPTERS.reduce((n, c) => n + c.skills.length, 0) === SEQUENCE.length);
  assert("every skill is in exactly one chapter",
    SEQUENCE.every((id) => CHAPTERS.filter((c) => c.skills.includes(id)).length === 1));
  assert("chapter sizes are 3/7/4/4", CHAPTERS.map((c) => c.skills.length).join() === "3,7,4,4");
  assert("cold: no chapter complete", CHAPTERS.every((c) => !chapterComplete(c.id)));
  assert("cold: active chapter is Ch1", activeChapter() && activeChapter().id === 1);
  for (const id of CHAPTERS[0].skills) clear(id);          // clear all of chapter 1
  assert("Ch1 complete after its skills cleared", chapterComplete(1));
  assert("Ch2 still incomplete", !chapterComplete(2));
  assert("Ch1 progress reads 3/3", chapterProgress(1).done === 3 && chapterProgress(1).total === 3);
  assert("active chapter advanced to Ch2", activeChapter() && activeChapter().id === 2);
  for (const id of SEQUENCE) clear(id);                    // clear the rest of the Season
  assert("all chapters complete at Season end", CHAPTERS.every((c) => chapterComplete(c.id)) && seasonComplete());

  // 6) schema reservations (world pointer, parent level-cap hatch, idempotent chapter grant)
  progress.wipe();
  assert("world defaults to 1", progress.getWorld() === 1);
  assert("effectiveCycle is identity with no cap", progress.effectiveCycle("addfacts", 3) === 3);
  progress.setParentLevelCap("addfacts", 2);
  assert("effectiveCycle clamps to the parent cap", progress.effectiveCycle("addfacts", 3) === 2);
  assert("effectiveCycle below the cap is unchanged", progress.effectiveCycle("addfacts", 1) === 1);
  progress.setParentLevelCap("addfacts", null);
  assert("clearing the cap restores identity", progress.effectiveCycle("addfacts", 3) === 3);
  const g1 = progress.grantChapterPart(1), g2 = progress.grantChapterPart(1);
  assert("chapter part granted exactly once", g1.granted === true && g2.granted === false);
  assert("chapter part is owned after grant", progress.hasChapterPart(1));

  // 7) shop: purchase deducts coins, is idempotent, gates on balance; equip toggles
  progress.wipe();
  progress.finishRound({ skillId: "subitize", cleanFlags: [1, 1, 1, 1, 1] });   // earn some coins
  const before = progress.getCoins();
  const buy = progress.purchase("bow", 5);
  assert("purchase deducts coins + marks owned", buy.ok && progress.isOwned("bow") && progress.getCoins() === before - 5);
  assert("re-purchase is a no-op", progress.purchase("bow", 5).ok === false);
  assert("cannot afford → no purchase", progress.purchase("dear", 9_999_999).ok === false && !progress.isOwned("dear"));
  progress.toggleEquip("bow");
  assert("toggleEquip wears an owned item", progress.isEquipped("bow"));
  progress.toggleEquip("bow");
  assert("toggleEquip again takes it off", progress.isEquipped("bow") === false);
  assert("cannot equip an unowned item", progress.toggleEquip("ghost") === false && !progress.isEquipped("ghost"));
  assert("setEquipped(true) wears an owned item", progress.setEquipped("bow", true) === true && progress.isEquipped("bow"));
  assert("setEquipped(false) removes it", progress.setEquipped("bow", false) === false && progress.isEquipped("bow") === false);
  assert("setEquipped(true) on unowned is refused", progress.setEquipped("ghost", true) === false && !progress.isEquipped("ghost"));

  out.forEach((l) => console.log(l));
  console.log(ok ? "✅ curriculum gate-test passed" : "❌ curriculum gate-test FAILED");
  return ok;
}
