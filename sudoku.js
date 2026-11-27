'use strict';
/* Sudoku core — solver, generator, human-style grader, hint finder,
   symmetry transforms. No DOM. Loaded by the page (window.Sudoku) and by the
   Node tools (require). A grid is an array of 81 ints, 0 = empty. */
(function (root) {

  /* ---------- geometry ---------- */
  const ROW = [], COL = [], BOX = [];
  const UNITS = [];            // 27 units: 0-8 rows, 9-17 cols, 18-26 boxes
  const UNITS_OF = [];         // the 3 unit ids each cell belongs to
  const PEERS = [];            // 20 peers per cell
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9;
    ROW[i] = r; COL[i] = c; BOX[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
  }
  for (let u = 0; u < 27; u++) UNITS.push([]);
  for (let i = 0; i < 81; i++) {
    UNITS[ROW[i]].push(i); UNITS[9 + COL[i]].push(i); UNITS[18 + BOX[i]].push(i);
    UNITS_OF[i] = [ROW[i], 9 + COL[i], 18 + BOX[i]];
  }
  for (let i = 0; i < 81; i++) {
    const s = new Set();
    for (const u of UNITS_OF[i]) for (const j of UNITS[u]) if (j !== i) s.add(j);
    PEERS[i] = [...s];
  }

  const ALL = 0x1ff;
  const bit = d => 1 << (d - 1);
  const pc = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const digitsOf = m => { const out = []; for (let d = 1; d <= 9; d++) if (m & bit(d)) out.push(d); return out; };
  const lowDigit = m => 32 - Math.clz32(m & -m); // single-bit mask -> digit

  /* ---------- PRNG ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- (de)serialisation ---------- */
  const parse = s => Array.from(s, ch => (ch >= '1' && ch <= '9') ? ch.charCodeAt(0) - 48 : 0);
  const stringify = g => g.map(v => v || '.').join('');

  /* ---------- exact solver (bitmask backtracking, MRV) ---------- */
  function solve(grid, limit = 2, rng = null) {
    const g = Array.from(grid);
    const rm = new Array(9).fill(0), cm = new Array(9).fill(0), bm = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) {
      const v = g[i]; if (!v) continue;
      const b = bit(v);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & b) return { count: 0, solution: null };
      rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOX[i]] |= b;
    }
    let count = 0, solution = null;
    const rec = () => {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ~(rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & ALL;
        const n = pc(m);
        if (n === 0) return false;
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
      }
      if (best < 0) { count++; if (!solution) solution = g.slice(); return count >= limit; }
      let ds = digitsOf(bestMask);
      if (rng) shuffle(ds, rng);
      const r = ROW[best], c = COL[best], x = BOX[best];
      for (const d of ds) {
        const b = bit(d);
        g[best] = d; rm[r] |= b; cm[c] |= b; bm[x] |= b;
        const stop = rec();
        g[best] = 0; rm[r] &= ~b; cm[c] &= ~b; bm[x] &= ~b;
        if (stop) return true;
      }
      return false;
    };
    rec();
    return { count, solution };
  }

  const fullGrid = rng => solve(new Array(81).fill(0), 1, rng).solution;

  /* Remove clues (in 180°-symmetric pairs) while the solution stays unique,
     never going below minGivens. */
  function carve(solution, rng, minGivens = 17) {
    const p = solution.slice();
    let givens = 81;
    const order = shuffle([...Array(41).keys()], rng);  // 0..40; 40 is the centre
    for (const i of order) {
      const j = 80 - i;
      const n = i === j ? 1 : 2;
      if (givens - n < minGivens) continue;
      const a = p[i], b = p[j];
      p[i] = 0; p[j] = 0;
      if (solve(p, 2).count !== 1) { p[i] = a; p[j] = b; }
      else givens -= n;
    }
    return p;
  }

  /* ---------- human-style logical solver ----------
     Applies techniques cheapest-first and records the hardest one needed.
     tier 1 singles · tier 2 locked candidates, pairs, triples ·
     tier 3 fish, wings, quads · tier 4 stuck (needs chains/guessing). */
  const TIER = {
    'naked single': 1, 'hidden single': 1,
    'pointing': 2, 'claiming': 2, 'naked pair': 2, 'hidden pair': 2,
    'naked triple': 2, 'hidden triple': 2,
    'x-wing': 3, 'swordfish': 3, 'xy-wing': 3, 'xyz-wing': 3,
    'naked quad': 3, 'hidden quad': 3, 'jellyfish': 3,
  };

  function makeState(grid) {
    const g = Array.from(grid);
    const cand = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let m = ALL;
      for (const j of PEERS[i]) if (g[j]) m &= ~bit(g[j]);
      cand[i] = m;
    }
    return { g, cand };
  }

  function place(st, i, d) {
    st.g[i] = d; st.cand[i] = 0;
    const b = bit(d);
    for (const j of PEERS[i]) st.cand[j] &= ~b;
  }

  // returns {i, d, unit} or null
  function findNakedSingle(st) {
    for (let i = 0; i < 81; i++) {
      if (!st.g[i] && pc(st.cand[i]) === 1) return { i, d: lowDigit(st.cand[i]), unit: -1 };
    }
    return null;
  }
  // boxes first — that's how people scan
  const HS_ORDER = [...Array(9).keys()].map(x => 18 + x).concat([...Array(18).keys()]);
  function findHiddenSingle(st) {
    for (const u of HS_ORDER) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d); let where = -1, n = 0;
        for (const i of UNITS[u]) {
          if (st.g[i] === d) { n = 99; break; }
          if (st.cand[i] & b) { n++; where = i; }
        }
        if (n === 1) return { i: where, d, unit: u };
      }
    }
    return null;
  }

  function eliminate(st, cells, mask) {
    let changed = false;
    for (const i of cells) if (st.cand[i] & mask) { st.cand[i] &= ~mask; changed = true; }
    return changed;
  }

  function lockedCandidates(st) {
    // pointing: within a box, digit confined to one row/col -> remove from rest of that line
    for (let x = 0; x < 9; x++) {
      const box = UNITS[18 + x];
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        const cells = box.filter(i => st.cand[i] & b);
        if (cells.length < 2) continue;
        const rows = new Set(cells.map(i => ROW[i])), cols = new Set(cells.map(i => COL[i]));
        if (rows.size === 1) {
          const line = UNITS[ROW[cells[0]]].filter(i => BOX[i] !== x);
          if (eliminate(st, line, b)) return 'pointing';
        }
        if (cols.size === 1) {
          const line = UNITS[9 + COL[cells[0]]].filter(i => BOX[i] !== x);
          if (eliminate(st, line, b)) return 'pointing';
        }
      }
    }
    // claiming: within a line, digit confined to one box -> remove from rest of box
    for (let u = 0; u < 18; u++) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        const cells = UNITS[u].filter(i => st.cand[i] & b);
        if (cells.length < 2) continue;
        const boxes = new Set(cells.map(i => BOX[i]));
        if (boxes.size === 1) {
          const x = BOX[cells[0]];
          const rest = UNITS[18 + x].filter(i => !UNITS[u].includes(i));
          if (eliminate(st, rest, b)) return 'claiming';
        }
      }
    }
    return null;
  }

  function combos(arr, k, start = 0, acc = [], out = []) {
    if (acc.length === k) { out.push(acc.slice()); return out; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
    return out;
  }

  const SUBSET_NAME = { 2: 'pair', 3: 'triple', 4: 'quad' };
  function nakedSubset(st, k) {
    for (let u = 0; u < 27; u++) {
      const empt = UNITS[u].filter(i => !st.g[i]);
      const small = empt.filter(i => pc(st.cand[i]) <= k);
      if (empt.length <= k || small.length < k) continue;
      for (const set of combos(small, k)) {
        let m = 0; for (const i of set) m |= st.cand[i];
        if (pc(m) !== k) continue;
        if (eliminate(st, empt.filter(i => !set.includes(i)), m)) return 'naked ' + SUBSET_NAME[k];
      }
    }
    return null;
  }

  function hiddenSubset(st, k) {
    for (let u = 0; u < 27; u++) {
      const empt = UNITS[u].filter(i => !st.g[i]);
      if (empt.length <= k) continue;
      const placed = new Set(UNITS[u].map(i => st.g[i]).filter(Boolean));
      const ds = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !placed.has(d));
      const pos = {};
      for (const d of ds) pos[d] = empt.filter(i => st.cand[i] & bit(d));
      const eligible = ds.filter(d => pos[d].length >= 1 && pos[d].length <= k);
      for (const set of combos(eligible, k)) {
        const cells = new Set(); for (const d of set) for (const i of pos[d]) cells.add(i);
        if (cells.size !== k) continue;
        let keep = 0; for (const d of set) keep |= bit(d);
        let changed = false;
        for (const i of cells) if (st.cand[i] & ~keep) { st.cand[i] &= keep; changed = true; }
        if (changed) return 'hidden ' + SUBSET_NAME[k];
      }
    }
    return null;
  }

  const FISH_NAME = { 2: 'x-wing', 3: 'swordfish', 4: 'jellyfish' };
  function fish(st, k) {
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      for (const byRow of [true, false]) {
        const base = [];
        for (let l = 0; l < 9; l++) {
          const u = byRow ? l : 9 + l;
          const cells = UNITS[u].filter(i => st.cand[i] & b);
          if (cells.length >= 2 && cells.length <= k) base.push({ l, cross: cells.map(i => byRow ? COL[i] : ROW[i]) });
        }
        if (base.length < k) continue;
        for (const set of combos(base, k)) {
          const cross = new Set(); for (const s of set) for (const c of s.cross) cross.add(c);
          if (cross.size !== k) continue;
          const lines = new Set(set.map(s => s.l));
          const victims = [];
          for (const c of cross) {
            for (const i of UNITS[byRow ? 9 + c : c]) {
              if (!lines.has(byRow ? ROW[i] : COL[i])) victims.push(i);
            }
          }
          if (eliminate(st, victims, b)) return FISH_NAME[k];
        }
      }
    }
    return null;
  }

  const sees = (a, b) => a !== b && (ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b]);

  function xyWing(st) {
    const bivalue = [];
    for (let i = 0; i < 81; i++) if (!st.g[i] && pc(st.cand[i]) === 2) bivalue.push(i);
    for (const p of bivalue) {
      const pm = st.cand[p];
      const wings = bivalue.filter(w => sees(p, w) && pc(st.cand[w] & pm) === 1);
      for (let a = 0; a < wings.length; a++) {
        for (let c = a + 1; c < wings.length; c++) {
          const w1 = wings[a], w2 = wings[c];
          const m1 = st.cand[w1], m2 = st.cand[w2];
          const z = m1 & m2 & ~pm;
          if (pc(z) !== 1) continue;
          if ((m1 & pm) === (m2 & pm)) continue;
          if (((m1 | m2) & ~z) !== pm) continue;
          const victims = [];
          for (let i = 0; i < 81; i++) if (i !== w1 && i !== w2 && i !== p && sees(i, w1) && sees(i, w2)) victims.push(i);
          if (eliminate(st, victims, z)) return 'xy-wing';
        }
      }
    }
    return null;
  }

  function xyzWing(st) {
    for (let p = 0; p < 81; p++) {
      if (st.g[p] || pc(st.cand[p]) !== 3) continue;
      const pm = st.cand[p];
      const wings = PEERS[p].filter(w => !st.g[w] && pc(st.cand[w]) === 2 && (st.cand[w] & ~pm) === 0);
      for (let a = 0; a < wings.length; a++) {
        for (let c = a + 1; c < wings.length; c++) {
          const w1 = wings[a], w2 = wings[c];
          if (st.cand[w1] === st.cand[w2]) continue;
          const z = st.cand[w1] & st.cand[w2];
          if (pc(z) !== 1 || (st.cand[w1] | st.cand[w2]) !== pm) continue;
          const victims = [];
          for (let i = 0; i < 81; i++) if (i !== p && i !== w1 && i !== w2 && sees(i, p) && sees(i, w1) && sees(i, w2)) victims.push(i);
          if (eliminate(st, victims, z)) return 'xyz-wing';
        }
      }
    }
    return null;
  }

  const ELIMINATORS = [
    lockedCandidates,
    st => nakedSubset(st, 2), st => hiddenSubset(st, 2),
    st => nakedSubset(st, 3), st => hiddenSubset(st, 3),
    st => fish(st, 2), xyWing, xyzWing, st => fish(st, 3),
    st => nakedSubset(st, 4), st => hiddenSubset(st, 4), st => fish(st, 4),
  ];

  function grade(grid) {
    const st = makeState(grid);
    const used = {};
    let tier = 0;
    const note = t => { used[t] = (used[t] || 0) + 1; tier = Math.max(tier, TIER[t]); };
    for (;;) {
      if (st.g.every(Boolean)) break;
      const s = findNakedSingle(st) || findHiddenSingle(st);
      if (s) { place(st, s.i, s.d); note(s.unit < 0 ? 'naked single' : 'hidden single'); continue; }
      let t = null;
      for (const f of ELIMINATORS) { t = f(st); if (t) break; }
      if (t) { note(t); continue; }
      tier = 4; break;
    }
    return { tier, solved: st.g.every(Boolean), used, givens: grid.filter(Boolean).length };
  }

  /* ---------- difficulty bins ---------- */
  function classify(gr) {
    if (gr.tier <= 1 && gr.givens >= 36) return 'easy';
    if (gr.tier <= 1 && gr.givens <= 32) return 'medium';
    if (gr.tier === 2 && gr.givens <= 30) return 'hard';
    if (gr.tier >= 3) return 'extreme';
    return null;
  }

  // Make one puzzle of the requested level, or null if this attempt missed.
  function generate(level, rng) {
    const sol = fullGrid(rng);
    const min = level === 'easy' ? 36 + ((rng() * 4) | 0)
      : level === 'medium' ? 28 + ((rng() * 3) | 0) : 17;
    const p = carve(sol, rng, min);
    const gr = grade(p);
    return classify(gr) === level ? { puzzle: p, grade: gr } : null;
  }

  /* ---------- validity-preserving transforms ----------
     Digit relabel (9!), band/stack order (3!·3!), rows within bands and
     columns within stacks (3!^6), transpose (2) — ~1.2e12 variants of each
     puzzle, all with the same difficulty. */
  function transform(grid, rng) {
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    const lines = () => {
      const out = [];
      for (const band of shuffle([0, 1, 2], rng)) for (const r of shuffle([0, 1, 2], rng)) out.push(band * 3 + r);
      return out;
    };
    const rows = lines(), cols = lines();
    const flip = rng() < 0.5;
    const out = new Array(81);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const sr = rows[r], sc = cols[c];
      const v = flip ? grid[sc * 9 + sr] : grid[sr * 9 + sc];
      out[r * 9 + c] = v ? digits[v - 1] : 0;
    }
    return out;
  }

  /* ---------- hints for the player ----------
     values: what's on the board right now (wrong entries are ignored).
     Returns the easiest single available, preferring the selected cell. */
  function findHint(values, solution, prefer = -1) {
    const clean = values.map((v, i) => (v && v === solution[i]) ? v : 0);
    const st = makeState(clean);
    const empties = [];
    for (let i = 0; i < 81; i++) if (!clean[i]) empties.push(i);
    if (!empties.length) return null;
    // the selected cell, if it has a single answer by simple logic
    if (prefer >= 0 && !clean[prefer]) {
      if (pc(st.cand[prefer]) === 1) return { i: prefer, d: solution[prefer], kind: 'naked', unit: -1 };
      for (const u of UNITS_OF[prefer]) {
        const d = solution[prefer], b = bit(d);
        if (UNITS[u].filter(i => st.cand[i] & b).length === 1) return { i: prefer, d, kind: 'hidden', unit: u };
      }
    }
    const hs = findHiddenSingle(st);
    if (hs) return { i: hs.i, d: hs.d, kind: 'hidden', unit: hs.unit };
    const ns = findNakedSingle(st);
    if (ns) return { i: ns.i, d: ns.d, kind: 'naked', unit: -1 };
    const i = (prefer >= 0 && !clean[prefer]) ? prefer : empties[0];
    return { i, d: solution[i], kind: 'reveal', unit: -1 };
  }

  const api = {
    ROW, COL, BOX, UNITS, UNITS_OF, PEERS, bit, pc, digitsOf,
    mulberry32, hashString, shuffle, parse, stringify,
    solve, fullGrid, carve, grade, classify, generate, transform, findHint,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sudoku = api;
})(typeof self !== 'undefined' ? self : this);
