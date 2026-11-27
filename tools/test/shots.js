// Screenshot key screens in iPhone WebKit. node tools/test/shots.js [device]
const { webkit, devices } = require('playwright');
const OUT = __dirname + '/out/';
const BASE = process.env.SUDOKU_URL || 'http://localhost:8650/';
(async () => {
  const dev = process.argv[2] || 'iPhone 13';
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices[dev] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE);
  await p.screenshot({ path: OUT + 'home-empty.png' });
  await p.tap('[data-act=new]');
  await p.waitForTimeout(450);
  await p.screenshot({ path: OUT + 'newgame.png' });
  await p.tap('[data-act=start][data-level=hard]');
  await p.waitForTimeout(300);
  // fill ~half the empties correctly, one wrong, some notes
  await p.evaluate(() => {
    const g = __sudoku.state.slots.free; let k = 0;
    for (let i = 0; i < 81; i++) if (g.puzzle[i] === '.' && (k++ % 2 === 0)) g.values[i] = +g.solution[i];
  });
  const cells = new Proxy({}, { get: (_, k) => p.locator(`.cell[data-i="${k}"]`) });
  // select an empty cell, make a mistake
  const empty = await p.evaluate(() => { const g = __sudoku.state.slots.free; for (let i = 0; i < 81; i++) if (!g.values[i]) return i; });
  await cells[empty].tap();
  const wrong = await p.evaluate(i => { const g = __sudoku.state.slots.free; return (+g.solution[i]) % 9 + 1; }, empty);
  await p.tap(`#pad button[data-d="${wrong}"]`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'game.png' });
  // notes
  const empty2 = await p.evaluate(() => { const g = __sudoku.state.slots.free; for (let i = 80; i >= 0; i--) if (!g.values[i]) return i; });
  await cells[empty2].tap(); await p.tap('[data-act=notes]');
  for (const d of [1, 4, 7]) await p.tap(`#pad button[data-d="${d}"]`);
  await p.tap('[data-act=notes]');
  await p.screenshot({ path: OUT + 'game-notes.png' });
  // finish via hints
  for (let k = 0; k < 90; k++) {
    const st = await p.evaluate(() => __sudoku.state.slots.free.status);
    if (st !== 'playing') break;
    await p.tap('[data-act=hint]');
  }
  for (const ms of [150, 300, 450, 650]) { await p.waitForTimeout(ms === 150 ? 150 : 150); await p.screenshot({ path: OUT + `wave-${ms}.png` }); }
  await p.waitForTimeout(1600);
  await p.screenshot({ path: OUT + 'win.png' });
  await p.tap('#sheet [data-act=home]'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + 'home.png' });
  await p.tap('#tab-stats'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + 'stats.png', fullPage: false });
  await p.tap('#tab-home'); await p.tap('[data-act=continue]').catch(()=>{});
  console.log('errors:', errs);
  await b.close();
})();
