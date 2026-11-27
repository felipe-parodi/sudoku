// Engine checks: uniqueness, grader soundness, level bins, transforms, daily determinism.
// node tools/test/engine.test.js [N]
const S = require('../../sudoku.js');
const N = +(process.argv[2] || 150);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } };

// Soundness: every placement the grader's logic makes must match the true solution.
function soundGrade(p) {
  const truth = S.solve(p, 1).solution;
  const gr = S.grade(p);
  return { gr, truth };
}
const rng = S.mulberry32(12345);
const times = {};
for (const lv of ['easy', 'medium', 'hard', 'extreme']) {
  const t0 = Date.now(); let worst = 0;
  for (let k = 0; k < N; k++) {
    const t1 = Date.now(); let r = null;
    while (!r) r = S.generate(lv, rng);
    worst = Math.max(worst, Date.now() - t1);
    const p = r.puzzle;
    ok(S.solve(p, 2).count === 1, `${lv}: not unique`);
    ok(S.classify(S.grade(p), S.grade(p, { scanOnly: true }).solved) === lv, `${lv}: classify mismatch`);
    for (let i = 0; i < 81; i++) ok(p[i] === p[80 - i] || (p[i] && p[80 - i]) || (!p[i] && !p[80 - i]), `${lv}: asymmetric`);
    const t = S.transform(p, rng);
    ok(S.solve(t, 2).count === 1, `${lv}: transform broke uniqueness`);
    ok(S.grade(t).tier === r.grade.tier, `${lv}: transform changed tier`);
  }
  times[lv] = { avgMs: ((Date.now() - t0) / N).toFixed(1), worstMs: worst };
}
console.log('generation', times);

// Grader soundness: patch place() indirectly — run grade on a puzzle whose
// state we can compare. We re-implement: grade solves fully when tier<4; the
// result must equal the backtracking solution.
{
  const r2 = S.mulberry32(99); let checked = 0;
  for (let k = 0; k < N * 4; k++) {
    const p = S.carve(S.fullGrid(r2), r2, 17);
    const truth = S.solve(p, 1).solution;
    // grade with a probe: re-run the logical solver by hand via findHint chain
    const vals = p.slice(); let steps = 0;
    while (vals.some(v => !v) && steps < 81) {
      const h = S.findHint(vals, truth, -1);
      ok(h.d === truth[h.i], 'hint gives wrong digit');
      vals[h.i] = h.d; steps++;
    }
    const gr = S.grade(p);
    if (gr.tier < 4) { ok(gr.solved, 'tier<4 but unsolved'); checked++; }
  }
  console.log('grader solved', checked, 'puzzles by logic');
}

// Eliminations must never remove the true digit: instrument via a wrapped grade.
{
  const src = require('fs').readFileSync(require.resolve('../../sudoku.js'), 'utf8');
  const m = { exports: {} };
  // expose internals: make eliminate check against a global truth
  const patched = src.replace('function eliminate(st, cells, mask) {',
    'function eliminate(st, cells, mask) {\n    if (globalThis.__truth) for (const i of cells) if ((st.cand[i] & mask) && (mask & bit(globalThis.__truth[i]))) globalThis.__bad = true;')
    .replace("if (s) { place(st, s.i, s.d);", "if (s) { if (globalThis.__truth && globalThis.__truth[s.i] !== s.d) globalThis.__bad = true; place(st, s.i, s.d);")
    .replace('const ALL = 0x1ff;', 'const ALL = 0x1ff;')
    .replace(/if \(st\.cand\[i\] & ~keep\) \{/, 'if (st.cand[i] & ~keep) { if (globalThis.__truth && !(keep & bit(globalThis.__truth[i]))) globalThis.__bad = true;');
  ok((patched.match(/__bad = true/g) || []).length === 3, 'soundness hooks not installed');
  new Function('module', 'self', patched)(m, undefined);
  const P = m.exports; const r3 = P.mulberry32(7); let n = 0;
  for (let k = 0; k < N * 6; k++) {
    const p = P.carve(P.fullGrid(r3), r3, 17);
    globalThis.__truth = P.solve(p, 1).solution; globalThis.__bad = false;
    P.grade(p);
    ok(!globalThis.__bad, 'unsound elimination/placement in grader: ' + P.stringify(p));
    n++;
  }
  globalThis.__truth = null;
  console.log('soundness-checked', n, 'gradings');
}

// Daily: same date → same puzzle
{
  const mk = d => { const r = S.mulberry32(S.hashString('daily:' + d)); let x = null; while (!x) x = S.generate('hard', r); return S.stringify(x.puzzle); };
  ok(mk('2026-11-26') === mk('2026-11-26'), 'daily not deterministic');
  ok(mk('2026-11-26') !== mk('2026-11-27'), 'daily repeats across days');
}
console.log(fails ? `${fails} FAILED` : 'engine: all ok');
process.exit(fails ? 1 : 0);
