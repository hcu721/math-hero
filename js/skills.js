/* ============================================================
   skills.js — skill definitions + problem generators.

   Each skill is a small object:
     { id, label, speak, explain, win, generate(), example(), check() }
   and generate()/example() return one problem:
     { prompt, spoken, answer, choices[3], visual, mode? }
   where `visual` is a DESCRIPTOR that visuals.js interprets (skills
   never draw), and `mode:'flash'` asks app.js to flash-then-hide the
   visual (subitizing) instead of showing it the whole time.

   Tiers (teaching order). Build order differs — see the plan.
     T1 subitize · T2 make10 / bridge · T3 bonds · T4 doubles / neardouble
     · T5 plus10
   ============================================================ */

/* inclusive random integer in [min, max] */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* Pick randInt(lo,hi) but never repeat the LAST pick for this `key`, so two problems in a
   row don't reuse the same number (doubles/neardouble/teen). app.js builds all 5 problems
   up front via independent generate() calls, so we remember the last pick module-side here.
   The `hi > lo` guard means a single-value range just returns it (no infinite loop). */
const _lastPick = {};
function pickNoRepeat(key, lo, hi) {
  let v;
  do { v = randInt(lo, hi); } while (hi > lo && v === _lastPick[key]);
  _lastPick[key] = v;
  return v;
}

/* Weighted random choice: pick one item from `items`, where weightFn(item) is its
   relative likelihood. Used to thin out the too-easy small addends below. */
function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += weightFn(it);
  let r = Math.random() * total;
  for (const it of items) { if ((r -= weightFn(it)) < 0) return it; }
  return items[items.length - 1];
}

/* Weight that makes small values (<= `small`) RARER: a small value gets weight 1, the
   rest get `bias` (default 3x). Thins the too-easy 1s and 2s without removing them
   (subitize / addfacts / addones — Howard, post-trial-1). */
function lessSmall(x, small = 2, bias = 3) { return x <= small ? 1 : bias; }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Build exactly 3 choices: the answer + 2 plausible distractors.
   `candidates` are mistake-shaped wrong answers; we keep only those
   in [lo,hi], distinct, and != answer, then pad if we came up short. */
function pickChoices(answer, candidates, lo, hi) {
  const distractors = [];
  for (const c of shuffle(candidates)) {
    if (distractors.length === 2) break;
    if (Number.isInteger(c) && c >= lo && c <= hi && c !== answer && !distractors.includes(c)) {
      distractors.push(c);
    }
  }
  let pad = 1;
  while (distractors.length < 2) {
    for (const c of [answer + pad, answer - pad]) {
      if (distractors.length === 2) break;
      if (c >= lo && c <= hi && c !== answer && !distractors.includes(c)) distractors.push(c);
    }
    pad++;
  }
  return shuffle([answer, ...distractors]);
}

/* Build the SOLVED equation shown on a CORRECT answer: swap the "?" for the
   answer, coloured green (.t-sum). The "?" is either a bare token ("= ?") or the
   green "added" slot in missing-part skills (make10/bonds); both become .t-sum. */
function solve(promptHtml, answer) {
  const sum = `<span class="t-sum">${answer}</span>`;
  return promptHtml.includes('class="t-add">?</span>')
    ? promptHtml.replace('<span class="t-add">?</span>', sum)
    : promptHtml.replace("?", sum);
}

/* Spoken cues for number bonds. These take the part + whole, so they're
   functions. Counting-up phrasing; the bond DIAGRAM carries the part-whole
   idea. One is picked per problem. */
const BONDS_LINES = [
  (part, whole) => `${part} and how many more to make ${whole}?`,
  (part, whole) => `A group of ${part} and a group of how many make ${whole}?`,
  (part, whole) => `${part} and what makes ${whole}?`,
];

/* Spoken cues for doubles (same number twice). */
const DOUBLES_LINES = [
  (a) => `${a} plus ${a}. It is a double.`,
  (a) => `Double ${a}. How many in all?`,
  (a) => `Two groups of ${a}. How many altogether?`,
  (a) => `${a} plus ${a}. Same number twice.`,
];

/* Spoken cues for near-doubles (a + the next number). Some cue the strategy
   the way bridge's spoken cues "fill the ten first." */
const NEARDOUBLE_LINES = [
  (a, b) => `${a} plus ${b}. Almost a double.`,
  (a, b) => `${a} plus ${b}. Double ${a}, then one more.`,
  (a, b) => `Near double. ${a} plus ${b}.`,
  (a, b) => `${a} plus ${b}. Just past the double.`,
];

/* Spoken/shown number names for the teen skill (the names are irregular — eleven and
   twelve give no clue, and "thir/fif-teen" reverse the parts — which is the whole point). */
const TEEN_WORDS = {
  11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen",
  16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
};

/* Spoken cues for "which is more" (tap the biggest of 3). */
const MORE_LINES = [
  "Which one is the biggest?",
  "Tap the biggest number.",
  "Which is the most?",
  "Find the biggest one.",
];

/* Build 3 distinct two-digit numbers (10–49) with a UNIQUE biggest, for `more`. Rolls a
   case type so the HARD, teaching cases dominate: a misleading ones digit (28 vs 34) and
   a tens-tie (31 vs 37), with some easy different-tens problems for the success floor. */
function genCompareTriple() {
  const roll = randInt(1, 100);

  if (roll <= 40) {
    // MISLEADING ONES: winner has a small ones digit; a trap has fewer tens but a bigger
    // ones digit, so comparing ones would pick the wrong number.
    const tW = randInt(2, 4), oW = randInt(0, 4), W = tW * 10 + oW;
    const tT = randInt(1, tW - 1), oT = randInt(oW + 1, 9), T = tT * 10 + oT;
    let D; do { D = randInt(10, W - 1); } while (D === T);   // a third, still below the winner
    return shuffle([W, T, D]);
  }
  if (roll <= 75) {
    // SAME TENS: only the ones decide which is biggest.
    const t = randInt(1, 4);
    const ones = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3);
    return shuffle(ones.map((o) => t * 10 + o));
  }
  // DIFFERENT TENS (floor): distinct tens => the biggest tens is the biggest number.
  const tens = shuffle([1, 2, 3, 4]).slice(0, 3);
  return shuffle(tens.map((t) => t * 10 + randInt(0, 9)));
}

export const SKILLS = {
  /* ---- Tier 5: +10 AND +5 on the 50-chart — DOWN vs RIGHT (anti-autopilot) ----
     Mixed 50/50 (Howard, post-trial-1) so she must READ the operation instead of
     reflexively tapping the cell below: +10 = straight DOWN a row (bump the tens), +5 =
     RIGHT 5 in the same row. +5 is restricted to ones-digit 1–5 so it never wraps a row
     (clean cases only); the direction-aware revealJump draws either arrow, no new code. */
  plus10: {
    id: "plus10",
    label: "Plus 10 & 5",
    speak: "Plus ten or five",
    explain: "Plus ten jumps straight down a row. Plus five steps right along the row. Read which one it is.",
    win: [
      "You read it and moved right! ⚡",
      "Down for ten, right for five! 🧭",
      "Same ones, one more ten! 👍",
      "You found the pattern! ⭐",
      "You picked the right move! ✅",
    ],
    make(n, add) {
      const answer = n + add;                       // add is 10 (DOWN a row) or 5 (RIGHT, same row)
      const promptHtml = `<span class="t-known">${n}</span> + <span class="t-add">${add}</span> = ?`;
      return {
        prompt: `${n} + ${add} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${n} plus ${add}.`,
        answer,
        // anti-autopilot: the "did the OTHER move" mistake (+10 when it was +5, or vice
        // versa) plus tight near-misses
        choices: pickChoices(answer, [n + (add === 10 ? 5 : 10), answer + 1, answer - 1, answer + 2], 1, 59),
        // revealOnWin: pop the destination cell green on a correct answer
        visual: { type: "chart50", from: n, to: answer, revealOnWin: true },
      };
    },
    generate() {
      if (Math.random() < 0.5) return this.make(randInt(1, 39), 10);   // +10: any n, stays within 50
      // +5: ones digit 1–5 so "right 5" never wraps a row; n+5 stays within 50
      return this.make(randInt(0, 4) * 10 + randInt(1, 5), 5);         // n in {1-5,11-15,21-25,31-35,41-45}
    },
    example() { return this.make(23, 5); },          // 23 + 5 = 28 (RIGHT, same row) — the new move
    check(p) {
      const move = p.visual.to - p.visual.from;
      if (move === 10) return p.answer <= 50;        // +10: straight down
      return move === 5 && p.answer <= 50            // +5: must stay in the same row (no wrap)
        && Math.floor((p.visual.from - 1) / 10) === Math.floor((p.visual.to - 1) / 10);
    },
  },

  /* ---- Tier 5: skip by 10 AND by 5 on the 50-chart (anti-autopilot) ----
     Mixed 50/50 (Howard, post-trial-1): the sequence lives in the prompt; the chart draws
     the FINAL step — DOWN a row for skip-10, RIGHT for skip-5. skip-5 starts on ones 1–5 so
     that final +5 step never wraps a row (off the usual multiples-of-5 track, by design). */
  skip10: {
    id: "skip10",
    label: "Skip by 10 & 5",
    speak: "Skip counting by ten or five",
    explain: "Keep the same jump going. By ten goes straight down. By five steps right. Read the step size.",
    win: [
      "You kept the pattern going! 🔟",
      "Same jump every time! ⭐",
      "You found the next one! ⚡",
      "Skip counting like a pro! 👍",
      "You read the step size! ✅",
    ],
    make(start, step) {
      const t2 = start + step, t3 = start + 2 * step, answer = start + 3 * step;
      const promptHtml = `${start}, ${t2}, <span class="t-known">${t3}</span>, <span class="t-add">?</span>`;
      const other = step === 10 ? 5 : 10;
      return {
        prompt: `${start}, ${t2}, ${t3}, ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${start}, ${t2}, ${t3}. What comes next?`,
        answer,
        // mistakes: used the WRONG step on the last jump (t3+other), repeated the last term
        // (t3), or a near-miss
        choices: pickChoices(answer, [t3 + other, t3, answer + 1, answer - 1], 1, 50),
        visual: { type: "chart50", from: t3, to: answer, revealOnWin: true },
      };
    },
    generate() {
      if (Math.random() < 0.5) return this.make(randInt(1, 20), 10);   // skip-10: start+30 ≤ 50
      // skip-5: start ones 1–5 so the final +5 step stays in-row; start+15 ≤ 50
      return this.make(randInt(0, 3) * 10 + randInt(1, 5), 5);         // start in {1-5,11-15,21-25,31-35}
    },
    example() { return this.make(11, 5); },          // 11, 16, 21, 26 (skip 5; final 21->26 RIGHT)
    check(p) {
      const move = p.visual.to - p.visual.from;
      if (move === 10) return p.answer <= 50;
      return move === 5 && p.answer <= 50
        && Math.floor((p.visual.from - 1) / 10) === Math.floor((p.visual.to - 1) / 10);
    },
  },

  /* ---- Tier 6: +9 AND +11 via compensation (+10, then one step) ----
     Mixed in one skill to teach DIRECTIONAL sense (Howard, post-trial-1): both add ten
     (straight DOWN to the via = n+10 landmark), then take ONE step — +9 steps LEFT (back
     one), +11 steps RIGHT (forward one). The direction-aware revealJump draws either L from
     the same two-phase `via` logic; generate() skips starts where that one step would wrap a
     row. id stays "plus9" (the slot); the label covers both. */
  plus9: {
    id: "plus9",
    label: "Plus 9 & 11",
    speak: "Plus nine or eleven",
    explain: "Add ten, then take one step. For plus nine, step back one. For plus eleven, step forward one.",
    win: [
      "Add ten, then one step! ⚡",
      "You used the plus-ten trick! 🔟",
      "Almost a whole ten, then adjust! ⭐",
      "Ten first, then one step. Nice! 👍",
      "You compensated like a pro! ✨",
    ],
    make(n, add) {
      const answer = n + add;                       // add is 9 (back one / LEFT) or 11 (forward one / RIGHT)
      const promptHtml = `<span class="t-known">${n}</span> + <span class="t-add">${add}</span> = ?`;
      return {
        prompt: `${n} + ${add} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: add === 9
          ? `${n} plus 9. Add ten, then back one.`
          : `${n} plus 11. Add ten, then forward one.`,
        answer,
        // classic mistake: did the +10 but forgot the one-step (= n+10 = the via landmark,
        // which is answer+1 for +9 / answer-1 for +11); plus tight near-misses
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 1, 50),
        visual: { type: "chart50", from: n, to: answer, via: n + 10, revealOnWin: true },
      };
    },
    generate() {
      const add = Math.random() < 0.5 ? 9 : 11;     // mix the two directions for directional sense
      let n;
      if (add === 9) {
        do { n = randInt(2, 40); } while ((n + 9) % 10 === 0);   // skip where "back one" wraps a row
      } else {
        do { n = randInt(2, 39); } while (n % 10 === 0);         // skip where "forward one" wraps (via at a row end)
      }
      return this.make(n, add);
    },
    example() { return this.make(14, 9); },           // 14 + 9 = 23 (down to 24, back to 23) — anchor case
    check(p) {
      const move = p.visual.to - p.visual.from;
      return p.answer === p.visual.to && (move === 9 || move === 11)
        && p.visual.via === p.visual.from + 10 && p.answer <= 50
        // the one step must NOT wrap a row: via and to share a row
        && Math.floor((p.visual.via - 1) / 10) === Math.floor((p.visual.to - 1) / 10);
    },
  },

  /* ---- Tier 6: add a multiple of ten (jump several rows straight down) ---- */
  addtens: {
    id: "addtens",
    label: "Add Tens",
    speak: "Add tens",
    explain: "Break each number into tens and ones. Add the tens together. The ones stay the same.",
    win: [
      "You added the tens! 🔟",
      "Tens together, the ones stay! ⭐",
      "You combined the tens! 👍",
      "Just the tens changed! ✨",
      "Tens plus tens. Nice! ⚡",
    ],
    make(base, tens) {
      const add = tens * 10, answer = base + add;
      const promptHtml = `<span class="t-known">${base}</span> + <span class="t-add">${add}</span> = ?`;
      return {
        prompt: `${base} + ${add} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${base} plus ${add}?`,
        answer,
        // mistakes: one ten too many/few (the signature error), or an ones-slip by one
        choices: pickChoices(answer, [answer + 10, answer - 10, answer + 1, answer - 1], 1, 50),
        // expanded-form place value: tens combine, then ones, with a comet fly-in
        visual: { type: "expand", base, add, revealOnWin: true },
        holdMs: 1100,   // linger on the finished equation so she can read it
      };
    },
    generate() {
      const tens = randInt(2, 3);                    // +20 or +30 (plain +10 is its own skill)
      const baseTens = randInt(1, 4 - tens);         // keep (baseTens + tens) tens + ones within 50
      const base = baseTens * 10 + randInt(1, 9);    // two-digit base with nonzero ones (clean expanded form)
      return this.make(base, tens);
    },
    example() { return this.make(18, 2); },          // 18 + 20 = 38 (the showcase case)
    check(p) {
      const { base, add } = p.visual;
      return p.answer === base + add && add % 10 === 0 && add >= 20
        && base >= 10 && base % 10 !== 0 && p.answer <= 50;
    },
  },

  /* ---- Place-value application: ADD ONES on the 50-chart (move RIGHT, no regroup).
     The perpendicular companion to +10: +10 jumps straight DOWN (bump the tens), addones
     steps RIGHT along the row (grow the ones) — together they are full within-50 navigation.
     This is where the within-10 facts (3 + 5 = 8) finally APPLY inside a bigger number, and
     the chart shows the tens DON'T change. No regroup (ones-sum < 10), so it stays on one
     row; the regrouping case (13 + 8 = 21, crosses a row) is deferred. Reuses chart50 + the
     direction-aware revealJump arrow (it points RIGHT here) — NO new visual. ---- */
  addones: {
    id: "addones",
    label: "Add Ones",
    speak: "Add ones",
    explain: "Adding ones moves you to the right. The tens stay the same. Only the ones grow.",
    win: [
      "You stepped right, tens stayed put! ➡️",
      "Only the ones grew! ⭐",
      "Same tens, more ones! 👍",
      "You added the ones! ✨",
      "Right along the row. Nice! ⚡",
    ],
    make(base, ones) {
      const answer = base + ones;
      const promptHtml = `<span class="t-known">${base}</span> + <span class="t-add">${ones}</span> = ?`;
      return {
        prompt: `${base} + ${ones} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${base} plus ${ones}. Add the ones, step right.`,
        answer,
        // mistakes: went DOWN a row instead of right (+10, the sibling skill — the tricky
        // structural error), or miscounted the rightward steps by one or two. (Dropped the
        // ones-sum "forgot the ten" = 10 below the answer, too easy to rule out by size.)
        choices: pickChoices(answer, [base + 10, answer + 1, answer - 1, answer + 2], 1, 59),
        visual: { type: "chart50", from: base, to: answer, revealOnWin: true },
      };
    },
    generate() {
      const base = randInt(1, 4) * 10 + randInt(1, 8);   // tens 1-4, base ones 1-8 (room to add)
      const maxOnes = 9 - base % 10;                      // ones-sum < 10 => same row, no regroup
      // weight DOWN +1/+2 (Howard: favor bigger, more interesting ones-adds when there's room)
      const ones = weightedPick(Array.from({ length: maxOnes }, (_, i) => i + 1), lessSmall);
      return this.make(base, ones);
    },
    example() { return this.make(13, 5); },              // 13 + 5 = 18 (the showcase: 3 + 5 applied)
    check(p) {
      const { from, to } = p.visual;
      const moved = to - from;
      return p.answer === to && moved >= 1 && moved <= 8
        && Math.floor((from - 1) / 10) === Math.floor((to - 1) / 10)   // same row = no regroup
        && to <= 50;
    },
  },

  /* ---- Number sense: WHICH IS MORE — compare two-digit numbers, tap the biggest.
     NO visual on purpose: the numbers on the BUTTONS are what she compares. (An earlier
     version lit them on the 50-chart, but the chart's reading-order position handed her
     the biggest for free — Howard, 2026-06-21 — which defeated the whole lesson.) The
     teaching rule is place-value: look at the TENS first; more tens wins; tie on tens ->
     bigger ones wins. The generator leans on the HARD cases (a smaller number with a
     bigger ones digit, e.g. 28 vs 34) so she can't win by comparing ones digits. Three
     choices ("tap the biggest") so a guess is 1-in-3, not a coin flip. ---- */
  more: {
    id: "more",
    label: "Which Is More",
    speak: "Which is more",
    explain: "To find the biggest, look at the tens first. More tens means a bigger number. If the tens are the same, the bigger ones digit wins.",
    win: [
      "You checked the tens! 🔟",
      "Biggest one, nailed it! ⭐",
      "More tens, more number! 👍",
      "You compared like a pro! 💡",
      "Tens first, then ones! ✨",
    ],
    make(nums) {
      const answer = Math.max(...nums);
      return {
        prompt: "Which is biggest?",
        spoken: MORE_LINES[Math.floor(Math.random() * MORE_LINES.length)],
        answer,
        choices: shuffle(nums.slice()),     // the 3 numbers ARE the tappable options
        solvedHtml: `<span class="t-sum">${answer}</span> is the biggest!`,
        holdMs: 800,
        // no `visual` — the buttons carry the numbers; comparing them is the skill
      };
    },
    generate() { return this.make(genCompareTriple()); },
    example() { return this.make([34, 28, 19]); },   // 34 wins though 28 has the bigger ones digit
    check(p) {
      const c = p.choices;                            // the choices ARE the numbers (no visual)
      return Array.isArray(c) && c.length === 3 && new Set(c).size === 3
        && p.answer === Math.max(...c)
        && c.filter((n) => n === p.answer).length === 1     // a single, unambiguous biggest
        && c.every((n) => n >= 10 && n <= 49);
    },
  },

  /* ---- Place value: TEEN numbers — "Beat the Flip" (hear the name, pick the numeral).
     The real teen trap for a struggling/ADHD learner is NOT "10 and 3" (that is just
     adding) — it is the WRITTEN form: "thir-teen" sounds like three-ten, so kids write
     31; and the leading 1 secretly means a whole ten. So this skill SAYS the name and
     shows the quantity (a full ten drawn as ONE unit + loose ones), and she taps the
     correct NUMERAL. The reversal (31) is offered EVERY time as the trap; the win-reveal
     pops the "1" over the ten and the ones-digit over the ones, left-to-right = why the
     ten is written first. Single-step on purpose (the old two-part counting step was a
     freebie). Redesigned 2026-06-21 after the original "10 + 3 = ?" version tested too
     easy / unengaging — it was rehearsing addition, not place value. ---- */
  teen: {
    id: "teen",
    label: "Teen Numbers",
    speak: "Teen numbers",
    explain: "Write the ten first, so a teen number starts with one. The last digit tells the ones. Thirteen is one ten and three ones.",
    win: [
      "Ten first, then the ones! 🔟",
      "You wrote it the right way round! ✅",
      "You beat the flip! 🔁",
      "The one means a whole ten! ⭐",
      "Right digits, right order! 💡",
    ],
    make(ones) {
      const answer = 10 + ones;                 // the teen number, 11..19
      const word = TEEN_WORDS[answer];
      const Word = word[0].toUpperCase() + word.slice(1);
      const reversal = ones * 10 + 1;           // 13 -> 31: the classic digit flip (the trap)
      const decade = ones * 10;                 // 13 -> 30: the "-teen vs -ty" confusion
      const inRange = (n) => Number.isInteger(n) && n >= 10 && n <= 99;

      // 3 choices: the answer + the reversal trap (always, when valid) + one varied second
      // distractor, so she can't win by always tapping the smallest number.
      const choices = [answer];
      if (inRange(reversal) && reversal !== answer) choices.push(reversal);
      for (const c of shuffle([decade, answer - 1, answer + 1, decade + 1])) {
        if (choices.length === 3) break;
        if (inRange(c) && !choices.includes(c)) choices.push(c);
      }

      return {
        prompt: Word,                           // the NAME is the thing to translate to digits
        answer,
        solvedHtml: `${Word} = <span class="t-sum">${answer}</span>`,   // "Thirteen = 13" on the win
        spoken: `${Word}. Which number is it?`,
        choices: shuffle(choices),
        // visual draws the ten as a UNIT + loose ones; reveal pops the digits into place
        visual: { type: "teen", ones, revealOnWin: true },
        holdMs: 1200,                           // linger so she reads the 1-over-ten / ones reveal
      };
    },
    generate() { return this.make(pickNoRepeat("teen", 1, 9)); },   // ones 1..9 -> teens 11..19, no immediate repeat
    example() { return this.make(3); },                // thirteen (the showcase flip case)
    check(p) {
      const { ones } = p.visual;
      const answer = 10 + ones;
      return p.answer === answer && ones >= 1 && ones <= 9 && answer >= 11 && answer <= 19
        && (ones < 2 || p.choices.includes(ones * 10 + 1));   // the reversal trap is always offered
    },
  },

  /* ---- Tier 1: group addition — TWO-PART (name each ten-frame, THEN total), within 10.
     Conceptual subitizing: recognise each quantity FIRST (1–9 via the five-structure),
     then add — so she can't shortcut to a make-ten fill without naming the parts. Frames
     stay visible (guided, no flash). Drills the within-10 facts make10 / bridge / bonds
     build on. Ten-frames (not dice) so near-ten addends 7/8/9 show as a single graphic. ---- */
  subitize: {
    id: "subitize",
    label: "Quick Add",
    speak: "Quick add",
    explain: "See each group, then add them. You do not need to count every dot.",
    // a pool (string or array) — one is picked per win, for variety
    win: [
      "You added them up! 🙌",
      "Two groups, one answer! ⭐",
      "You saw both and added! 👀",
      "Quick adding, no counting! ⚡",
      "You put them together! ✨",
      "Added in a snap! 💥",
    ],
    make(a, b) {
      const total = a + b;
      // tough distractors everywhere: off by one or two only (no obviously-wrong values)
      const opts = (n) => pickChoices(n, [n - 1, n + 1, n - 2, n + 2], 1, 12);
      // the total step shows the EQUATION she just built ("6 + 4 = ?"), colour-coded to
      // the frames (yellow = left, green = right); it resolves to the answer on the win
      const eqHtml = `<span class="t-known">${a}</span> + <span class="t-add">${b}</span> = ?`;
      return {
        prompt: `${a} + ${b} = ?`,         // top-level (used by the worked-example demo)
        promptHtml: eqHtml,
        answer: total,
        solvedHtml: solve(eqHtml, total),  // "6 + 4 = 10" on the final correct
        visual: { type: "twoframes", a, b, revealOnWin: true },
        holdMs: 1500,           // linger on the finished equation
        flashMs: 1800,          // one frame at a time (other dimmed) reads fast — back to the original
        reflashMs: 2600,        // a wrong identify re-flashes a bit longer for another look
        // two-part: FLASH-recognise each frame (steps 1–2, dimming the other so she reads
        // just one), THEN hold both frames visible for the equation total (step 3).
        steps: [
          { prompt: "How many on the left?",  spoken: "How many on the left?",  emphasize: "left",  flash: true, answer: a,     choices: opts(a) },
          { prompt: "How many on the right?", spoken: "How many on the right?", emphasize: "right", flash: true, answer: b,     choices: opts(b) },
          { prompt: `${a} + ${b} = ?`, promptHtml: eqHtml, spoken: `${a} plus ${b}?`, emphasize: "both", answer: total, choices: opts(total) },
        ],
      };
    },
    generate() {
      // all addend pairs within 10; weight DOWN pairs with a 1 or 2 (too-easy small groups)
      const pairs = [];
      for (let a = 1; a <= 9; a++)
        for (let b = 1; b <= 9; b++)
          if (a + b <= 10) pairs.push([a, b]);
      const [a, b] = weightedPick(pairs, ([x, y]) => lessSmall(x) * lessSmall(y));
      return this.make(a, b);
    },
    example() { return this.make(7, 3); },           // 7 + 3 = 10 (shows a 7 — dice couldn't)
    check(p) {
      const { a, b } = p.visual;
      return a + b === p.answer && p.answer <= 10 && a >= 1 && b >= 1 && a <= 9 && b <= 9;
    },
  },

  /* ---- Tier 1 (fluency): within-10 addition FACTS, pure mental — NO visual.
     The scaffold-faded top rung above Quick Add: just the equation, add it in your
     head. Same fact space (addends 1–9, sum ≤ 10); the off-by-1/2 distractors keep
     it honest. No dots, no flash — true mental math. ---- */
  addfacts: {
    id: "addfacts",
    label: "Number Facts",
    speak: "Number facts",
    explain: "Add them in your head. You know these ones.",
    win: [
      "Quick math! ⚡",
      "You just knew it! 🧠",
      "Fast adding! ⭐",
      "Straight from your head! 🙌",
      "Number fact, nailed it! ✨",
    ],
    make(a, b) {
      const total = a + b;
      const promptHtml = `<span class="t-known">${a}</span> + <span class="t-add">${b}</span> = ?`;
      return {
        prompt: `${a} + ${b} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, total),   // "6 + 4 = 10" on the win
        spoken: `${a} plus ${b}?`,
        a, b,                                    // for the self-test invariant (no visual to read)
        answer: total,
        choices: pickChoices(total, [total - 1, total + 1, total - 2, total + 2], 1, 12),
        holdMs: 600,                            // brief dwell to read the solved equation
        mode: "flash",                          // FLASH the equation, then hide it — answer from memory
        flashMs: 1800,                          // shows "6 + 4 = ?" briefly, then hides it
        reflashMs: 2600,                        // a wrong answer re-flashes for another look
        // no `visual` — pure mental math; the EQUATION itself is the flashed thing
      };
    },
    generate() {
      // facts with sum 6–10 only (Howard: skip sums < 6), and weight DOWN pairs with a 1
      // or 2 so the too-easy little addends are rarer
      const pairs = [];
      for (let a = 1; a <= 9; a++)
        for (let b = 1; b <= 9; b++)
          if (a + b >= 6 && a + b <= 10) pairs.push([a, b]);
      const [a, b] = weightedPick(pairs, ([x, y]) => lessSmall(x) * lessSmall(y));
      return this.make(a, b);
    },
    example() { return this.make(6, 4); },          // 6 + 4 = 10
    check(p) { return p.a + p.b === p.answer && p.a >= 1 && p.b >= 1 && p.answer >= 6 && p.answer <= 10; },
  },

  /* ---- Tier 2a: making 10 (bonds to ten) — FLASH the ten-frame so she RECALLS the
     partner to ten, not counts the open cells (Howard, post-trial-1) ---- */
  make10: {
    id: "make10",
    label: "Make 10",
    speak: "Make ten",
    explain: "Remember the partners that make ten. How many more makes ten?",
    win: [
      "You filled the ten! 🔟",
      "Ten complete! 🙌",
      "Perfect fill! ⭐",
      "That makes ten. Nice! 👍",
      "You found the missing part! ✨",
    ],
    make(a) {
      const answer = 10 - a;
      const promptHtml = `<span class="t-known">${a}</span> + <span class="t-add">?</span> = 10`;
      return {
        prompt: `${a} + ? = 10`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${a} plus what makes ten?`,
        answer,
        // mistakes: miscount the gap by one or two — all plausible counts, tighter than
        // offering the shown number `a` (which she rules out at a glance)
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 0, 10),
        // revealOnWin: animate the gap filling up to ten on a correct answer
        visual: { type: "tenframe", filled: a, goal: 10, revealOnWin: true },
        // FLASH the frame then hide it, so she RECALLS the partner to ten instead of
        // counting the open cells; a wrong tap re-flashes for another look
        mode: "flash",
        flashMs: 1800,
        reflashMs: 2600,
        holdMs: 600,        // brief dwell to read the solved 7 + 3 = 10
      };
    },
    generate() { return this.make(randInt(1, 9)); },
    example() { return this.make(7); },
    check(p) { return p.visual.filled + p.answer === p.visual.goal; },
  },

  /* ---- Tier 2b: bridging through 10 (8 + 5 = fill the ten, then 3) ---- */
  bridge: {
    id: "bridge",
    label: "Bridge 10",
    speak: "Bridge ten",
    explain: "Fill the ten first, then add what's left over.",
    win: [
      "You filled the ten, then added the rest! 🌉",
      "Over the bridge! 🌉",
      "Ten first, then the rest. Smart! 🧠",
      "Nice bridge to the next ten! ⭐",
      "You split it into ten and a bit! 👏",
    ],
    make(a, b) {
      const answer = a + b;
      const promptHtml = `<span class="t-known">${a}</span> + <span class="t-add">${b}</span> = ?`;
      return {
        prompt: `${a} + ${b} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: `${a} plus ${b}. Fill the ten first.`,
        answer,
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 11, 20),
        // revealOnWin: animate the "fill the ten, then spill over" completion on a correct answer
        visual: { type: "bridge", a, b, revealOnWin: true },
      };
    },
    generate() {
      const a = randInt(6, 9);
      const b = randInt(Math.max(2, 11 - a), 9);   // guarantees a + b > 10 (a real bridge)
      return this.make(a, b);
    },
    example() { return this.make(8, 5); },
    check(p) {
      const { a, b } = p.visual;
      return a + b === p.answer && p.answer > 10 && p.answer <= 18;
    },
  },

  /* ---- Tier 3: number bonds (decompose a whole into two parts) ----
     Recognition-supported: the bond diagram shows the WHOLE as a numeral
     and the known PART as dots; she finds the missing part. This is the
     part-whole idea that make10/bridge lean on (8 is 5 and 3). Expanded to
     wholes 5–18 (Howard, post-trial-1) to parse bigger numbers — but BOTH parts
     stay <= 9 (a teen splits into two single digits, 15 = 7 + 8), so the dots stay
     subitizable and it reinforces the bridging facts instead of needing a new
     big-number rendering. */
  bonds: {
    id: "bonds",
    label: "Number Bonds",
    speak: "Number bonds",
    explain: "Break the number into two parts. One part is here. Find the other part.",
    win: [
      "You found the missing part! 🧩",
      "Part and part make the whole! ⭐",
      "You completed the bond! 🔗",
      "Split into two parts. Nice! ✂️",
      "That fills the whole. Great! 👍",
    ],
    make(whole, part) {
      const answer = whole - part;
      const promptHtml = `${whole} = <span class="t-known">${part}</span> + <span class="t-add">?</span>`;
      return {
        prompt: `${whole} = ${part} + ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: BONDS_LINES[Math.floor(Math.random() * BONDS_LINES.length)](part, whole),
        answer,
        // mistakes: miscount the complement by one or two — tighter than offering the
        // shown part or the whole (both easy to rule out at a glance)
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 0, whole),
        // revealOnWin: pop the missing part's dots into the empty circle
        visual: { type: "bond", whole, part, revealOnWin: true },
      };
    },
    generate() {
      const whole = randInt(5, 18);                 // 5–10 plus the teens, to parse bigger numbers
      // keep BOTH parts <= 9 (dots stay subitizable): part in [whole-9, whole-1] ∩ [1, 9]
      const part = randInt(Math.max(1, whole - 9), Math.min(9, whole - 1));
      return this.make(whole, part);
    },
    example() { return this.make(15, 7); },          // a teen bond, 15 = 7 + 8 (shows the new range)
    check(p) {
      const { whole, part } = p.visual;
      return part + p.answer === whole && whole >= 5 && whole <= 18
        && part >= 1 && part <= 9 && p.answer >= 1 && p.answer <= 9;   // both parts subitizable
    },
  },

  /* ---- Subtraction (fact family): TAKE AWAY on the number bond ----
     The inverse of `bonds`, on the SAME diagram: the whole splits into two parts; take away
     the part you see, find the other. `8 - 3 = 5` is the same bond as `5 + 3 = 8` — teaching
     them together is what makes subtraction click. Reuses the `bond` visual (whole as
     numeral, known part as yellow dots, the remaining part fills green on a win). Within 10
     (new operation = start easy). FIRST subtraction skill; the rest of the sub track waits
     until addition is fluent (Howard, 2026-06-21 — reverses the earlier "defer ALL
     subtraction" lock, on purpose, for fact-family practice alongside addition). ---- */
  subbond: {
    id: "subbond",
    label: "Take Away",
    speak: "Take away",
    explain: "The whole splits into two parts. Take away the part you see. What is left is the answer.",
    win: [
      "You found what's left! ✂️",
      "Took the part away! ⭐",
      "The other part, nailed it! 🧩",
      "Whole take away a part! 👍",
      "You undid the bond! 🔗",
    ],
    make(whole, part) {
      const answer = whole - part;
      const promptHtml = `${whole} - <span class="t-known">${part}</span> = <span class="t-add">?</span>`;
      return {
        prompt: `${whole} - ${part} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),       // "8 - 3 = 5" on the win
        spoken: `${whole} take away ${part}. How many are left?`,
        answer,
        // mistakes: miscount what's left by one or two (tight near-misses, like bonds)
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 0, whole),
        // same bond diagram as `bonds`: known part yellow, the remaining part fills green on a win
        visual: { type: "bond", whole, part, revealOnWin: true },
      };
    },
    generate() {
      const whole = randInt(5, 10);                  // within 10 (new operation, start easy)
      return this.make(whole, randInt(1, whole - 1));
    },
    example() { return this.make(8, 3); },           // 8 - 3 = 5 (the fact-family pair of bonds' 8 = 5 + 3)
    check(p) {
      const { whole, part } = p.visual;
      return part + p.answer === whole && whole >= 5 && whole <= 10
        && part >= 1 && part <= 9 && p.answer >= 1 && p.answer <= 9;
    },
  },

  /* ---- Tier 4a: doubles (same number twice) ---- */
  doubles: {
    id: "doubles",
    label: "Doubles",
    speak: "Doubles",
    explain: "A double is the same number twice. Count one group, then it is two of them.",
    win: [
      "You doubled it! 💪",
      "Same number twice. Yes! ✌️",
      "Two equal groups! ⭐",
      "Double trouble, you got it! 🎯",
      "Twins! Nice doubling. 👯",
    ],
    make(a) {
      const answer = a + a;
      const promptHtml = `<span class="t-known">${a}</span> + <span class="t-add">${a}</span> = ?`;
      return {
        prompt: `${a} + ${a} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: DOUBLES_LINES[Math.floor(Math.random() * DOUBLES_LINES.length)](a),
        answer,
        // mistakes: off-by-one / two on either side (miscount one of the groups)
        choices: pickChoices(answer, [answer + 1, answer - 1, answer + 2, answer - 2], 2, 20),
        // both frames are shown filled; reveal pulses them to celebrate the match
        visual: { type: "pairframe", a, b: a, revealOnWin: true },
      };
    },
    generate() { return this.make(pickNoRepeat("doubles", 2, 10)); },   // 2+2 .. 10+10, no immediate repeat
    example() { return this.make(6); },
    check(p) { return p.visual.a === p.visual.b && p.visual.a + p.visual.b === p.answer; },
  },

  /* ---- Tier 4b: near-doubles (double the smaller, then add one) ---- */
  neardouble: {
    id: "neardouble",
    label: "Near Doubles",
    speak: "Near doubles",
    explain: "This is almost a double. Double the smaller number, then add one more.",
    win: [
      "Double it, then one more. Smart! 🧠",
      "Almost a double, you nailed it! 🎯",
      "You used the double and added one! ⭐",
      "Near double, well spotted! 👀",
      "Double plus one more! ➕",
    ],
    make(a) {
      const b = a + 1;                 // the problem is always a + (a+1)
      const answer = a + b;
      const promptHtml = `<span class="t-known">${a}</span> + <span class="t-add">${b}</span> = ?`;
      return {
        prompt: `${a} + ${b} = ?`,
        promptHtml,
        solvedHtml: solve(promptHtml, answer),
        spoken: NEARDOUBLE_LINES[Math.floor(Math.random() * NEARDOUBLE_LINES.length)](a, b),
        answer,
        // mistakes: the pure double (forgot +1 = answer-1), doubled the bigger
        // (answer+1), and off-by-two; pickChoices keeps the valid distinct ones
        choices: pickChoices(answer, [a + a, b + b, answer + 2, answer - 2], 3, 21),
        // frame 2 holds the extra "+1" dot ringed so the rule stays visible
        visual: { type: "pairframe", a, b, revealOnWin: true },
      };
    },
    generate() { return this.make(pickNoRepeat("neardouble", 3, 9)); },    // 3+4 .. 9+10, no immediate repeat
    example() { return this.make(6); },                 // 6 + 7 = 13
    check(p) { return p.visual.b === p.visual.a + 1 && p.visual.a + p.visual.b === p.answer; },
  },
};

/* The day's skill. Until curriculum.js/schedule.js exist (Phase 4),
   the kid's default is +10. A `?skill=<id>` URL param overrides it for
   development/preview (read in app.js). */
export function todaysSkill() {
  return SKILLS.plus10;
}

/* ------------------------------------------------------------
   Self-test: open index.html?debug, or run in node. Verifies every
   generated problem (and each skill's fixed example) is internally
   correct, using the universal invariants plus each skill's check().
   ------------------------------------------------------------ */
export function runSelfTest(rounds = 2000) {
  let failures = 0;
  const fail = (msg, p) => { failures++; console.error("SELF-TEST FAIL:", msg, p); };

  const validate = (skill, p) => {
    // a multi-step problem validates each step's choices; a one-shot problem, itself
    const questions = p.steps || [p];
    for (const q of questions) {
      if (!Number.isInteger(q.answer))                              fail(`${skill.id}: non-integer answer`, q);
      else if (!Array.isArray(q.choices) || q.choices.length !== 3) fail(`${skill.id}: not 3 choices`, q);
      else if (new Set(q.choices).size !== 3)                       fail(`${skill.id}: duplicate choices`, q);
      else if (!q.choices.includes(q.answer))                       fail(`${skill.id}: answer not among choices`, q);
    }
    if (skill.check && !skill.check(p))                             fail(`${skill.id}: failed skill check`, p);
  };

  for (const skill of Object.values(SKILLS)) {
    for (let i = 0; i < rounds; i++) validate(skill, skill.generate());
    validate(skill, skill.example());   // the demo instance must be valid too
  }

  const msg = failures === 0
    ? `✅ skills self-test passed (${rounds} rounds × ${Object.keys(SKILLS).length} skills)`
    : `❌ skills self-test: ${failures} failure(s)`;
  console.log(msg);
  return failures === 0;
}
