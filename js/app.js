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
  worlds: $("worlds"),
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
  // shop
  shopBtn: $("shop-btn"),
  shopPanel: $("shop-panel"),
  shopItems: $("shop-items"),
  shopCoins: $("shop-coins"),
  shopBuy: $("shop-buy"),
  shopClose: $("shop-close"),
  shopAvatar: $("shop-avatar"),
  shopTabs: $("shop-tabs"),
  // collection
  collBtn: $("coll-btn"),
  collPanel: $("coll-panel"),
  collItems: $("coll-items"),
  collClose: $("coll-close"),
  collAvatar: $("coll-avatar"),
  collTabs: $("coll-tabs"),
  collRemove: $("coll-removeall"),
  // play-screen home
  playHome: $("play-home"),
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

  const actCh = curriculum.activeChapter();
  const cp = actCh ? curriculum.chapterProgress(actCh.id) : null;
  els.seasonLine.innerHTML =
    `Season ${progress.getCycle()} · ${mastered.length} of ${cells.length} unlocked` +
    (actCh ? `<br><span class="chapter-line">Chapter ${actCh.id} of ${curriculum.CHAPTERS.length}: ${actCh.title} · ${cp.done} / ${cp.total}</span>` : "");

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

  renderWorlds();
  renderJar();
  renderAvatar();
}

/* The two Worlds, top of the structure (World > Chapter > Skill). World 1 (additive) is
   active; World 2 (×/÷) is a LOCKED teaser — its content is a later drop, but showing it now
   makes the journey legible and builds anticipation. progress.getWorld() picks the active one. */
function renderWorlds() {
  const active = progress.getWorld();
  const worlds = [
    { id: 1, iconL: "➕", iconR: "➖", name: "Add & Subtract" },
    { id: 2, iconL: "✖️", iconR: "➗", name: "Multiply & Divide", locked: true },
  ];
  els.worlds.innerHTML = worlds.map((w) => {
    const isActive = w.id === active && !w.locked;
    const cls = w.locked ? "world locked" : (isActive ? "world active" : "world");
    const tag = w.locked ? "🔒 Coming soon" : (isActive ? "Playing now" : "");
    return `<div class="${cls}"><span class="world-name">${w.iconL} World ${w.id} ${w.iconR}</span>` +
           `<span class="world-sub">${w.name}</span>` +
           (tag ? `<span class="world-tag">${tag}</span>` : "") + `</div>`;
  }).join("");
}

function rowEl() { const r = document.createElement("div"); r.className = "tile-row"; return r; }

function tileEl(c, glyph) {
  const t = document.createElement("button");
  t.className = `tile ${c.state}`;
  const tappable = c.state === "live" || c.state === "mastered";
  t.disabled = !tappable;
  // (the old E/M/H pips were removed — difficulty is now Season-driven by the escalator,
  // not a per-tile choice, so the letters were confusing with no role.)
  t.innerHTML =
    `<span class="tile-name">${glyph} ${c.label}</span>` +
    (c.state === "live" ? `<span class="tile-sub">${c.len} questions</span>` : "");
  if (tappable) t.addEventListener("click", () => startRound(SKILLS[c.id]));
  return t;
}

/* The jar fill tracks progress toward the cheapest SPECIAL prize she doesn't own yet — a real
   saving goal that RETARGETS as she collects (Mermaid → Princess → …) and reads full once she
   owns them all. This is the coin economy's anchor: prizes are the big sink, the jar is the meter. */
function jarGoal() {
  const next = ITEMS.filter((i) => i.slot === "outfit" && !progress.isOwned(i.id))
    .sort((a, b) => a.price - b.price)[0];
  return next ? next.price : 1;
}
function renderJar() {
  const coins = progress.getCoins();
  els.coinAmt.textContent = coins;
  els.jarFill.style.width = Math.min(100, Math.round((coins / jarGoal()) * 100)) + "%";
}

/* ---- ITEMS: the unified avatar wardrobe (earned chapter parts + buyable shop items) --------
   Each item: id, label, icon (lists/tabs), price (0 = earned), slot (the overlap group), z
   (drawn BEHIND the body or in FRONT), and svg (its drawing in the 240×300 avatar space).
   Earned parts and bought items share SLOTS, so wearing one bumps out anything in that slot —
   nothing ever overlaps. Coordinates are tuned by eye in the browser. ---- */
const ITEMS = [
  // EARNED (granted by clearing chapters; label/icon also live in curriculum.CHAPTERS)
  { id: "chapter-3", label: "Crown",     icon: "👑", price: 0, slot: "head", z: "front", svg: `<path d="M92 54 L100 38 L110 50 L120 34 L130 50 L140 38 L148 54 Z" fill="#ffd34d" stroke="#e0a800" stroke-width="1.5"/><circle cx="100" cy="41" r="3" fill="#ff5f6d"/><circle cx="120" cy="37" r="3" fill="#5fd0ff"/><circle cx="140" cy="41" r="3" fill="#7bff9b"/>` },
  { id: "chapter-1", label: "Star Clip", icon: "⭐", price: 0, slot: "hair", z: "front", svg: `<path d="M150 58 l3.5 8 8.5 1 -6 6 1.5 8.5 -7.5 -4.5 -7.5 4.5 1.5 -8.5 -6 -6 8.5 -1 z" fill="#ffcc33" stroke="#e0a800" stroke-width="1"/>` },
  { id: "chapter-2", label: "Cape",      icon: "🦸", price: 0, slot: "back", z: "back",  svg: `<path d="M86 150 Q56 234 78 286 L120 270 L162 286 Q184 234 154 150 Q120 168 86 150 Z" fill="#7b3fb0"/>` },
  { id: "chapter-4", label: "Wand",      icon: "🪄", price: 0, slot: "hand", z: "front", svg: `<rect x="184" y="196" width="5" height="44" rx="2.5" fill="#c9a24a" transform="rotate(16 186 218)"/><path d="M197 184 l3 7 8 1 -6 5.5 1.5 8 -6.5 -4 -6.5 4 1.5 -8 -6 -5.5 8 -1 z" fill="#ffe066" stroke="#e0a800" stroke-width="1"/>` },
  // TOPS (drawn over the default gray shirt)
  { id: "redtee",    label: "Red Tee",    icon: "👕", price: 50, slot: "top", z: "front", svg: `<path d="M84 158 Q120 149 156 158 L153 232 Q120 244 87 232 Z" fill="#ff5f6d"/><path d="M88 160 Q60 156 56 182 Q58 198 76 196 Q92 178 88 160 Z" fill="#ff5f6d"/><path d="M152 160 Q180 156 184 182 Q182 198 164 196 Q148 178 152 160 Z" fill="#ff5f6d"/>` },
  { id: "violettee", label: "Violet Tee", icon: "👚", price: 50, slot: "top", z: "front", svg: `<path d="M84 158 Q120 149 156 158 L153 232 Q120 244 87 232 Z" fill="#9b5de5"/><path d="M88 160 Q60 156 56 182 Q58 198 76 196 Q92 178 88 160 Z" fill="#9b5de5"/><path d="M152 160 Q180 156 184 182 Q182 198 164 196 Q148 178 152 160 Z" fill="#9b5de5"/>` },
  { id: "startee",   label: "Star Tee",   icon: "🌟", price: 80, slot: "top", z: "front", svg: `<path d="M84 158 Q120 149 156 158 L153 232 Q120 244 87 232 Z" fill="#2fc7c7"/><path d="M88 160 Q60 156 56 182 Q58 198 76 196 Q92 178 88 160 Z" fill="#2fc7c7"/><path d="M152 160 Q180 156 184 182 Q182 198 164 196 Q148 178 152 160 Z" fill="#2fc7c7"/><path d="M120 184 l4 9 10 .5 -7.5 6.5 2 9.5 -8.5 -5 -8.5 5 2 -9.5 -7.5 -6.5 10 -.5 z" fill="#ffe066"/>` },
  // BOTTOMS (drawn over the default gray shorts)
  { id: "blueshorts", label: "Blue Shorts", icon: "🩳", price: 50, slot: "bottom", z: "front", svg: `<path d="M87 224 Q120 219 153 224 L150 251 L126 251 L120 236 L114 251 L90 251 Z" fill="#4a7fd8" stroke="#3563b0" stroke-width="1"/>` },
  { id: "pinkskirt",  label: "Pink Skirt",  icon: "👗", price: 70, slot: "bottom", z: "front", svg: `<path d="M87 224 Q120 219 153 224 L165 264 Q120 274 75 264 Z" fill="#ff8fc7" stroke="#e070b0" stroke-width="1"/>` },
  { id: "tutu",       label: "Tutu",        icon: "🩰", price: 90, slot: "bottom", z: "front", svg: `<path d="M87 226 Q120 221 153 226 L168 252 Q120 266 72 252 Z" fill="#ffb3de"/><path d="M80 244 Q120 256 160 244" fill="none" stroke="#ff8fc7" stroke-width="3"/>` },
  // HEAD
  { id: "bow",      label: "Bow",     icon: "🎀", price: 50,  slot: "head", z: "front", svg: `<path d="M120 50 L104 42 L104 60 Z" fill="#ff5f9e"/><path d="M120 50 L136 42 L136 60 Z" fill="#ff5f9e"/><circle cx="120" cy="51" r="5" fill="#e03e80"/>` },
  { id: "tophat",   label: "Top Hat", icon: "🎩", price: 150, slot: "head", z: "front", svg: `<rect x="90" y="40" width="60" height="8" rx="3" fill="#333350" stroke="#8a8ab0" stroke-width="1"/><rect x="101" y="12" width="38" height="30" rx="3" fill="#333350" stroke="#8a8ab0" stroke-width="1"/><rect x="101" y="30" width="38" height="6" fill="#ff5f6d"/>` },
  { id: "tiara",    label: "Tiara",   icon: "💎", price: 120, slot: "head", z: "front", svg: `<path d="M98 52 Q120 38 142 52" fill="none" stroke="#ffe066" stroke-width="4"/><path d="M120 39 l2 5 5 .5 -4 3.5 1 5 -4 -2.5 -4 2.5 1 -5 -4 -3.5 5 -.5 z" fill="#7fdfff" stroke="#e0a800" stroke-width=".5"/><circle cx="105" cy="49" r="2.5" fill="#ff8fc7"/><circle cx="135" cy="49" r="2.5" fill="#ff8fc7"/>` },
  // HAIR
  { id: "flower",   label: "Flower",   icon: "🌸", price: 75, slot: "hair", z: "front", svg: `<circle cx="84" cy="66" r="5" fill="#ff8fc7"/><circle cx="77" cy="62" r="5" fill="#ff8fc7"/><circle cx="91" cy="62" r="5" fill="#ff8fc7"/><circle cx="79" cy="71" r="5" fill="#ff8fc7"/><circle cx="89" cy="71" r="5" fill="#ff8fc7"/><circle cx="84" cy="66" r="4" fill="#ffd34d"/>` },
  { id: "headband", label: "Headband", icon: "💗", price: 60, slot: "hair", z: "front", svg: `<path d="M70 66 Q120 46 170 66 L167 75 Q120 56 73 75 Z" fill="#ff5f9e"/>` },
  // FACE
  { id: "sunglasses", label: "Sunglasses", icon: "🕶️", price: 100, slot: "face", z: "front", svg: `<rect x="89" y="100" width="23" height="14" rx="5" fill="#2b3358" stroke="#7f8cc0" stroke-width="1"/><rect x="128" y="100" width="23" height="14" rx="5" fill="#2b3358" stroke="#7f8cc0" stroke-width="1"/><rect x="112" y="105" width="16" height="3" fill="#2b3358"/>` },
  { id: "glasses",    label: "Glasses",    icon: "👓", price: 70,  slot: "face", z: "front", svg: `<circle cx="101" cy="107" r="10" fill="none" stroke="#5a6aa0" stroke-width="3"/><circle cx="139" cy="107" r="10" fill="none" stroke="#5a6aa0" stroke-width="3"/><line x1="111" y1="107" x2="129" y2="107" stroke="#5a6aa0" stroke-width="3"/>` },
  // NECK
  { id: "necklace", label: "Necklace", icon: "📿", price: 90,  slot: "neck", z: "front", svg: `<path d="M104 150 Q120 168 136 150" fill="none" stroke="#ffd34d" stroke-width="2.5"/><circle cx="120" cy="164" r="4" fill="#7fdfff" stroke="#e0a800" stroke-width=".5"/>` },
  { id: "bowtie",   label: "Bow Tie",  icon: "🎀", price: 60,  slot: "neck", z: "front", svg: `<path d="M120 153 L109 148 L109 160 Z" fill="#ff5f6d"/><path d="M120 153 L131 148 L131 160 Z" fill="#ff5f6d"/><rect x="117" y="150" width="6" height="6" rx="1" fill="#d63b48"/>` },
  { id: "scarf",    label: "Scarf",    icon: "🧣", price: 100, slot: "neck", z: "front", svg: `<path d="M99 147 Q120 159 141 147 L143 156 Q120 169 97 156 Z" fill="#9b5de5"/><path d="M116 156 l-2 22 12 0 -2 -22 z" fill="#8a4dd0"/>` },
  // BACK
  { id: "wings",    label: "Wings",    icon: "🦋", price: 200, slot: "back", z: "back", svg: `<path d="M86 162 Q38 150 34 202 Q60 214 92 198 Z" fill="#9fd8ff" opacity="0.92"/><path d="M154 162 Q202 150 206 202 Q180 214 148 198 Z" fill="#9fd8ff" opacity="0.92"/>` },
  { id: "backpack", label: "Backpack", icon: "🎒", price: 90,  slot: "back", z: "back", svg: `<rect x="76" y="158" width="88" height="68" rx="14" fill="#6a9be0" stroke="#3a6cae" stroke-width="2"/>` },
  // HANDS
  { id: "balloon",  label: "Balloon",  icon: "🎈", price: 60,  slot: "hand", z: "front", svg: `<line x1="180" y1="226" x2="190" y2="176" stroke="#ccd2e8" stroke-width="1.5"/><ellipse cx="192" cy="164" rx="14" ry="17" fill="#ff5f6d"/>` },
  { id: "bouquet",  label: "Bouquet",  icon: "💐", price: 110, slot: "hand", z: "front", svg: `<rect x="185" y="214" width="3" height="18" fill="#3a7a3a" transform="rotate(8 186 223)"/><circle cx="182" cy="208" r="6" fill="#ff8fc7"/><circle cx="193" cy="211" r="6" fill="#ffd34d"/><circle cx="187" cy="217" r="6" fill="#7fdfff"/>` },
  // SHOES
  { id: "sneakers", label: "Sneakers", icon: "👟", price: 80,  slot: "shoes", z: "front", svg: `<ellipse cx="106" cy="289" rx="15" ry="10" fill="#f4f7ff" stroke="#5a6aa0" stroke-width="1.5"/><ellipse cx="134" cy="289" rx="15" ry="10" fill="#f4f7ff" stroke="#5a6aa0" stroke-width="1.5"/><path d="M93 289 q13 5 26 0" fill="none" stroke="#ff5f6d" stroke-width="2"/><path d="M121 289 q13 5 26 0" fill="none" stroke="#ff5f6d" stroke-width="2"/>` },
  { id: "boots",    label: "Boots",    icon: "🥾", price: 120, slot: "shoes", z: "front", svg: `<rect x="97" y="268" width="18" height="22" rx="5" fill="#8a5a3a"/><rect x="121" y="268" width="18" height="22" rx="5" fill="#8a5a3a"/><ellipse cx="106" cy="290" rx="14" ry="8" fill="#6a4226"/><ellipse cx="134" cy="290" rx="14" ry="8" fill="#6a4226"/>` },
  { id: "slippers", label: "Slippers", icon: "🥿", price: 50,  slot: "shoes", z: "front", svg: `<ellipse cx="106" cy="290" rx="14" ry="9" fill="#ff9ecb"/><ellipse cx="134" cy="290" rx="14" ry="9" fill="#ff9ecb"/><circle cx="106" cy="287" r="3" fill="#fff"/><circle cx="134" cy="287" r="3" fill="#fff"/>` },
  // SPECIALTY — collector prizes (premium coin SINKS; the aspirational goals across Seasons/Worlds).
  // The "outfit" slot is its own thing, so a prize is one-at-a-time and never clashes with accessories.
  { id: "mermaid",  label: "Mermaid",  icon: "🧜‍♀️", price: 600,  slot: "outfit", z: "front", svg: `<path d="M90 178 Q120 170 150 178 Q158 238 134 282 Q120 294 106 282 Q82 238 90 178 Z" fill="#2fd0a8" stroke="#1fa886" stroke-width="1.5"/><path d="M120 276 Q84 290 76 308 Q104 302 120 290 Q136 302 164 308 Q156 290 120 276 Z" fill="#27b894"/><circle cx="109" cy="198" r="2.5" fill="#9affe6"/><circle cx="131" cy="198" r="2.5" fill="#9affe6"/><circle cx="120" cy="212" r="2.5" fill="#9affe6"/><circle cx="110" cy="228" r="2.5" fill="#9affe6"/><circle cx="130" cy="228" r="2.5" fill="#9affe6"/><circle cx="120" cy="244" r="2.5" fill="#9affe6"/><path d="M101 172 A9 7 0 0 1 119 172 Z" fill="#ff6fb0" stroke="#e04f90" stroke-width="1"/><path d="M121 172 A9 7 0 0 1 139 172 Z" fill="#ff6fb0" stroke="#e04f90" stroke-width="1"/>` },
  { id: "princess", label: "Princess", icon: "👸", price: 1000, slot: "outfit", z: "front", svg: `<circle cx="88" cy="168" r="10" fill="#ff9ad5"/><circle cx="152" cy="168" r="10" fill="#ff9ad5"/><path d="M92 156 Q120 148 148 156 L170 292 Q120 304 70 292 Z" fill="#ff9ad5" stroke="#e070b0" stroke-width="2"/><path d="M96 158 Q120 152 144 158 L148 182 Q120 190 92 182 Z" fill="#ffd86b"/><circle cx="106" cy="232" r="2.5" fill="#fff"/><circle cx="132" cy="250" r="2.5" fill="#fff"/><circle cx="120" cy="272" r="2.5" fill="#fff"/>` },
];
const CATEGORIES = [
  { slot: "top",    label: "Tops",    icon: "👕" },
  { slot: "bottom", label: "Bottoms", icon: "👖" },
  { slot: "head",  label: "Head",  icon: "👑" },
  { slot: "hair",  label: "Hair",  icon: "🎀" },
  { slot: "face",  label: "Face",  icon: "🕶️" },
  { slot: "neck",  label: "Neck",  icon: "📿" },
  { slot: "back",  label: "Back",  icon: "🦋" },
  { slot: "hand",  label: "Hands", icon: "🪄" },
  { slot: "shoes", label: "Shoes", icon: "👟" },
  { slot: "outfit", label: "Special", icon: "✨" },
];
const itemById = (id) => ITEMS.find((i) => i.id === id);
function slotOf(id) { const it = itemById(id); return it ? it.slot : null; }
const ALL_ITEM_IDS = ITEMS.map((i) => i.id);

/* Does equipping `a` force `b` off? Same slot, OR either is a full-costume "outfit" — a special
   costume and individual accessories never mix, so wearing a costume clears EVERYTHING else (and
   putting on any accessory takes the costume off). */
function conflicts(a, b) {
  const sa = slotOf(a), sb = slotOf(b);
  return sa === sb || sa === "outfit" || sb === "outfit";
}
/* Wear an item: take off everything it conflicts with, then put it on. Used by buys, the
   Collection "Wear", and the auto-equip of a freshly-earned chapter part. */
function equipItem(id) {
  for (const other of ALL_ITEM_IDS) {
    if (other !== id && progress.isEquipped(other) && conflicts(id, other)) progress.setEquipped(other, false);
  }
  progress.setEquipped(id, true);
}
function toggleItem(id) {   // Collection: take off if worn, else wear (slot-aware)
  if (progress.isEquipped(id)) progress.setEquipped(id, false);
  else equipItem(id);
}
/* The OWNED collection (earned parts + bought items), in catalog order. */
function collectionItems() {
  return ITEMS.filter((it) => progress.isOwned(it.id))
    .map((it) => ({ id: it.id, label: it.label, icon: it.icon, earned: it.price === 0 }));
}

/* Build the hero avatar SVG (a STRING), data-driven from ITEMS. `worn(id)` decides what's on.
   A soft backdrop lifts dark items off the blue (skipped for the tiny list-row icons). Back
   items (cape/wings/backpack) draw BEHIND the body. */
function avatarMarkup(worn, backdrop = true) {
  const sk = "#f4c89a", hair = "#6b4226", gray = "#d2d2da", gray2 = "#c4c4cc";
  const draw = (z) => ITEMS.filter((it) => it.z === z && worn(it.id)).map((it) => it.svg).join("");
  // a SPECIAL costume (Mermaid/Princess) replaces the body's clothes — HIDE the default shirt,
  // sleeves, and shorts so the costume sits on bare skin (works in the shop try-on preview too).
  const outfitOn = ITEMS.some((it) => it.slot === "outfit" && worn(it.id));
  const shorts = outfitOn ? "" : `<rect x="98" y="224" width="20" height="34" rx="6" fill="${gray2}"/><rect x="122" y="224" width="20" height="34" rx="6" fill="${gray2}"/>`;
  const shirt = outfitOn ? "" : `<path d="M90 160 Q120 153 150 160 L148 228 Q120 238 92 228 Z" fill="${gray}"/><circle cx="86" cy="170" r="11" fill="${gray}"/><circle cx="154" cy="170" r="11" fill="${gray}"/>`;
  return `
    <svg viewBox="0 0 240 300" xmlns="http://www.w3.org/2000/svg">
      ${backdrop ? `<rect x="14" y="8" width="212" height="286" rx="40" fill="#46538f" opacity="0.28"/>` : ""}
      ${draw("back")}
      <path d="M60 102 Q58 182 92 198 L148 198 Q182 182 180 102 Q180 46 120 46 Q60 46 60 102 Z" fill="${hair}"/>
      <rect x="100" y="226" width="18" height="64" rx="9" fill="${sk}"/>
      <rect x="122" y="226" width="18" height="64" rx="9" fill="${sk}"/>
      ${shorts}
      <ellipse cx="106" cy="292" rx="12" ry="8" fill="${sk}"/>
      <ellipse cx="134" cy="292" rx="12" ry="8" fill="${sk}"/>
      <path d="M86 158 Q120 148 154 158 L150 232 Q120 244 90 232 Z" fill="${sk}"/>
      <rect x="60" y="162" width="16" height="66" rx="8" fill="${sk}" transform="rotate(9 68 195)"/>
      <rect x="164" y="162" width="16" height="66" rx="8" fill="${sk}" transform="rotate(-9 172 195)"/>
      <circle cx="62" cy="228" r="10" fill="${sk}"/>
      <circle cx="178" cy="228" r="10" fill="${sk}"/>
      ${shirt}
      <rect x="110" y="146" width="20" height="16" fill="${sk}"/>
      <circle cx="64" cy="104" r="10" fill="${sk}"/>
      <circle cx="176" cy="104" r="10" fill="${sk}"/>
      <circle cx="120" cy="102" r="54" fill="${sk}"/>
      <ellipse cx="101" cy="107" rx="9" ry="11" fill="#fff"/><ellipse cx="139" cy="107" rx="9" ry="11" fill="#fff"/>
      <circle cx="101" cy="109" r="5.5" fill="#3a2e3f"/><circle cx="139" cy="109" r="5.5" fill="#3a2e3f"/>
      <path d="M111 125 Q120 132 129 125" fill="none" stroke="#b5557a" stroke-width="3" stroke-linecap="round"/>
      <path d="M68 102 Q66 50 120 49 Q174 50 172 102 Q150 74 120 78 Q90 74 68 102 Z" fill="${hair}"/>
      ${draw("front")}
    </svg>`;
}
function renderAvatar(box = els.avatarBox, preview = null) {
  const worn = (id) => preview ? preview.has(id) : progress.isEquipped(id);
  box.innerHTML = avatarMarkup(worn, true);
}
/* A mini avatar wearing ONLY this item — the honest "graphic" for shop/collection rows (no
   misleading emoji; she sees exactly what she's buying / wearing). */
function itemIcon(id) { return avatarMarkup((x) => x === id, false); }

/* dev: the DESIGN PROTOTYPE page (?design) — every item shown on a full avatar in a labeled
   grid, grouped by category, plus a few COMBOS to check z-order / overlap. The staging area to
   eyeball and tune new items (edit their coords in ITEMS) BEFORE they go live in the shop. */
function renderDesignPage() {
  const card = (worn, label) =>
    `<div class="design-card"><div class="design-av">${avatarMarkup(worn, false)}</div><span class="design-lbl">${label}</span></div>`;
  let html = `<h1 class="design-title">🎨 Design Prototype</h1>` +
    `<p class="design-sub">Every item on the avatar. Tune coordinates in the ITEMS catalog, then it's live.</p>`;
  for (const cat of CATEGORIES) {
    const items = ITEMS.filter((it) => it.slot === cat.slot);
    if (!items.length) continue;
    html += `<h2 class="design-cat">${cat.icon} ${cat.label}</h2><div class="design-grid">` +
      items.map((it) => card((x) => x === it.id, `${it.label} · ${it.price ? "🪙" + it.price : "earned"}`)).join("") +
      `</div>`;
  }
  const combos = [
    { ids: ["redtee", "blueshorts", "sneakers"], label: "Tee + Shorts + Sneakers" },
    { ids: ["startee", "pinkskirt", "chapter-3", "necklace"], label: "Tee + Skirt + Crown + Necklace" },
    { ids: ["chapter-1", "chapter-2", "chapter-3", "chapter-4"], label: "All earned parts" },
    { ids: ["violettee", "tutu", "bow", "sunglasses", "boots"], label: "Layered look" },
    { ids: ["mermaid"], label: "Mermaid costume" },
    { ids: ["princess"], label: "Princess costume" },
  ];
  html += `<h2 class="design-cat">🧩 Combos (z-order & overlap checks)</h2><div class="design-grid">` +
    combos.map((c) => { const s = new Set(c.ids); return card((x) => s.has(x), c.label); }).join("") +
    `</div>`;
  $("app").innerHTML = `<div class="design-page">${html}</div>`;
}

/* ===== SHOP + COLLECTION UI (the catalog, slots, and equip helpers are defined above) =====
   The SHOP shows only BUYABLE items (not yet owned), one CATEGORY tab at a time; tap an item to
   try it on, then Buy. The COLLECTION manages what's WORN (earned + bought), also by category;
   what's worn there is exactly what shows on the homepage. ---- */

// the 7 category tabs, active one highlighted
function renderTabs(container, activeSlot) {
  container.innerHTML = CATEGORIES.map((c) =>
    `<button class="cat-tab ${c.slot === activeSlot ? "on" : ""}" data-slot="${c.slot}">` +
    `${c.icon}<span>${c.label}</span></button>`
  ).join("");
}

/* ===== SHOP — try on, then buy (one category at a time) ===== */
let shopTab = CATEGORIES[0].slot;
let shopTryOn = null;   // the ONE item currently tried-on (not yet bought)

function openShop() { sfx.unlock(); shopTryOn = null; renderShop(); els.shopPanel.hidden = false; }
function closeShop() { shopTryOn = null; els.shopPanel.hidden = true; }

function renderShop() {
  renderTabs(els.shopTabs, shopTab);
  const coins = progress.getCoins();
  els.shopCoins.textContent = coins;
  // preview = what she'd look like if she equipped the tried-on item — slot-aware, so the
  // try-on REPLACES anything in the same slot instead of overlapping it.
  const preview = new Set(ALL_ITEM_IDS.filter((id) => progress.isEquipped(id)));
  if (shopTryOn) {
    for (const id of [...preview]) if (id !== shopTryOn && conflicts(shopTryOn, id)) preview.delete(id);
    preview.add(shopTryOn);
  }
  renderAvatar(els.shopAvatar, preview);
  // Buy bar: ALWAYS visible (keeps the layout steady). No selection → a disabled prompt;
  // an item tried on → Buy (affordable) or Need (not).
  const t = shopTryOn ? itemById(shopTryOn) : null;
  els.shopBuy.hidden = false;
  if (t && !progress.isOwned(t.id)) {
    const afford = coins >= t.price;
    els.shopBuy.disabled = !afford;
    els.shopBuy.textContent = afford ? `Buy ${t.icon} ${t.label} · 🪙${t.price}` : `Need 🪙${t.price}`;
  } else {
    els.shopBuy.disabled = true;
    els.shopBuy.textContent = "Tap an item to try it on";
  }
  // only BUYABLE items in this category (owned/earned ones live in the Collection)
  const list = ITEMS.filter((it) => it.slot === shopTab && it.price > 0 && !progress.isOwned(it.id));
  els.shopItems.innerHTML = list.length
    ? list.map((it) => {
        const trying = shopTryOn === it.id;
        const state = (trying ? "trying " : "") + (coins >= it.price ? "buyable" : "tooexp");
        return `<button class="shop-item ${state}" data-id="${it.id}">` +
          `<span class="shop-ic">${itemIcon(it.id)}</span>` +
          `<span class="shop-nm">${it.label}<span class="shop-pr">🪙 ${it.price}</span></span>` +
          `<span class="shop-act">${trying ? "Trying on" : "Try on"}</span>` +
          `</button>`;
      }).join("")
    : `<p class="coll-empty">You have everything here! ✨ Check back soon for new items.</p>`;
}
function onShopTabClick(e) {
  const tab = e.target.closest(".cat-tab");
  if (!tab) return;
  shopTab = tab.dataset.slot;
  shopTryOn = null;
  sfx.tap();
  renderShop();
}
function onShopItemClick(e) {
  const row = e.target.closest(".shop-item");
  if (!row) return;
  shopTryOn = (shopTryOn === row.dataset.id ? null : row.dataset.id);   // toggle the single try-on
  sfx.tap();
  renderShop();
}
function onShopBuy() {
  if (!shopTryOn) return;
  const item = itemById(shopTryOn);
  if (!progress.purchase(item.id, item.price).ok) return;
  equipItem(item.id);     // auto-wear (slot-aware)
  shopTryOn = null;
  sfx.fanfare();
  renderShop();           // bought item drops out of the buyable list
  renderAvatar();         // homepage avatar
  renderJar();            // coins changed
}

/* ===== COLLECTION — manage what's worn (earned + bought), one category at a time ===== */
let collTab = CATEGORIES[0].slot;

function openCollection() { sfx.unlock(); renderCollection(); els.collPanel.hidden = false; }
function closeCollection() { els.collPanel.hidden = true; }

function renderCollection() {
  renderTabs(els.collTabs, collTab);
  renderAvatar(els.collAvatar);   // shows exactly what's worn
  const list = collectionItems().filter((it) => slotOf(it.id) === collTab);
  els.collItems.innerHTML = list.length
    ? list.map((it) => {
        const worn = progress.isEquipped(it.id);
        return `<button class="shop-item ${worn ? "worn" : ""}" data-id="${it.id}">` +
          `<span class="shop-ic">${itemIcon(it.id)}</span>` +
          `<span class="shop-nm">${it.label}<span class="shop-pr">${it.earned ? "⭐ earned" : "🛍️ bought"}</span></span>` +
          `<span class="shop-act">${worn ? "Take off" : "Wear"}</span>` +
          `</button>`;
      }).join("")
    : `<p class="coll-empty">Nothing here yet — try the 🛍️ Shop or master a chapter!</p>`;
}
function onCollTabClick(e) {
  const tab = e.target.closest(".cat-tab");
  if (!tab) return;
  collTab = tab.dataset.slot;
  sfx.tap();
  renderCollection();
}
function onCollectionClick(e) {
  const row = e.target.closest(".shop-item");
  if (!row) return;
  toggleItem(row.dataset.id);
  sfx.tap();
  renderCollection();
  renderAvatar();   // homepage reflects the change
}
/* Take EVERYTHING off — back to the bare default shirt + shorts. */
function onRemoveAll() {
  for (const id of ALL_ITEM_IDS) progress.setEquipped(id, false);
  sfx.tap();
  renderCollection();
  renderAvatar();
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
  // The escalator level = the Season, AFTER any parent cap (effectiveCycle). Inert until a
  // parent caps this skill from the panel; then this one skill escalates slower (e.g. addfacts
  // held at L2 if the teen jump is too hard) without touching the others.
  const cycle = progress.effectiveCycle(skill.id, progress.getCycle());
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
  // CHAPTER payoff: a chapter completes ON the round that masters its LAST skill. Check + grant
  // BEFORE advanceIfComplete() below — that wipes the cleared flags on a Season rollover, which
  // would make Ch4's completion read false afterwards. grantChapterPart is idempotent, so
  // `.granted` is true only the FIRST time the chapter finished → drives the avatar-part reveal.
  const ch = curriculum.chapterFor(skill.id);
  const chapterDone = (ch && curriculum.chapterComplete(ch.id) && progress.grantChapterPart(ch.id).granted)
    ? ch : null;
  if (chapterDone) equipItem(`chapter-${chapterDone.id}`);   // auto-wear the earned part (slot-aware)
  const daily = progress.claimDailyReturn(localDayKey());   // +3 on the first completed round of a new day
  // advanceIfComplete returns the NEW cycle number iff that mastery just completed the whole Season.
  const newCycle = summary.newlyMastered ? curriculum.advanceIfComplete() : null;
  const seasonDone = newCycle ? newCycle - 1 : 0;          // the Season she just finished (frames the reset as a win)

  const correct = summary.cleanCount;
  els.rewardStars.textContent = "⭐".repeat(correct) + "☆".repeat(session.len - correct);
  els.rewardTitle.textContent =
    seasonDone ? `Season ${seasonDone} complete! 🎉🏆`
    : chapterDone ? `${chapterDone.title} complete! 🏅`
    : summary.newlyMastered ? "Skill unlocked! 🏆"
    : (correct === session.len ? "Perfect! 🎉" : "You did it! 🎉");

  let coinMsg = `+${summary.coinsEarned} 🪙`;
  if (summary.newBest) coinMsg += "  ·  New best! ✨";
  if (daily.granted) coinMsg += `  ·  +${daily.amount} daily`;
  els.rewardCoins.textContent = coinMsg;
  // Season-complete reframes the upcoming board reset as a fresh chapter, not erased trophies.
  els.rewardSpeed.textContent = seasonDone
    ? "You finished the whole board! A fresh Season begins. 🌟"
    : chapterDone
    ? `You earned the ${chapterDone.part}! ${chapterDone.icon}`
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
      : chapterDone ? `Chapter complete! You earned the ${chapterDone.part}.`
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

// shop: open from the board, tap items to try on, Buy commits, close
els.shopBtn.addEventListener("click", openShop);
els.shopClose.addEventListener("click", closeShop);
els.shopTabs.addEventListener("click", onShopTabClick);
els.shopItems.addEventListener("click", onShopItemClick);
els.shopBuy.addEventListener("click", onShopBuy);
// collection: open from the board, tap a category tab, tap items to wear / take off, close
els.collBtn.addEventListener("click", openCollection);
els.collClose.addEventListener("click", closeCollection);
els.collTabs.addEventListener("click", onCollTabClick);
els.collItems.addEventListener("click", onCollectionClick);
els.collRemove.addEventListener("click", onRemoveAll);
// play screen: a Home button back to the board (abandons the in-progress round; nothing is
// committed until a round finishes, so this just discards it — consistent with no mid-round resume)
els.playHome.addEventListener("click", () => { speech.stop(); showBoard(); });   // cut any in-progress cue

// best-effort: ask the browser to keep our storage so a week-dark Safari TAB doesn't
// evict coins/avatar/Seasons (the installed PWA icon is exempt, but this is free insurance).
progress.requestPersistentStorage();

const params = new URLSearchParams(location.search);
// ---- DEV HOOKS — localhost ONLY. INERT on the live deploy, so coins/parts/mastery can't be
// shortcut and the gate ordering can't be bypassed (Howard iterates in local Chrome). ----
const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (isDev) {
  if (params.has("debug")) runSelfTest();
  // ?season=N → preview escalated difficulty (escalator + teen ramp)
  const seasonN = +(params.get("season") || 0);
  if (seasonN > 0) progress.devSetCycle(seasonN);
  // ?seed=N → pre-clear the first N spine skills (mid-Season board screenshots)
  const seedN = +(params.get("seed") || 0);
  if (seedN > 0) {
    for (const id of curriculum.SEQUENCE.slice(0, seedN)) {
      const flags = Array(curriculum.roundLength(id)).fill(1);
      progress.finishRound({ skillId: id, cleanFlags: flags });
      progress.finishRound({ skillId: id, cleanFlags: flags });
    }
  }
  // ?parts=N → grant + equip chapter avatar parts 1..N
  const partsN = +(params.get("parts") || 0);
  for (let n = 1; n <= partsN; n++) { progress.grantChapterPart(n); equipItem(`chapter-${n}`); }
  // ?coins=N → grant coins (shop testing)
  const coinsN = +(params.get("coins") || 0);
  if (coinsN > 0) progress.addCoins(coinsN);
}

// open the right screen — ?design / ?skill previews are dev-only too; the live site always boots the board
const previewId = params.get("skill");
if (isDev && params.has("design")) renderDesignPage();
else if (isDev && previewId && SKILLS[previewId]) startRound(SKILLS[previewId]);
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
