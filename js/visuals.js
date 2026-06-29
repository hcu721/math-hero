/* ============================================================
   visuals.js — SVG renderers that EXTERNALIZE the math.

   The whole teaching idea (PRD): put the pattern on the screen so
   it doesn't have to live in the kid's working memory. For +10 the
   pattern is "drop straight down one row" on a 50-chart.

   IMPORTANT layout note: the chart is 10 COLUMNS WIDE × 5 ROWS TALL
   (row 1 = 1..10, row 2 = 11..20, ... row 5 = 41..50). That width
   is what makes "+10 = the cell directly below, same column" TRUE.
   A 5-wide grid would break the place-value lesson.
   ============================================================ */

const COLS = 10;
const ROWS = 5;
const SVGNS = "http://www.w3.org/2000/svg";

/* grid -> pixel helpers (viewBox units; the SVG scales to its box) */
const CELL = 46;
const PAD = 8;
const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 2;

function colOf(num) { return (num - 1) % COLS; }       // 0..9
function rowOf(num) { return Math.floor((num - 1) / COLS); } // 0..4
function xOf(num) { return PAD + colOf(num) * CELL; }
function yOf(num) { return PAD + rowOf(num) * CELL; }
function cxOf(num) { return xOf(num) + CELL / 2; }     // cell centre x
function cyOf(num) { return yOf(num) + CELL / 2; }     // cell centre y

function el(name, attrs = {}) {
  const node = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/* Build a fresh 50-chart SVG (all 50 cells, no highlights) and return it. Shared by
   the +10-family chart skills (plus10/skip10/plus9/addones), which highlight cells
   differently. (`more` used to share it, but it was stripped of its visual on
   2026-06-21 — the chart's reading-order position handed the answer for free.) */
function buildChart50Svg(label) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
  for (let num = 1; num <= 50; num++) {
    const g = el("g");
    const rect = el("rect", {
      x: xOf(num) + 2, y: yOf(num) + 2,
      width: CELL - 4, height: CELL - 4,
      rx: 8,
      fill: "#27325f",
      stroke: "#3a4d8a", "stroke-width": 1,
      "data-num": num,
    });
    const text = el("text", {
      x: xOf(num) + CELL / 2, y: yOf(num) + CELL / 2 + 6,
      "text-anchor": "middle",
      "font-size": 18, "font-weight": 700,
      fill: "#cdd8ff",
    });
    text.textContent = num;
    g.append(rect, text);
    svg.append(g);
  }
  return svg;
}

/* Draw the 50-chart into `container`. Returns nothing; the chart is
   rendered with `from` highlighted. Call revealJump() to show +10. */
export function renderChart50(container, { from, to, via }) {
  container.innerHTML = "";
  const svg = buildChart50Svg(`Number chart 1 to 50, ${from} highlighted`);
  // highlight the starting number
  paint(svg, from, { fill: "#ffcc33", text: "#1b244d", cls: "cell-from" });
  container.append(svg);
  // stash so revealJump can find the same svg/cells (via = the +9/+11 waypoint)
  container._chart = { svg, from, to, via };
}

/* Light up a cell by number. */
function paint(svg, num, { fill, text, cls }) {
  const rect = svg.querySelector(`rect[data-num="${num}"]`);
  if (!rect) return null;
  rect.setAttribute("fill", fill);
  if (cls) rect.classList.add(cls);
  const label = rect.nextSibling;
  if (label && text) label.setAttribute("fill", text);
  return rect;
}

/* Reveal the chart jump. The arrowhead is DIRECTION-AWARE (points along the
   segment), so one helper serves +10 / skip-10 (down) and +5 / skip-5 / `addones` (right).

   Straight skills (no `via`) reveal in ONE go. `+9` sets `via = n+10` and reveals in
   TWO PHASES like the bridge: phase 1 lands on the +10 cell (`via`) as a yellow
   LANDMARK — NOT the green answer — so a wrong/hint shows "+10 goes here" without
   leaking the total; phase 2 steps one cell to the green answer (left for +9, right for
   +11). `full=false`
   (wrong/hint) plays phase 1 only; `full=true` (a win) completes it; a wrong→win run
   lands on the miss, then steps on the win. Returns the hold time (ms), else 0. */
export function revealJump(container, { animate = true, full = false } = {}) {
  const chart = container._chart;
  if (!chart) return 0;
  const { svg, from, to, via } = chart;

  const GAP = CELL / 2 - 4;
  // a point on cell `n`'s edge, pushed toward neighbour `m` (arrows touch edges,
  // not centres, so they don't sit on the numbers)
  const edge = (n, m) => {
    const dx = Math.sign(cxOf(m) - cxOf(n)), dy = Math.sign(cyOf(m) - cyOf(n));
    return { x: cxOf(n) + dx * GAP, y: cyOf(n) + dy * GAP };
  };
  // one straight arrow a -> b with a direction-aware head at b
  const drawArrow = (a, b) => {
    const s = edge(a, b), e = edge(b, a);
    svg.append(el("polyline", {
      points: `${s.x},${s.y} ${e.x},${e.y}`, fill: "none", stroke: "#36c98b",
      "stroke-width": 4, "stroke-linecap": "round", class: "jump-arrow",
    }));
    const dx = Math.sign(cxOf(b) - cxOf(a)), dy = Math.sign(cyOf(b) - cyOf(a));
    const T = 10, S = 7, px = -dy, py = dx;
    svg.append(el("polygon", {
      points: `${e.x + px * S},${e.y + py * S} ${e.x - px * S},${e.y - py * S} ${e.x + dx * T},${e.y + dy * T}`,
      fill: "#36c98b", class: "jump-arrow",
    }));
  };
  const landAnswer = () => {
    const r = paint(svg, to, { fill: "#36c98b", text: "#0e1430", cls: "cell-to" });
    if (animate && r) r.classList.add("animate");
  };

  // ---- straight jump: one reveal, answer shown ----
  if (via == null) {
    if (svg.querySelector(".jump-arrow")) return 0;     // already drawn
    // +10 / +5 / skip / addones: a single arrow straight to the answer
    landAnswer();
    drawArrow(from, to);
    return animate ? 600 : 0;
  }

  // ---- +9 compensation: two-phase, no-leak ----
  const done = chart._phase || 0;                       // 0 nothing, 1 landed on +10, 2 complete
  const need = full ? 2 : 1;
  if (done >= need) return 0;
  let dur = 0;

  if (done < 1) {                                       // PHASE 1: down to the +10 landmark
    paint(svg, via, { fill: "#ffcc33", text: "#1b244d", cls: "cell-via" });
    drawArrow(from, via);
    chart._phase = 1;
    dur = animate ? 600 : 0;
  }
  if (full) {                                           // PHASE 2: step left to the answer
    const step = () => { landAnswer(); drawArrow(via, to); chart._phase = 2; };
    if (done < 1 && animate) { setTimeout(step, 520); dur = 520 + 600; }  // let +10 land first
    else { step(); dur = animate ? 600 : 0; }                            // reduce-motion / after a miss
  }
  return dur;
}

/* ============================================================
   Phase 2 — foundation visuals: dot patterns + ten-frames + bridge.

   Colours: yellow #ffcc33 = the original/known dots; green #36c98b
   = the dots being ADDED (the move the kid is learning). Empty cells
   are outlined so the "gap to ten" is visible.
   ============================================================ */

const YELLOW = "#ffcc33";
const GREEN = "#36c98b";

function makeSvg(w, h, label) {
  return el("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label });
}

/* ---- TEN-FRAME helpers (shared by make10 and bridge) ---- */
function drawFrame(svg, ox, oy, cell, cols = 5, rows = 2) {
  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    svg.append(el("rect", {
      x: ox + c * cell + 2, y: oy + r * cell + 2,
      width: cell - 4, height: cell - 4, rx: 8,
      fill: "#1b244d", stroke: "#3a4d8a", "stroke-width": 2,
    }));
  }
}

/* opts: { animate, delay0, step } — `step` (ms) staggers each dot so a fill
   reads left-to-right; `delay0` offsets the start (to chain frames). Used by
   make10 / plus10; the bridge has its own fly-in (see revealBridge). Returns the
   created dot nodes (teen pulses them on reveal). */
function fillCells(svg, ox, oy, cell, cols, start, count, color, opts = {}) {
  const { animate = false, delay0 = 0, step = 0 } = opts;
  const dots = [];
  for (let k = 0; k < count; k++) {
    const i = start + k, c = i % cols, r = Math.floor(i / cols);
    const dot = el("circle", {
      cx: ox + c * cell + cell / 2, cy: oy + r * cell + cell / 2,
      r: cell * 0.3, fill: color,
    });
    if (animate) {
      dot.classList.add("dot-pop");
      if (step || delay0) dot.style.animationDelay = (delay0 + k * step) + "ms";
    }
    svg.append(dot);
    dots.push(dot);
  }
  return dots;
}

/* ---- MAKE 10 (bonds): show `filled`, reveal fills the gap ---- */
export function renderTenFrame(container, { filled, goal = 10 }) {
  container.innerHTML = "";
  const cell = 54, pad = 10, cols = 5, rows = 2;
  const svg = makeSvg(pad * 2 + cols * cell, pad * 2 + rows * cell, `Ten-frame, ${filled} filled`);
  drawFrame(svg, pad, pad, cell, cols, rows);
  fillCells(svg, pad, pad, cell, cols, 0, filled, YELLOW);
  container._frame = { svg, pad, cell, cols, filled, goal };
  container.append(svg);
}

/* Fill the gap up to ten, one dot at a time. Returns the animation time
   (ms) so the caller can hold the celebration until it finishes; 0 if not animated. */
export function revealTenFrame(container, { animate = true } = {}) {
  const f = container._frame;
  if (!f || f._revealed) return 0;
  f._revealed = true;
  const count = f.goal - f.filled;       // the complement = the answer, in "added" green
  const step = animate ? 130 : 0;
  fillCells(f.svg, f.pad, f.pad, f.cell, f.cols, f.filled, count, GREEN, { animate, delay0: 0, step });
  return animate ? count * step + 320 : 0;
}

/* ---- BRIDGE THROUGH 10: two frames + a tray of `b` to place ---- */
export function renderBridge(container, { a, b }) {
  container.innerHTML = "";
  const cell = 46, pad = 10, cols = 5, rows = 2, gap = 26;
  const frameW = cols * cell, frameH = rows * cell, trayH = 46;
  const x2 = pad + frameW + gap;
  const svg = makeSvg(pad * 2 + frameW * 2 + gap, pad * 2 + frameH + trayH, `${a} plus ${b}`);

  drawFrame(svg, pad, pad, cell, cols, rows);          // frame 1: holds `a`
  fillCells(svg, pad, pad, cell, cols, 0, a, YELLOW);
  drawFrame(svg, x2, pad, cell, cols, rows);           // frame 2: the overflow

  // tray: the `b` dots waiting to be placed (green = "to add"). Full-size so they
  // match the cell dots when they fly in; keep refs + positions for the reveal.
  const trayR = cell * 0.3, trayStep = cell * 0.66, trayY = pad + frameH + 12;
  const tray = [];
  for (let k = 0; k < b; k++) {
    const x = pad + trayR + k * trayStep, y = trayY + trayR;
    const dot = el("circle", { cx: x, cy: y, r: trayR, fill: GREEN, class: "tray" });
    svg.append(dot);
    tray.push({ el: dot, x, y });
  }
  container._bridge = { svg, pad, x2, cell, cols, a, b, tray };
  container.append(svg);
}

/* Animate the bridge: the actual TRAY dots fly to their cells in two waves.
   `full=false` (wrong answer / hint) shows only PHASE 1 — fill the ten — so the
   total isn't given away; the leftover dots stay in the tray. `full=true` (a win)
   also runs PHASE 2: the remaining dots fly into frame 2. Phases are tracked, so a
   wrong→right sequence shows the ten on the miss, then completes on the win.
   Returns the animation time (ms) of what it played; 0 if not animated. */
export function revealBridge(container, { animate = true, full = false } = {}) {
  const bd = container._bridge;
  if (!bd) return 0;
  const { svg, pad, x2, cell, cols, a, b, tray } = bd;
  const gap = 10 - a;          // dots needed to finish the first ten
  const spill = a + b - 10;    // dots that overflow into frame 2
  const done = bd._phase || 0; // 0 = nothing shown, 1 = ten filled, 2 = complete
  const need = full ? 2 : 1;
  if (done >= need) return 0;

  // reduce-motion / no animation: drop the dots in place
  if (!animate) {
    if (done < 1) { tray.slice(0, gap).forEach((t) => t.el.remove()); fillCells(svg, pad, pad, cell, cols, a, gap, GREEN); }
    if (full)     { tray.slice(gap).forEach((t) => t.el.remove());   fillCells(svg, x2, pad, cell, cols, 0, spill, GREEN); }
    bd._phase = need;
    return 0;
  }

  const step = 110, flyDur = 460, phaseGap = 300, trailTail = 220;
  const GHOSTS = 5, GHOST_LAG = 26;
  const cellCenter = (ox, idx) => ({
    x: ox + (idx % cols) * cell + cell / 2,
    y: pad + Math.floor(idx / cols) * cell + cell / 2,
  });

  // send tray dot `t` to a cell, with a lagging comet trail behind it
  const launch = (t, target, delay) => {
    const dot = tray[t].el;
    const dx = target.x - tray[t].x, dy = target.y - tray[t].y;
    for (let g = 1; g <= GHOSTS; g++) {
      const ghost = el("circle", { cx: tray[t].x, cy: tray[t].y, r: cell * 0.3 * (1 - g * 0.05), fill: GREEN });
      ghost.classList.add("fly-trail");
      ghost.style.setProperty("--dx", dx + "px");
      ghost.style.setProperty("--dy", dy + "px");
      ghost.style.setProperty("--fly-dur", flyDur + "ms");
      ghost.style.setProperty("--trail-op", String(Math.max(0.12, 0.6 - g * 0.09)));
      ghost.style.animationDelay = (delay + g * GHOST_LAG) + "ms";
      svg.insertBefore(ghost, dot);          // ghosts render UNDER the lead dot
    }
    dot.classList.add("fly-to");
    dot.style.setProperty("--dx", dx + "px");
    dot.style.setProperty("--dy", dy + "px");
    dot.style.setProperty("--fly-dur", flyDur + "ms");
    dot.style.animationDelay = delay + "ms";
  };

  let dur = 0;

  // PHASE 1 — fill the ten (unless a previous wrong/hint already did)
  if (done < 1) {
    for (let t = 0; t < gap; t++) launch(t, cellCenter(pad, a + t), t * step);
    dur = (gap - 1) * step + flyDur;   // when phase 1 lands
    bd._phase = 1;
  }

  // PHASE 2 — spill into frame 2 (only on a win). If phase 1 just ran, wait for it
  // + a pause; if it was shown earlier (wrong→win), the leftovers fly in right away.
  if (full) {
    const phase2 = done < 1 ? dur + phaseGap : 0;
    for (let m = 0; m < spill; m++) launch(gap + m, cellCenter(x2, m), phase2 + m * step);
    dur = phase2 + (spill - 1) * step + flyDur;
    bd._phase = 2;
  }

  return dur + trailTail;
}

/* ============================================================
   Phase 3 — foundation visuals: number bonds + paired ten-frames.

   NUMBER BOND: a whole on top, two parts below, joined by lines. To keep
   it recognition-friendly (not abstract recall), the WHOLE shows as a
   numeral but each PART shows as DOTS. The known part is yellow; the
   missing part is a "?" that fills with green dots on reveal.

   PAIRED TEN-FRAMES (doubles / near-doubles): two frames side by side,
   each addend in its own frame. For a near-double the single extra "+1"
   dot is ringed so the one-step rule stays visible.
   ============================================================ */

/* a circle "node" of the bond diagram */
function drawBondCircle(svg, c, r) {
  svg.append(el("circle", {
    cx: c.x, cy: c.y, r,
    fill: "#27325f", stroke: "#3a4d8a", "stroke-width": 3,
  }));
}

/* a centered numeral (or "?") inside a bond circle; returns the node */
function bondNumeral(svg, c, value, fill) {
  const t = el("text", {
    x: c.x, y: c.y + 11, "text-anchor": "middle",
    "font-size": 32, "font-weight": 800, fill,
  });
  t.textContent = value;
  svg.append(t);
  return t;
}

/* up to 9 dots clustered inside a bond circle, rows centered.
   opts.animate staggers a dot-pop so the missing part flies in on reveal. */
function bondDots(svg, c, n, color, opts = {}) {
  const { animate = false, step = 0 } = opts;
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const sp = 17, dotR = 6;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, n - row * cols);     // last row may be short -> center it
    const x = c.x - ((inRow - 1) * sp) / 2 + col * sp;
    const y = c.y - ((rows - 1) * sp) / 2 + row * sp;
    const dot = el("circle", { cx: x, cy: y, r: dotR, fill: color });
    if (animate) { dot.classList.add("dot-pop"); if (step) dot.style.animationDelay = (i * step) + "ms"; }
    svg.append(dot);
  }
}

export function renderBond(container, { whole, part }) {
  container.innerHTML = "";
  const w = 300, h = 250, R = 42;
  const svg = makeSvg(w, h, `Number bond. Whole ${whole}, one part is ${part}.`);
  const wholeC = { x: w / 2, y: 54 };
  const leftC  = { x: 90,  y: 182 };
  const rightC = { x: 210, y: 182 };

  // joining lines first, so the circles sit on top of them
  for (const c of [leftC, rightC]) {
    svg.append(el("line", {
      x1: wholeC.x, y1: wholeC.y + R - 6, x2: c.x, y2: c.y - R + 6,
      stroke: "#3a4d8a", "stroke-width": 4, "stroke-linecap": "round",
    }));
  }

  drawBondCircle(svg, wholeC, R);
  bondNumeral(svg, wholeC, whole, "#cdd8ff");          // the whole = abstract numeral

  drawBondCircle(svg, leftC, R);
  bondDots(svg, leftC, part, YELLOW);                  // known part = concrete dots

  drawBondCircle(svg, rightC, R);
  const q = bondNumeral(svg, rightC, "?", YELLOW);     // missing part, until revealed

  container._bond = { svg, rightC, answer: whole - part, qText: q };
  container.append(svg);
}

/* Fill the missing part with green dots. Returns the animation time (ms)
   so the caller can hold the celebration; 0 if not animated. */
export function revealBond(container, { animate = true } = {}) {
  const bd = container._bond;
  if (!bd || bd._revealed) return 0;
  bd._revealed = true;
  if (bd.qText) bd.qText.remove();
  const step = animate ? 90 : 0;
  bondDots(bd.svg, bd.rightC, bd.answer, GREEN, { animate, step });
  return animate ? bd.answer * step + 320 : 0;
}

export function renderPairFrame(container, { a, b }) {
  container.innerHTML = "";
  const cell = 46, pad = 10, cols = 5, rows = 2, gap = 30, capH = 56;
  const frameW = cols * cell, frameH = rows * cell;
  const x2 = pad + frameW + gap;
  const w = pad * 2 + frameW * 2 + gap;
  const h = pad * 2 + frameH + capH;            // extra room for the running-total caption
  const svg = makeSvg(w, h, `${a} and ${b}`);

  drawFrame(svg, pad, pad, cell, cols, rows);   // frame 1: first addend (known)
  drawFrame(svg, x2, pad, cell, cols, rows);    // frame 2: second addend (added)

  // place one dot and hand back the node, so the reveal can pulse specific groups
  const dotAt = (ox, i, color) => {
    const c = i % cols, r = Math.floor(i / cols);
    const dot = el("circle", {
      cx: ox + c * cell + cell / 2, cy: pad + r * cell + cell / 2,
      r: cell * 0.3, fill: color,
    });
    svg.append(dot);
    return dot;
  };

  // frame 1 = the first addend; frame 2's first `a` = the matching half of the double
  const left = [], matched = [];
  for (let i = 0; i < a; i++) left.push(dotAt(pad, i, YELLOW));
  for (let i = 0; i < a; i++) matched.push(dotAt(x2, i, GREEN));

  // near-double: draw the "+1" slot as an EMPTY ring; its dot fills in only on a win
  // (so an incorrect answer never completes the pattern for her). The reveal fills
  // frame 2 cells `a..b-1` into this ring.
  let ring = null;
  if (b > a) {
    const i = a, c = i % cols, r = Math.floor(i / cols);
    ring = el("circle", {
      cx: x2 + c * cell + cell / 2, cy: pad + r * cell + cell / 2,
      r: cell * 0.42, fill: "none", stroke: YELLOW, "stroke-width": 3,
    });
    svg.append(ring);
  }

  // running-total caption, centered under the frames (empty until the reveal)
  const cap = el("text", {
    x: w / 2, y: pad + frameH + 38, "text-anchor": "middle",
    "font-size": 34, "font-weight": 800, fill: "#cdd8ff",
  });
  svg.append(cap);

  container._pair = { svg, x2, pad, cell, cols, a, b, left, matched, ring, cap, double: a + a, answer: a + b };
  container.append(svg);
}

/* Enact the strategy on screen (like the bridge reveal does its own trick).

   NEAR-DOUBLES — two-phase, _phase-tracked, no-leak:
     PHASE A pulses BOTH equal groups and shows the double (2a);
     PHASE B (win only) pulses the "+1" dot and updates the total to the answer.
   `full=false` (hint/wrong) plays PHASE A only — shows 2a (a strategy hint, not
   the answer 2a+1); a wrong→win run shows the double on the miss, the +1 on the win.

   PURE DOUBLES — single reveal: the dots stay countable, but the NUMBER is shown
   ONLY on a win. A hint/wrong just pulses the two equal groups (no digit), so an
   incorrect answer never hands over the total (2a IS the answer here).

   The near-double "+1" dot fills its empty ring ONLY in PHASE B (the win), so a
   wrong/hint shows the double but leaves the slot open.

   Returns the animation time (ms) so the caller can hold the celebration; 0 if not animated. */
export function revealPairFrame(container, { animate = true, full = false } = {}) {
  const pf = container._pair;
  if (!pf) return 0;
  const { svg, x2, pad, cell, cols, a, b, left, matched, ring, cap, double, answer } = pf;

  // re-add the pop class with a forced reflow, so a node can pulse more than once
  const pop = (node) => {
    if (!node) return;
    node.classList.remove("dot-pop");
    node.getBoundingClientRect();            // flush layout to restart the animation
    node.classList.add("dot-pop");
  };

  // ---- PURE DOUBLES: show the digit ONLY on a win; otherwise just pulse the groups ----
  if (b === a) {
    if (full && pf._done) return 0;          // don't replay a finished win
    if (!animate) { if (full) { cap.textContent = answer; pf._done = true; } return 0; }
    [...left, ...matched].forEach(pop);      // pulse the two equal groups
    if (!full) return 320 + 150;             // hint/wrong: pulse only, NO number revealed
    setTimeout(() => { cap.textContent = answer; pop(cap); }, 240);
    pf._done = true;
    return 560 + 150;
  }

  // ---- NEAR-DOUBLES: two-phase, no-leak (2a is a hint, not the answer) ----
  const done = pf._phase || 0;               // 0 nothing, 1 double shown, 2 complete
  const need = full ? 2 : 1;
  if (done >= need) return 0;
  const fillExtra = (animate) => fillCells(svg, x2, pad, cell, cols, a, b - a, GREEN, { animate });

  if (!animate) {
    if (need >= 2) { fillExtra(false); cap.textContent = answer; }   // win → fill the +1 + total
    else cap.textContent = double;                                   // hint → double only, ring stays open
    pf._phase = need;
    return 0;
  }

  const GAP = 250, PHASE = 560;              // PHASE ≈ dot pop (320) + caption pop
  let dur = 0;

  if (done < 1) {                            // PHASE A — "it's a double" (ring stays empty)
    [...left, ...matched].forEach(pop);
    setTimeout(() => { cap.textContent = double; pop(cap); }, 240);
    dur = PHASE;
    pf._phase = 1;
  }

  if (full) {                               // PHASE B — the "+1" dot drops into the ring
    const start = done < 1 ? dur + GAP : 0;
    setTimeout(() => { fillExtra(true); pop(ring); }, start);
    setTimeout(() => { cap.textContent = answer; pop(cap); }, start + 180);
    dur = start + PHASE;
    pf._phase = 2;
  }

  return dur + 150;
}

/* ============================================================
   EXPANDED-FORM place value (addtens): tens combine, then ones, comet fly-in.

   The PROBLEM is intentionally EMPTY — she mentally converts the horizontal prompt
   (18 + 20 = ?) to a vertical sum and solves it; nothing is pre-shown. The reveal is
   TWO-PHASE (tracked on `_phase`): a WRONG/hint draws the worked vertical sum + each
   addend's breakdown (18 = 10 + 8, 20 = 20 + 0) but HIDES the combined columns and
   the final answer — she sees the place values yet must still compose 38 herself. The
   CORRECT answer combines the columns: the FINAL tens (30) comets straight down into
   the result, then the final ones (8), then 38 appears (the final value flies in, so
   nothing is shown then swapped). The breakdown uses the REAL VALUES
   (10, 20), never bare digits (1, 2) — so "the tens combine" stays place-value-honest
   instead of teaching digit-pushing. Copies do the flying, so the addend rows stay
   intact. The empty problem-state SVG stays SIZED so the reveal doesn't shift layout.
   ============================================================ */
const expandGeo = { labelX: 44, eqX: 86, tensX: 140, plusX: 196, onesX: 250, rowY: [46, 102, 172], divY: 136 };

function expandText(x, y, val, size, color, weight = 800) {
  const t = el("text", { x, y, "text-anchor": "middle", "font-size": size, "font-weight": weight, fill: color });
  t.textContent = String(val);
  return t;
}

/* a place-value tile: rounded rect + the value, coloured by place (tens / ones) */
function expandTile(svg, x, y, val, color) {
  const w = 50, h = 38, g = el("g");
  g.append(
    el("rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 9, fill: "#27325f", stroke: color, "stroke-width": 2.5 }),
    expandText(x, y + 7, val, 20, color)
  );
  svg.append(g);
  return g;
}

export function renderExpand(container, { base, add }) {
  container.innerHTML = "";
  // PROBLEM STATE: intentionally EMPTY. She mentally converts the horizontal prompt
  // (18 + 20 = ?) into a vertical sum and solves it — no stacked equation, no
  // breakdown shown. The empty sized SVG just RESERVES the box so the reveal (which
  // draws the whole worked form) doesn't shift the layout below it.
  const svg = makeSvg(360, 210, `${base} plus ${add}`);
  const baseT = base - base % 10, baseO = base % 10;
  const addT = add - add % 10, addO = add % 10;             // addO is 0 for addtens
  const answer = base + add, ansT = baseT + addT, ansO = baseO + addO;
  container._expand = { svg, geo: expandGeo, base, add, baseT, baseO, addT, addO, answer, ansT, ansO };
  container.append(svg);
}

/* Reveal (the whole lesson): draw the worked VERTICAL sum with its place-value
   breakdown (18 = 10 + 8 over 20 = 20 + 0), then on a WIN comet COPIES of the tens
   together (10+20→30), then the ones (8+0→8), trailing stars, and assemble the
   answer. Flying copies keep the addend rows intact. Wrong/hint/reduce-motion just
   show the worked form + result, no comet. Returns ms, else 0. */
export function revealExpand(container, { animate = true, full = false } = {}) {
  const ex = container._expand;
  if (!ex) return 0;
  const { svg, geo, base, add, baseT, baseO, addT, addO, answer, ansT, ansO } = ex;
  const { labelX, eqX, tensX, plusX, onesX, rowY, divY } = geo;
  const ry = rowY[2];
  const done = ex._phase || 0;                 // 0 nothing, 1 breakdown shown, 2 answer revealed
  const need = full ? 2 : 1;
  if (done >= need) return 0;

  // PHASE 1 — worked vertical sum + each addend's tens/ones breakdown. Shown on a
  // WRONG/hint too (she sees the place values), but the combined columns + final
  // answer stay hidden until she gets it right.
  if (done < 1) {
    const row = (y, num, tVal, oVal, withPlus) => {
      if (withPlus) svg.append(expandText(labelX - 30, y + 8, "+", 24, "#9fb0d8", 700));
      svg.append(expandText(labelX, y + 8, num, 26, "#f4f7ff"));
      svg.append(expandText(eqX, y + 7, "=", 22, "#9fb0d8", 700));
      expandTile(svg, tensX, y, tVal, YELLOW);              // these stay put; copies fly
      svg.append(expandText(plusX, y + 7, "+", 22, "#9fb0d8", 700));
      expandTile(svg, onesX, y, oVal, GREEN);
    };
    row(rowY[0], base, baseT, baseO, false);
    row(rowY[1], add, addT, addO, true);
    svg.append(el("line", { x1: labelX - 22, y1: divY, x2: onesX + 32, y2: divY, stroke: "#3a4d8a", "stroke-width": 3, "stroke-linecap": "round" }));
    ex._phase = 1;
  }

  if (!full) return 0;     // wrong/hint stops here: breakdown shown, answer withheld

  // PHASE 2 (correct answer) — combine the columns (tens→30, ones→8), reveal the answer
  const finishRow = () => {
    svg.append(expandText(eqX, ry + 7, "=", 22, "#9fb0d8", 700));
    svg.append(expandText(plusX, ry + 7, "+", 22, "#9fb0d8", 700));
    svg.append(expandText(labelX, ry + 8, answer, 26, GREEN));   // the answer, in green
  };

  if (!animate) {          // reduce-motion / demo: assemble instantly
    expandTile(svg, tensX, ry, ansT, YELLOW);
    expandTile(svg, onesX, ry, ansO, GREEN);
    finishRow();
    ex._phase = 2;
    return 0;
  }

  // Comet the FINAL combined values straight into the result row: 30 (tens), then 8
  // (ones). Flying the FINAL value — not the addends — so nothing is shown then
  // swapped. Each tile is created at fly-time below the divider and lands in place.
  const STARS = 5, LAG = 28, FLY = 520, GAP = 220, DECOMP = 420;
  const lead = done < 1 ? DECOMP : 120;        // let a brand-new breakdown register first
  const srcY = geo.divY + 6;                   // launch just below the divider, clear of row 2
  const flyIn = (x, val, color, delay) => {
    setTimeout(() => {
      const tile = expandTile(svg, x, srcY, val, color);
      const dy = ry - srcY;
      for (let s = 1; s <= STARS; s++) {
        const star = expandText(x, srcY, "✦", 13, color, 700);
        star.classList.add("fly-trail");
        star.style.setProperty("--dx", "0px");
        star.style.setProperty("--dy", dy + "px");
        star.style.setProperty("--fly-dur", FLY + "ms");
        star.style.setProperty("--trail-op", String(Math.max(0.15, 0.7 - s * 0.1)));
        star.style.animationDelay = (s * LAG) + "ms";
        svg.insertBefore(star, tile);          // stars render under the flying tile
      }
      tile.classList.add("fly-to");            // the tile IS the result; it lands and stays
      tile.style.setProperty("--dx", "0px");
      tile.style.setProperty("--dy", dy + "px");
      tile.style.setProperty("--fly-dur", FLY + "ms");
    }, delay);
  };

  flyIn(tensX, ansT, YELLOW, lead);                      // 30 flies into the tens slot
  flyIn(onesX, ansO, GREEN, lead + FLY + GAP);           // then 8 into the ones slot
  setTimeout(finishRow, lead + FLY + GAP + FLY);         // "= 38" once the ones land

  ex._phase = 2;
  return lead + FLY + GAP + FLY + 340;
}

/* Two ten-frames side by side, for group-addition (subitize): recognise each
   quantity 1–9 via the five-structure, then add. Frame 1 yellow, frame 2 green, a
   "+" between. Ten-frames (not dice) so addends 7/8/9 show as a single graphic. */
export function renderTwoFrames(container, { a, b, emphasize }) {
  container.innerHTML = "";
  const cell = 46, pad = 10, cols = 5, rows = 2, gap = 44;
  const frameW = cols * cell, frameH = rows * cell, x2 = pad + frameW + gap;
  const svg = makeSvg(pad * 2 + frameW * 2 + gap, pad * 2 + frameH, `${a} and ${b}`);
  // each frame in its own group, so the two-part exercise can dim the one she isn't naming
  const g1 = el("g"), g2 = el("g");
  drawFrame(g1, pad, pad, cell, cols, rows);
  fillCells(g1, pad, pad, cell, cols, 0, a, YELLOW);
  drawFrame(g2, x2, pad, cell, cols, rows);
  fillCells(g2, x2, pad, cell, cols, 0, b, GREEN);
  if (emphasize === "left")  g2.setAttribute("opacity", "0.22");
  if (emphasize === "right") g1.setAttribute("opacity", "0.22");
  svg.append(g1, g2);
  const plus = el("text", {
    x: pad + frameW + gap / 2, y: pad + frameH / 2 + 11,
    "text-anchor": "middle", "font-size": 34, "font-weight": 800, fill: "#9fb0d8",
  });
  plus.textContent = "+";
  svg.append(plus);
  container.append(svg);
}

/* ============================================================
   TEEN place value (teen, "Beat the Flip"): a teen = a FULL ten + some ones, and the
   point is the WRITTEN form (write the ten first → it starts with 1; the flip 13/31 is
   the trap). So the ten is drawn as ONE UNIT (a full frame inside a dashed band — read
   it as "a ten", don't count it) and the ones as LOOSE dots (countable). That contrast
   IS the unitizing lesson. The head band on top is empty during the problem; on a WIN
   the reveal pops the answer's two digits into their PLACES — "1" (yellow) over the ten,
   the ones-digit (green) over the ones — left-to-right, the written order. A quantity
   visual, so showing the dots is the externalization; the DIGITS (the bit she must get
   right) stay hidden until the win, so a wrong tap doesn't leak the order.
   ============================================================ */
export function renderTeenFrame(container, { ones }) {
  container.innerHTML = "";
  const cell = 46, pad = 10, cols = 5, rows = 2, gap = 50, headH = 52;
  const frameW = cols * cell, frameH = rows * cell;
  const x1 = pad, x2 = pad + frameW + gap;
  const top = pad + headH;                       // frames sit below the reserved head band
  const w = pad * 2 + frameW * 2 + gap;
  const h = top + frameH + pad;
  const svg = makeSvg(w, h, `A full ten and ${ones} ones`);

  // frame 1 = the full ten, banded as ONE unit (don't count it — it is "a ten")
  svg.append(el("rect", {
    x: x1 - 5, y: top - 5, width: frameW + 10, height: frameH + 10, rx: 12,
    fill: "none", stroke: YELLOW, "stroke-width": 3, "stroke-dasharray": "7 5", opacity: 0.8,
  }));
  const g1 = el("g");
  drawFrame(g1, x1, top, cell, cols, rows);
  const tenDots = fillCells(g1, x1, top, cell, cols, 0, 10, YELLOW);
  svg.append(g1);

  // frame 2 = the loose ones (green, countable)
  const g2 = el("g");
  drawFrame(g2, x2, top, cell, cols, rows);
  const oneDots = fillCells(g2, x2, top, cell, cols, 0, ones, GREEN);
  svg.append(g2);

  // "+" between the ten-unit and the ones
  const plus = el("text", {
    x: pad + frameW + gap / 2, y: top + frameH / 2 + 11,
    "text-anchor": "middle", "font-size": 34, "font-weight": 800, fill: "#9fb0d8",
  });
  plus.textContent = "+";
  svg.append(plus);

  container._teen = {
    svg, ones, dots: [...tenDots, ...oneDots],
    tensDigitX: x1 + frameW / 2,                 // "1" lands centred over the ten
    onesDigitX: x2 + frameW / 2,                 // the ones-digit centred over the ones
    digitY: pad + headH / 2 + 14,
  };
  container.append(svg);
}

/* Pulse the ten and the ones; on a WIN pop the two digits into their places (ten-digit
   first — it is written first). `full=false` (hint/wrong) pulses the dots only and never
   draws the digits, so the digit ORDER (the thing being tested) is not leaked on a miss.
   Returns the animation time (ms); 0 if not animated. */
export function revealTeenFrame(container, { animate = true, full = false } = {}) {
  const tf = container._teen;
  if (!tf || tf._done) return 0;
  const { svg, ones, dots, tensDigitX, onesDigitX, digitY } = tf;

  const drawDigit = (x, val, color, pop) => {
    const t = el("text", {
      x, y: digitY, "text-anchor": "middle", "font-size": 42, "font-weight": 800, fill: color,
    });
    t.textContent = val;
    if (pop) t.classList.add("dot-pop");
    svg.append(t);
  };

  if (!animate) {
    if (full) { drawDigit(tensDigitX, "1", YELLOW); drawDigit(onesDigitX, String(ones), GREEN); tf._done = true; }
    return 0;
  }

  // re-add the pop class with a forced reflow so a dot can pulse even if already drawn
  const pop = (node) => {
    if (!node) return;
    node.classList.remove("dot-pop");
    node.getBoundingClientRect();
    node.classList.add("dot-pop");
  };
  dots.forEach(pop);                            // pulse the ten and the ones
  if (!full) return 320 + 150;                  // hint/wrong: pulse only, digits withheld
  setTimeout(() => drawDigit(tensDigitX, "1", YELLOW, true), 200);    // the ten is written first
  setTimeout(() => drawDigit(onesDigitX, String(ones), GREEN, true), 460);
  tf._done = true;
  return 460 + 320 + 150;
}

/* ============================================================
   Dispatchers — app.js talks to these; they route by visual.type
   so the engine never needs to know which skill is playing.
   ============================================================ */
export function renderVisual(container, visual) {
  if (!visual) { container.innerHTML = ""; return; }   // no-visual skill (pure mental math)
  switch (visual.type) {
    case "chart50":   return renderChart50(container, visual);
    case "tenframe":  return renderTenFrame(container, visual);
    case "bridge":    return renderBridge(container, visual);
    case "bond":      return renderBond(container, visual);
    case "pairframe": return renderPairFrame(container, visual);
    case "expand":    return renderExpand(container, visual);
    case "twoframes": return renderTwoFrames(container, visual);
    case "teen":      return renderTeenFrame(container, visual);
  }
}

/* Returns the reveal's animation duration in ms (0 for instant reveals),
   so app.js can keep the celebration on screen until the fill completes. */
export function revealVisual(container, visual, opts = {}) {
  if (!visual) return 0;                               // no-visual skill: nothing to reveal
  switch (visual.type) {
    case "chart50":   return revealJump(container, opts) || 0;
    case "tenframe":  return revealTenFrame(container, opts) || 0;
    case "bridge":    return revealBridge(container, opts) || 0;
    case "bond":      return revealBond(container, opts) || 0;
    case "pairframe": return revealPairFrame(container, opts) || 0;
    case "expand":    return revealExpand(container, opts) || 0;
    case "twoframes": renderTwoFrames(container, visual); return 0;   // re-show the frames to count
    case "teen":      return revealTeenFrame(container, opts) || 0;
  }
  return 0;
}
