// End-to-end behaviour in real browsers. Needs the static server:
//   python3 -m http.server 8650   (repo root)    then: node tools/test/e2e.test.js
const { webkit, chromium, devices } = require('playwright');
const BASE = process.env.SUDOKU_URL || 'http://localhost:8650/';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok:   ' : 'FAIL: ') + m); if (!c) fails++; };
const st = p => p.evaluate(() => JSON.parse(JSON.stringify(__sudoku.state)));

async function gameFlow() {
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices['iPhone SE'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE);
  await p.tap('[data-act=new]'); await p.waitForTimeout(350);
  await p.tap('[data-act=start][data-level=medium]'); await p.waitForTimeout(200);
  let s = await st(p); const g = s.slots.free;
  ok(g && g.level === 'medium' && g.status === 'playing', 'new medium game created');
  const givens = [...g.puzzle].filter(c => c !== '.').length;
  ok(givens >= 28 && givens <= 32, `medium has 28–32 givens (${givens})`);

  // board fits the SE screen without scrolling
  const box = await p.$eval('#board', el => el.getBoundingClientRect().toJSON());
  const pad = await p.$eval('#pad', el => el.getBoundingClientRect().toJSON());
  const vh = p.viewportSize().height;
  ok(box.width > 280 && pad.bottom <= vh, `layout fits iPhone SE (board ${Math.round(box.width)}px, pad bottom ${Math.round(pad.bottom)})`);

  const empties = [...g.puzzle].map((c, i) => c === '.' ? i : -1).filter(i => i >= 0);
  const cells = new Proxy({}, { get: (_, k) => p.locator(`.cell[data-i="${k}"]`) });
  const solAt = i => +g.solution[i];

  // correct entry: blue, locked, scores
  await cells[empties[0]].tap(); await p.tap(`#pad button[data-d="${solAt(empties[0])}"]`);
  s = await st(p);
  ok(s.slots.free.values[empties[0]] === solAt(empties[0]) && s.slots.free.score > 0, 'correct entry placed and scored');
  ok(await cells[empties[0]].evaluate(e => e.classList.contains('user')), 'entered digit styled as user digit');

  // wrong entry that duplicates a given in its row: both cells red
  const i = empties[1];
  const row = Math.floor(i / 9);
  let dupDigit = 0, dupCell = -1;
  for (let c = 0; c < 9; c++) { const j = row * 9 + c; if (g.puzzle[j] !== '.' && +g.puzzle[j] !== solAt(i)) { dupDigit = +g.puzzle[j]; dupCell = j; break; } }
  await cells[i].tap(); await p.tap(`#pad button[data-d="${dupDigit}"]`);
  await p.waitForTimeout(50);
  s = await st(p);
  ok(s.slots.free.mistakes === 1, 'wrong digit counts a mistake');
  ok(await cells[i].evaluate(e => e.classList.contains('wrong') && e.classList.contains('conflict')), 'wrong cell is red');
  ok(await cells[dupCell].evaluate(e => e.classList.contains('conflict')), 'the duplicate it clashes with is red too');
  ok((await p.textContent('#st-mistakes')).trim() === '1/3', 'stat row shows 1/3');

  // erase + undo
  await p.tap('[data-act=erase]');
  s = await st(p); ok(s.slots.free.values[i] === 0, 'erase clears a wrong digit');
  await p.tap('[data-act=undo]');
  s = await st(p); ok(s.slots.free.values[i] === dupDigit, 'undo restores it');
  ok(s.slots.free.mistakes === 1, 'undo does not refund the mistake');
  await p.tap('[data-act=erase]');

  // notes
  await p.tap('[data-act=notes]');
  await p.tap('#pad button[data-d="1"]'); await p.tap('#pad button[data-d="5"]');
  s = await st(p); ok(s.slots.free.notes[i] === (1 | 16), 'notes toggle 1 and 5');
  ok((await p.textContent('#notes-badge')) === 'ON', 'notes badge ON');
  await p.tap('[data-act=notes]');

  // persistence across reload
  await p.reload(); await p.waitForTimeout(200);
  s = await st(p); ok(s.slots.free.notes[i] === 17 && s.slots.free.mistakes === 1, 'game survives reload');
  await p.tap('[data-act=continue]'); await p.waitForTimeout(150);

  // three mistakes → game over
  for (const k of [2, 3]) {
    const j = empties[k];
    await cells[j].tap(); await p.tap(`#pad button[data-d="${solAt(j) % 9 + 1}"]`);
  }
  await p.waitForTimeout(800);
  s = await st(p);
  ok(s.slots.free.status === 'over', '3 mistakes → game over');
  ok(await p.isVisible('#alert-root >> text=Game Over'), 'game over alert shown');
  await p.tap('#alert-root >> text=Second Chance'); await p.waitForTimeout(300);
  s = await st(p); ok(s.slots.free.status === 'playing' && (await p.textContent('#st-mistakes')).trim() === '2/3', 'second chance continues at 2/3');

  // finish → win, stats, streak
  await p.evaluate(() => { const g = __sudoku.state.slots.free; for (let i = 0; i < 81; i++) g.values[i] = +g.solution[i]; g.values[g.puzzle.indexOf('.')] = 0; });
  const last = (await st(p)).slots.free.puzzle.indexOf('.');
  await cells[last].tap(); await p.tap(`#pad button[data-d="${solAt(last)}"]`);
  await p.waitForTimeout(2500);
  s = await st(p);
  ok(s.slots.free.status === 'won', 'last digit wins');
  ok(s.stats.medium.won === 1 && s.stats.medium.streak === 1 && s.stats.medium.started === 1, 'stats: 1 started, 1 won, streak 1');
  ok(s.history[0] && s.history[0].won && s.history[0].mistakes === 3, 'history records the game');
  ok(await p.isVisible('#sheet >> text=Solved!'), 'win sheet shown');

  // abandoning a started game counts as a loss and resets streak
  await p.tap('#sheet [data-act=start]'); await p.waitForTimeout(200);
  const g2 = (await st(p)).slots.free; const e2 = g2.puzzle.indexOf('.');
  await p.locator(`.cell[data-i="${e2}"]`).tap(); await p.tap(`#pad button[data-d="${+g2.solution[e2]}"]`);
  await p.tap('[data-act=restart]'); await p.waitForTimeout(350);
  await p.tap('#sheet [data-act=new]'); await p.waitForTimeout(350);
  await p.tap('[data-act=start][data-level=hard]'); await p.waitForTimeout(200);
  s = await st(p); ok(s.stats.medium.lost === 1 && s.stats.medium.streak === 0 && s.stats.medium.bestStreak === 1, 'abandoned game → loss, streak reset');

  // daily is deterministic across "phones" (fresh contexts)
  const dailyOf = async () => {
    const c = await b.newContext({ ...devices['iPhone 13'] }); const q = await c.newPage();
    await q.goto(BASE); await q.tap('[data-act=daily]'); await q.waitForTimeout(200);
    const pz = await q.evaluate(() => __sudoku.state.slots.daily.puzzle); await c.close(); return pz;
  };
  ok((await dailyOf()) === (await dailyOf()), 'daily puzzle identical on two phones');
  ok(errs.length === 0, 'no page errors ' + (errs.join('; ') || ''));
  await b.close();
}

async function offline() {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForTimeout(300);
  await ctx.setOffline(true);
  await p.reload();
  ok(await p.isVisible('text=New Game'), 'loads offline after first visit');
  await p.click('[data-act=new]'); await p.waitForTimeout(350);
  await p.click('[data-act=start][data-level=extreme]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __sudoku.state.slots.free.level === 'extreme'), 'can start an extreme game offline');
  await b.close();
}

(async () => {
  await gameFlow();
  await offline();
  console.log(fails ? `${fails} FAILED` : 'e2e: all ok');
  process.exit(fails ? 1 : 0);
})();
