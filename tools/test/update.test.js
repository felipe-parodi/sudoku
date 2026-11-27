// Deploy flow: a new sw.js version reaches an open app; mid-game it waits for the
// user, Settings → Install Update reloads into the same paused game.
// Temporarily edits sw.js (restored at the end). Needs the static server on :8650.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const SW = path.join(__dirname, '../../sw.js');
const BASE = process.env.SUDOKU_URL || 'http://localhost:8650/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok:   ' : 'FAIL: ') + m); if (!c) fails++; };
(async () => {
  const orig = fs.readFileSync(SW, 'utf8');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); await p.waitForTimeout(300);
    await p.click('[data-act=new]'); await p.waitForTimeout(450);
    await p.click('[data-act=start][data-level=easy]'); await p.waitForTimeout(200);
    const g = await p.evaluate(() => __sudoku.state.slots.free); const e = g.puzzle.indexOf('.');
    await p.click(`.cell[data-i="${e}"]`); await p.click(`#pad button[data-d="${g.solution[e]}"]`);
    const bump = tag => fs.writeFileSync(SW, orig.replace(/const VERSION = '([^']+)'/, `const VERSION = '$1-${tag}'`));
    const active = () => p.evaluate(async () => (await caches.keys()).join(','));

    // 1. passive: phone notices an update while you're mid-game → it waits and offers
    bump('a');
    await p.evaluate(() => { window.__noReload = 1; });
    await p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await p.waitForTimeout(2500);
    ok(await p.isVisible('text=A new version is ready'), 'mid-game: update waits, toast offers it');
    ok(await p.evaluate(() => window.__noReload === 1), 'mid-game: nothing reloads under you');
    await p.click('[data-act=settings]'); await p.waitForTimeout(450);
    ok(await p.isVisible('#sheet >> text=Install Update'), 'Settings shows Install Update');
    await Promise.all([p.waitForEvent('load', { timeout: 10000 }), p.click('#sheet >> text=Install Update')]);
    await p.waitForTimeout(600);
    ok(/-a/.test(await active()), 'new version active after Install Update');
    ok(await p.isVisible('#game') && await p.isVisible('#pause-veil'), 'back in the same game, paused');
    ok((await p.evaluate(() => __sudoku.state.slots.free)).values[e] === +g.solution[e], 'move survived the update');

    // 2. active: Check for Updates fetches and installs right away
    bump('b');
    await p.click('[data-act=resume]'); await p.click('[data-act=settings]'); await p.waitForTimeout(450);
    await Promise.all([p.waitForEvent('load', { timeout: 15000 }), p.click('#sheet [data-act=update]')]);
    await p.waitForTimeout(600);
    ok(/-b/.test(await active()), 'Check for Updates installs a new version and reloads');

    // up to date path
    await p.click('[data-act=resume]'); await p.click('[data-act=settings]'); await p.waitForTimeout(450);
    await p.click('#sheet [data-act=update]'); await p.waitForTimeout(2500);
    ok(await p.isVisible('#alert-root >> text=Up to Date'), 'Check for Updates says up to date');
  } finally {
    fs.writeFileSync(SW, orig);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : 'update: all ok'); process.exit(fails ? 1 : 0);
})();
