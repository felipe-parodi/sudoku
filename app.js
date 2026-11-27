'use strict';
/* Sudoku — app shell. Everything lives on this phone (localStorage);
   puzzles are generated on-device by sudoku.js, so there is nothing to
   download after install and no two games are alike. */
(() => {
  const SD = window.Sudoku;
  const VERSION = '1.3.0'; // keep in sync with sw.js
  const KEY = 'sudoku:v1';
  const LEVELS = ['easy', 'medium', 'hard', 'extreme'];
  const LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Extreme' };
  const BLURB = {
    easy: 'Relaxed — lots of clues',
    medium: 'Fewer clues, simple logic',
    hard: 'Needs pairs & pointing',
    extreme: 'X-wings & wings — no guessing',
  };
  const BASE = { easy: 30, medium: 60, hard: 120, extreme: 200 };   // points per correct cell
  const PAR = { easy: 600, medium: 1080, hard: 1800, extreme: 2700 }; // seconds — finishing at par earns 1× time bonus
  const DAILY_LEVEL = ['easy', 'easy', 'medium', 'easy', 'medium', 'medium', 'hard']; // Sun..Sat — gentle, so streaks survive
  const MAX_MISTAKES = 3;
  const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const $ = id => document.getElementById(id);
  const ICON = {
    chev: '<svg class="chev" viewBox="0 0 8 13"><path d="M1.5 1.5 6.5 6.5 1.5 11.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.4 2.4-5.4 3.9-7.9.4 1.6 1.3 2.6 2.4 3.1.2-2.8 1.2-5.1 3.2-7.1.3 3.4 3.5 6.1 3.5 11.1 0 4-2.7 6.9-6.5 6.9z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24"><path d="M7 3.5h10v5.2a5 5 0 0 1-10 0z"/><path d="M17 5h2.8v1.6A3.4 3.4 0 0 1 16.6 10M7 5H4.2v1.6A3.4 3.4 0 0 0 7.4 10M9.2 20.5h5.6M12 14v6.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  };

  /* ---------------- persistence ---------------- */
  const blankStats = () => ({ started: 0, won: 0, lost: 0, perfect: 0, best: null, total: 0, streak: 0, bestStreak: 0 });
  const defaults = () => ({
    v: 1,
    settings: { mistakeLimit: true, checkMistakes: true, hlArea: true, hlSame: true, hlDupes: true, autoNotes: true, showTimer: false, theme: 'auto' },
    slots: { free: null, daily: null }, active: 'free',
    stats: Object.fromEntries(LEVELS.map(l => [l, blankStats()])),
    weeks: {}, daily: {}, history: [], lastLevel: 'easy',
  });
  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const d = JSON.parse(raw);
      return {
        ...base, ...d,
        settings: { ...base.settings, ...(d.settings || {}) },
        stats: { ...base.stats, ...(d.stats || {}) },
        slots: { ...base.slots, ...(d.slots || {}) },
      };
    } catch (e) { return base; }
  }
  let S = load();
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full / private mode */ } };
    if (now) write(); else saveTimer = setTimeout(write, 200);
  }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }

  /* ---------------- dates ---------------- */
  const pad2 = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const today = () => ymd(new Date());
  function weekKey(d = new Date()) {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return ymd(m);
  }
  const fmtTime = sec => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  };
  const fmtNum = n => Math.round(n).toLocaleString('en-US');
  const dailyLevel = dateStr => { const [y, m, d] = dateStr.split('-').map(Number); return DAILY_LEVEL[new Date(y, m - 1, d).getDay()]; };

  /* ---------------- game model ---------------- */
  function makePuzzle(level, seed) {
    const rng = SD.mulberry32(seed);
    for (let k = 0; k < 3000; k++) { const r = SD.generate(level, rng); if (r) return r.puzzle; }
    // practically unreachable; a carved minimal puzzle is still valid and unique
    return SD.carve(SD.fullGrid(rng), rng, level === 'easy' ? 38 : 24);
  }
  /* Free games come from a one-per-level queue filled in idle time, so
     "New game" is instant even for Extreme on an older phone. */
  function takePuzzle(level) {
    const q = S.pregen || (S.pregen = {});
    const s = q[level]; delete q[level];
    setTimeout(refillPregen, 1500);
    return s ? SD.parse(s) : makePuzzle(level, crypto.getRandomValues(new Uint32Array(1))[0]);
  }
  let worker = null, pending = null;
  function refillPregen() {
    const q = S.pregen || (S.pregen = {});
    const missing = LEVELS.find(l => !q[l]);
    if (!missing) return save();
    if (pending) return;
    try {
      if (worker === false) throw 0;
      if (!worker) {
        worker = new Worker('gen-worker.js');
        worker.onmessage = e => {
          pending = null;
          if (e.data.puzzle) (S.pregen || (S.pregen = {}))[e.data.level] = e.data.puzzle;
          refillPregen();
        };
        worker.onerror = () => { pending = null; worker = false; };
      }
      pending = missing;
      worker.postMessage({ level: missing, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    } catch (e) { // no worker: fall back to idle main-thread generation
      q[missing] = SD.stringify(makePuzzle(missing, crypto.getRandomValues(new Uint32Array(1))[0]));
      setTimeout(refillPregen, 200);
    }
  }
  function createGame(level, daily = null) {
    const p = daily ? makePuzzle(level, SD.hashString('daily:' + daily)) : takePuzzle(level);
    const sol = SD.solve(p, 1).solution;
    return {
      level, daily, puzzle: SD.stringify(p), solution: sol.join(''),
      values: p.slice(), notes: new Array(81).fill(0), awarded: new Array(81).fill(0),
      mistakes: 0, chances: 0, score: 0, cellPts: 0, penalty: 0, hints: 0, elapsed: 0,
      status: 'playing', sel: -1, notesMode: false, undo: [], counted: false, created: Date.now(),
    };
  }
  const G = () => S.slots[S.active];
  const sol = (g, i) => g.solution.charCodeAt(i) - 48;
  const given = (g, i) => g.puzzle[i] !== '.';
  const correct = (g, i) => g.values[i] === sol(g, i);
  const locked = (g, i) => given(g, i) || (S.settings.checkMistakes && correct(g, i));
  const toFill = g => { let n = 0; for (let i = 0; i < 81; i++) if (!given(g, i)) n++; return n; };
  const filled = g => {
    let n = 0;
    for (let i = 0; i < 81; i++) if (!given(g, i) && g.values[i] && (!S.settings.checkMistakes || correct(g, i))) n++;
    return n;
  };
  const isSolved = g => { for (let i = 0; i < 81; i++) if (!correct(g, i)) return false; return true; };

  const liveScore = g => Math.max(0, (g.cellPts || 0) - (g.penalty || 0));
  const mistakesLeft = g => MAX_MISTAKES - (g.mistakes - (g.chances || 0));
  function markStarted(g) {
    if (g.counted) return;
    g.counted = true;
    S.stats[g.level].started++;
  }
  function recordEnd(g, won) {
    if (!g.counted || g.recorded) return;
    g.recorded = true;
    const st = S.stats[g.level];
    const sec = Math.floor(g.elapsed / 1000);
    if (won) {
      st.won++; st.total += sec; st.best = st.best == null ? sec : Math.min(st.best, sec);
      st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
      if (g.mistakes === 0) st.perfect++;
      if (g.daily) S.daily[g.daily] = { time: sec, score: g.score, mistakes: g.mistakes, level: g.level };
    } else {
      st.lost++; st.streak = 0;
    }
    S.history.unshift({ level: g.level, daily: g.daily, won, time: sec, score: g.score, mistakes: g.mistakes, hints: g.hints, at: Date.now() });
    if (S.history.length > 300) S.history.length = 300;
  }
  function currentStreak() { let n = 0; for (const h of S.history) { if (!h.won) break; n++; } return n; }
  function dailyStreak() {
    let n = 0; const d = new Date();
    if (!S.daily[ymd(d)]) d.setDate(d.getDate() - 1); // today not done yet: streak still alive from yesterday
    while (S.daily[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------------- routing ---------------- */
  let route = 'home';
  let paused = false;
  function go(r) {
    route = r;
    if (S.route !== r) { S.route = r; save(); } // relaunch lands where you left off
    for (const s of ['home', 'game', 'stats']) $(s).hidden = s !== r;
    $('tabbar').hidden = r === 'game';
    $('tab-home').classList.toggle('on', r === 'home');
    $('tab-stats').classList.toggle('on', r === 'stats');
    if (r === 'home') renderHome();
    if (r === 'stats') renderStats();
    if (r === 'game') { buildBoard(); layout(); renderGame(); }
    syncTicker();
  }

  /* ---------------- home ---------------- */
  function miniBoard(g) {
    const sz = 74, c = sz / 9;
    let rects = '';
    for (let i = 0; i < 81; i++) {
      if (!g.values[i]) continue;
      const x = (i % 9) * c, y = Math.floor(i / 9) * c;
      const col = given(g, i) ? 'var(--ink)' : 'var(--accent)';
      rects += `<rect x="${x + c * .3}" y="${y + c * .3}" width="${c * .4}" height="${c * .4}" rx="${c * .2}" fill="${col}" opacity="${given(g, i) ? .55 : .9}"/>`;
    }
    let lines = '';
    for (let k = 1; k < 9; k++) {
      const w = k % 3 ? .5 : 1.2, o = k % 3 ? .25 : .6;
      lines += `<path d="M${k * c} 0V${sz}M0 ${k * c}H${sz}" stroke="var(--ink)" stroke-opacity="${o}" stroke-width="${w}"/>`;
    }
    return `<svg class="mini" viewBox="0 0 ${sz} ${sz}" style="background:var(--cell);stroke:none">${lines}${rects}<rect x=".75" y=".75" width="${sz - 1.5}" height="${sz - 1.5}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="2"/></svg>`;
  }

  function renderHome() {
    const now = new Date();
    const t = today();
    const dl = dailyLevel(t);
    const dDone = S.daily[t];
    const dSlot = S.slots.daily && S.slots.daily.daily === t ? S.slots.daily : null;
    const free = S.slots.free && S.slots.free.status !== 'won' ? S.slots.free : null;
    const wk = S.weeks[weekKey()] || 0;
    let played = 0, won = 0;
    for (const l of LEVELS) { played += S.stats[l].started; won += S.stats[l].won; }
    const streak = dailyStreak();
    const dots = k => `<span class="lvl-dots">${[0, 1, 2, 3].map(j => `<i class="${j <= k ? 'on' : ''}"></i>`).join('')}</span>`;

    $('home').innerHTML = `
      <div class="page">
        <div class="large-title">Sudoku</div>
        <div class="subtitle">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        ${updateReady ? `<div class="group" style="margin-top:14px"><button class="cellrow has-icon" data-act="update">
          <span class="app-ic" style="background:#34c759">${ICON.down}</span>
          <span class="grow"><div>Update Available</div><div class="sub">Tap to install — your game is saved</div></span>${ICON.chev}</button></div>` : ''}

        <div class="group">
          ${free ? `
          <button class="cellrow tall has-icon" data-act="continue">
            ${miniBoard(free)}
            <span class="grow"><div>Continue Game</div>
              <div class="sub">${LABEL[free.level]} · ${fmtTime(free.elapsed / 1000)} · ${free.status === 'over' ? 'out of mistakes' : `${filled(free)} of ${toFill(free)}`}</div></span>
            ${ICON.chev}
          </button>` : ''}
          <button class="cellrow action has-icon" data-act="new">
            <span class="app-ic" style="background:var(--accent)">${ICON.plus}</span>
            <span class="grow">New Game</span>
          </button>
        </div>

        <div class="sec-h">Daily Challenge</div>
        <div class="group">
          <button class="cellrow tall has-icon" data-act="daily" ${dDone ? 'disabled' : ''}>
            <span class="app-ic" style="background:#ff3b30">${ICON.cal}</span>
            <span class="grow"><div>${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>
              <div class="sub">${LABEL[dl]}${dDone ? ` · solved in ${fmtTime(dDone.time)}` : dSlot && dSlot.counted ? ` · ${fmtTime(dSlot.elapsed / 1000)} so far` : ''}</div></span>
            ${dDone ? `<svg class="ok" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : ICON.chev}
          </button>
        </div>
        <div class="sec-f">The same puzzle on every phone today.${streak ? ` ${streak}-day streak.` : ''}</div>

        <div class="sec-h">This Week</div>
        <div class="group">
          <div class="cellrow"><span class="grow">Points</span><span class="val">${fmtNum(wk)}</span></div>
          <div class="cellrow"><span class="grow">Games Won</span><span class="val">${won} of ${played}</span></div>
          <div class="cellrow"><span class="grow">Win Streak</span><span class="val">${currentStreak()}</span></div>
          <div class="cellrow"><span class="grow">Daily Streak</span><span class="val">${streak}</span></div>
        </div>

        ${!S.history.length ? `<div class="sec-h">How to Play</div>
        <div class="group"><div class="cellrow"><span class="grow" style="font-size:15px;line-height:1.4">Fill the grid so every row, column and 3×3 box contains 1 to 9 once. Tap a square, then a number. Three mistakes ends the game.</span></div></div>` : ''}
      </div>`;
    void dots;
  }

  /* ---------------- stats ---------------- */
  let statsLevel = 'all';
  function renderStats() {
    const lv = statsLevel === 'all' ? LEVELS : [statsLevel];
    const agg = blankStats(); agg.best = null;
    for (const l of lv) {
      const s = S.stats[l];
      agg.started += s.started; agg.won += s.won; agg.lost += s.lost; agg.perfect += s.perfect; agg.total += s.total;
      if (s.best != null) agg.best = agg.best == null ? s.best : Math.min(agg.best, s.best);
      agg.bestStreak = Math.max(agg.bestStreak, s.bestStreak);
      if (statsLevel !== 'all') agg.streak = s.streak;
    }
    if (statsLevel === 'all') agg.streak = currentStreak();
    const rate = agg.started ? Math.round(100 * agg.won / agg.started) + '%' : '—';
    const avg = agg.won ? fmtTime(agg.total / agg.won) : '—';
    const hist = S.history.filter(h => statsLevel === 'all' || h.level === statsLevel).slice(0, 25);
    const best = Math.max(0, ...Object.values(S.weeks));
    const row = (k, v) => `<div class="cellrow"><span class="grow">${k}</span><span class="val">${v}</span></div>`;
    $('stats').innerHTML = `
      <div class="page">
        <div class="large-title">Statistics</div>
        <div class="seg">${['all', ...LEVELS].map(l => `<button data-act="stats-level" data-level="${l}" class="${l === statsLevel ? 'on' : ''}">${l === 'all' ? 'All' : LABEL[l]}</button>`).join('')}</div>
        <div class="sec-h">Games</div>
        <div class="group">${row('Games Started', agg.started)}${row('Games Won', agg.won)}${row('Win Rate', rate)}${row('Wins Without Mistakes', agg.perfect)}</div>
        <div class="sec-h">Time</div>
        <div class="group">${row('Best Time', agg.best == null ? '—' : fmtTime(agg.best))}${row('Average Time', avg)}</div>
        <div class="sec-h">Streaks</div>
        <div class="group">${row('Current Win Streak', agg.streak)}${row('Best Win Streak', agg.bestStreak)}${row('Daily Streak', dailyStreak())}${row('Daily Challenges Solved', Object.keys(S.daily).length)}</div>
        <div class="sec-h">Points</div>
        <div class="group">${row('This Week', fmtNum(S.weeks[weekKey()] || 0))}${row('Best Week', fmtNum(best))}</div>
        <div class="sec-h">Recent Games</div>
        <div class="group">${hist.length ? hist.map(h => `
          <div class="cellrow">
            <span class="grow"><div>${LABEL[h.level]}${h.daily ? ' · Daily' : ''}</div>
              <div class="sub">${new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${h.mistakes} mistake${h.mistakes === 1 ? '' : 's'}${h.hints ? ` · ${h.hints} hint${h.hints === 1 ? '' : 's'}` : ''}</div></span>
            <span class="val" style="text-align:right">${h.won ? fmtTime(h.time) : 'Lost'}<div class="sub">${h.won ? fmtNum(h.score) + ' pts' : fmtTime(h.time)}</div></span>
          </div>`).join('') : '<div class="cellrow"><span class="grow val">No finished games yet</span></div>'}</div>
      </div>`;
  }

  /* ---------------- board ---------------- */
  const cells = [];
  let built = false;
  function buildBoard() {
    if (built) return;
    built = true;
    const board = $('board');
    const boxes = [];
    for (let b = 0; b < 9; b++) { const el = document.createElement('div'); el.className = 'box'; board.appendChild(el); boxes.push(el); }
    for (let i = 0; i < 81; i++) {
      const el = document.createElement('div');
      el.className = 'cell'; el.dataset.i = i; el.setAttribute('role', 'gridcell');
      el.innerHTML = '<span class="v"></span><div class="notes">' + DIGITS.map(() => '<i></i>').join('') + '</div>';
      boxes[SD.BOX[i]].appendChild(el);
      cells[i] = { el, v: el.firstChild, notes: [...el.lastChild.children], notesEl: el.lastChild };
    }
    $('pad').innerHTML = DIGITS.map(d => `<button data-d="${d}" aria-label="${d}">${d}</button>`).join('');
  }
  function layout() {
    const wrap = $('board-wrap');
    const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
    if (!size) return;
    const board = $('board');
    board.style.setProperty('--size', size + 'px');
    board.style.setProperty('--cellpx', ((size - 10) / 9).toFixed(2) + 'px');
  }
  window.addEventListener('resize', () => { if (route === 'game') layout(); });

  function renderGame() {
    const g = G(); if (!g) return;
    const st = S.settings;
    const sel = g.sel;
    const sv = sel >= 0 ? g.values[sel] : 0;
    // duplicates: same digit twice in a row / column / box
    const conflict = new Uint8Array(81);
    if (st.hlDupes) {
      for (let i = 0; i < 81; i++) {
        const v = g.values[i]; if (!v) continue;
        for (const j of SD.PEERS[i]) if (g.values[j] === v) { conflict[i] = 1; conflict[j] = 1; }
      }
    }
    for (let i = 0; i < 81; i++) {
      const c = cells[i], v = g.values[i];
      const isGiven = given(g, i);
      const wrong = !isGiven && v && st.checkMistakes && !correct(g, i);
      let cls = 'cell';
      if (!isGiven && v) cls += ' user';
      if (wrong) cls += ' wrong';
      if (sel >= 0 && i !== sel) {
        if (st.hlArea && (SD.ROW[i] === SD.ROW[sel] || SD.COL[i] === SD.COL[sel] || SD.BOX[i] === SD.BOX[sel])) cls += ' area';
        if (st.hlSame && sv && v === sv) cls += ' same';
      }
      if (conflict[i] || wrong) cls += ' conflict';
      if (i === sel) cls += ' sel';
      // keep one-shot animation classes until they finish
      for (const a of ['pop', 'shake', 'flash', 'hinted']) if (c.el.classList.contains(a)) cls += ' ' + a;
      if (c.el.className !== cls) c.el.className = cls;
      const txt = v ? String(v) : '';
      if (c.v.textContent !== txt || !c.el.hasAttribute('aria-label')) {
        c.v.textContent = txt;
        c.el.setAttribute('aria-label', `Row ${SD.ROW[i] + 1}, column ${SD.COL[i] + 1}, ${v || 'empty'}`);
      }
      const nm = v ? 0 : g.notes[i];
      c.notesEl.style.display = nm ? '' : 'none';
      if (nm) {
        for (let d = 1; d <= 9; d++) {
          const on = nm & SD.bit(d);
          const n = c.notes[d - 1];
          const t = on ? String(d) : '';
          if (n.textContent !== t) n.textContent = t;
          n.className = on && st.hlSame && sv === d ? 'hit' : '';
        }
      }
    }
    // number pad: a digit that's complete gets a check
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) { const v = g.values[i]; if (v && (!st.checkMistakes || correct(g, i))) counts[v]++; }
    for (const btn of $('pad').children) {
      const d = +btn.dataset.d;
      const done = st.checkMistakes && counts[d] >= 9;
      if (btn.classList.contains('done') !== done) {
        btn.classList.toggle('done', done); btn.disabled = done;
        btn.innerHTML = done ? ICON.check : String(d);
      }
    }
    $('pad').classList.toggle('notes-mode', g.notesMode);
    $('notes-btn').classList.toggle('on', g.notesMode);
    $('notes-badge').textContent = g.notesMode ? 'ON' : 'OFF';
    $('counter').textContent = `${filled(g)}/${toFill(g)}`;
    renderStatsRow();
    $('pause-veil').hidden = !(paused && g.status === 'playing');
  }

  function renderStatsRow() {
    const g = G(); if (!g) return;
    const first = $('st-first');
    if (S.settings.showTimer) {
      first.firstChild.textContent = 'Time';
      $('st-week').textContent = fmtTime(g.elapsed / 1000); $('st-week').dataset.h = '';
    } else {
      first.firstChild.textContent = 'This Week';
      const html = ICON.trophy + fmtNum(S.weeks[weekKey()] || 0);
      if ($('st-week').dataset.h !== html) { $('st-week').innerHTML = html; $('st-week').dataset.h = html; }
    }
    $('st-level').textContent = (g.daily ? 'Daily · ' : '') + LABEL[g.level];
    $('st-score').textContent = fmtNum(g.score);
    const m = $('st-mistakes');
    m.textContent = !S.settings.checkMistakes ? 'Off' : S.settings.mistakeLimit ? `${MAX_MISTAKES - mistakesLeft(g)}/${MAX_MISTAKES}` : String(g.mistakes);
    m.classList.toggle('bad', S.settings.checkMistakes && g.mistakes > 0);
  }

  /* One-shot animations: set per-cell delays, then restart them all with a
     single reflow. Classes clear themselves on animationend. */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function animMany(items, cls) {
    const els = items.map(([i, delay]) => { const el = cells[i].el; el.style.setProperty('--delay', (delay || 0) + 'ms'); el.classList.remove(cls); return el; });
    if (!els.length) return;
    void els[0].offsetWidth;
    for (const el of els) el.classList.add(cls);
  }
  const anim = (i, cls, _ms, delay = 0) => animMany([[i, delay]], cls);
  document.addEventListener('animationend', e => {
    const el = e.target.closest && e.target.closest('.cell'); if (!el) return;
    const name = e.animationName;
    const cls = name === 'flash' ? 'flash' : name === 'shake' ? 'shake' : name === 'pop' ? 'pop' : name === 'hinted' ? 'hinted' : null;
    if (cls) el.classList.remove(cls);
  });

  /* ---------------- timer ---------------- */
  let ticker = null, lastTick = 0, saveTick = 0;
  function running() {
    const g = G();
    return route === 'game' && g && g.status === 'playing' && !paused && document.visibilityState === 'visible' && $('sheet-root').hidden && !$('alert-root');
  }
  function syncTicker() {
    if (running()) {
      if (!ticker) { lastTick = performance.now(); ticker = setInterval(tick, 500); }
    } else if (ticker) { tick(); clearInterval(ticker); ticker = null; }
  }
  function tick() {
    const now = performance.now();
    const g = G();
    if (g && g.status === 'playing' && ticker) g.elapsed += now - lastTick;
    lastTick = now;
    if (S.settings.showTimer && route === 'game') renderStatsRow();
    if (now - saveTick > 5000) { saveTick = now; save(); }
  }

  /* ---------------- actions ---------------- */
  function pushUndo(g, idx) {
    g.undo.push(idx.map(i => [i, g.values[i], g.notes[i]]));
    if (g.undo.length > 250) g.undo.shift();
  }
  function select(i) {
    const g = G(); if (!g || paused) return;
    g.sel = i; renderGame();
  }

  function unitsCompleted(g, i) {
    const done = [];
    for (const u of SD.UNITS_OF[i]) if (SD.UNITS[u].every(j => correct(g, j))) done.push(u);
    return done;
  }
  // completed row / column / box: cells wash blue in a wave sweeping right → left
  function celebrateUnits(g, i, units) {
    const seen = new Set(), list = [];
    for (const u of units) for (const j of SD.UNITS[u]) {
      if (seen.has(j)) continue; seen.add(j);
      list.push(j);
    }
    const colOnly = units.every(u => u >= 9 && u < 18);
    const key = j => colOnly ? SD.ROW[j] * 55 : (8 - SD.COL[j]) * 60 + SD.ROW[j] * 14;
    const k0 = Math.min(...list.map(key));
    animMany(list.map(j => [j, key(j) - k0]), 'flash');
  }

  function input(d) {
    const g = G(); if (!g || g.status !== 'playing' || paused) return;
    const i = g.sel;
    if (i < 0) { toast('Tap a square first'); return; }
    if (locked(g, i)) return;
    markStarted(g);
    if (g.notesMode) {
      pushUndo(g, [i]);
      if (g.values[i]) g.values[i] = 0; // a wrong entry gives way to notes
      g.notes[i] ^= SD.bit(d);
      renderGame(); save();
      return;
    }
    if (g.values[i] === d) return;
    const right = d === sol(g, i);
    const peersWithNote = (S.settings.autoNotes && (right || !S.settings.checkMistakes))
      ? SD.PEERS[i].filter(j => !g.values[j] && (g.notes[j] & SD.bit(d))) : [];
    pushUndo(g, [i, ...peersWithNote]);
    g.values[i] = d; g.notes[i] = 0;
    for (const j of peersWithNote) g.notes[j] &= ~SD.bit(d);

    if (S.settings.checkMistakes) {
      if (right) {
        if (!g.awarded[i]) { g.awarded[i] = 1; g.cellPts += BASE[g.level]; g.score = liveScore(g); }
        anim(i, 'pop', 240);
        const units = unitsCompleted(g, i);
        if (isSolved(g)) return win(g);
        if (units.length) celebrateUnits(g, i, units);
      } else {
        g.mistakes++;
        g.penalty += BASE[g.level] * 2; g.score = liveScore(g); // a mistake costs two cells' worth
        anim(i, 'shake', 380);
        if (S.settings.mistakeLimit && mistakesLeft(g) <= 0) {
          tick();
          g.status = 'over';
          renderGame(); save(true); syncTicker();
          setTimeout(gameOverAlert, 420);
          return;
        }
      }
    } else {
      anim(i, 'pop', 240);
      if (g.values.every(Boolean)) {
        if (isSolved(g)) return win(g);
        toast("The board is full, but something's not right.");
      }
    }
    renderGame(); save();
  }

  function erase() {
    const g = G(); if (!g || g.status !== 'playing' || paused) return;
    const i = g.sel; if (i < 0 || locked(g, i)) return;
    if (!g.values[i] && !g.notes[i]) return;
    pushUndo(g, [i]);
    g.values[i] = 0; g.notes[i] = 0;
    renderGame(); save();
  }

  function undo() {
    const g = G(); if (!g || g.status !== 'playing' || paused) return;
    const step = g.undo.pop();
    if (!step) { toast('Nothing to undo'); return; }
    for (const [i, v, n] of step) { g.values[i] = v; g.notes[i] = n; }
    g.sel = step[0][0];
    renderGame(); save();
  }

  function hint() {
    const g = G(); if (!g || g.status !== 'playing' || paused) return;
    const h = SD.findHint(g.values, Array.from(g.solution, ch => ch.charCodeAt(0) - 48), g.sel);
    if (!h) return;
    markStarted(g);
    const i = h.i, d = h.d;
    const peers = SD.PEERS[i].filter(j => !g.values[j] && (g.notes[j] & SD.bit(d)));
    pushUndo(g, [i, ...peers]);
    g.values[i] = d; g.notes[i] = 0; g.awarded[i] = 1;
    for (const j of peers) g.notes[j] &= ~SD.bit(d);
    g.hints++; g.sel = i;
    anim(i, 'hinted', 900);
    const where = h.unit < 0 ? '' : h.unit < 9 ? 'row' : h.unit < 18 ? 'column' : 'box';
    toast(h.kind === 'hidden' ? `${d} has only one place in this ${where}.`
      : h.kind === 'naked' ? `${d} is the only number that fits here.`
        : `That one's a ${d}.`);
    if (isSolved(g)) return win(g);
    const units = unitsCompleted(g, i);
    if (units.length) celebrateUnits(g, i, units);
    renderGame(); save();
  }

  /* Score = cells you placed yourself − mistake penalties + a finish bonus.
     Finish bonus = 15 cells' worth × speed × accuracy, where speed is par/time
     (2× when twice as fast as par, 1× at par, ½× at double par, floor ¼×) and
     accuracy drops a fifth per mistake and a tenth per hint (floor 0.2). */
  function scoreBreakdown(g) {
    const sec = Math.max(1, g.elapsed / 1000);
    const speed = Math.min(2, Math.max(.25, PAR[g.level] / sec));
    const care = Math.max(.2, 1 - .2 * g.mistakes - .1 * g.hints);
    const bonus = Math.round(BASE[g.level] * 15 * speed * care);
    return { cells: g.cellPts, penalty: g.penalty, speed, care, bonus, total: liveScore(g) + bonus };
  }
  function win(g) {
    tick();
    $('toast').classList.remove('show');
    // credit any cell not yet scored (checking was off for part of the game); hints are already flagged
    for (let i = 0; i < 81; i++) if (!given(g, i) && !g.awarded[i]) { g.awarded[i] = 1; g.cellPts += BASE[g.level]; }
    g.status = 'won';
    const b = scoreBreakdown(g);
    g.score = b.total; g.breakdown = b;
    S.weeks[weekKey()] = (S.weeks[weekKey()] || 0) + g.score;
    recordEnd(g, true);
    g.sel = -1; paused = false;
    renderGame(); save(true); syncTicker();
    // the whole board washes blue, sweeping right → left
    // the whole board ripples column by column, right → left
    animMany([...Array(81).keys()].map(i => [i, (8 - SD.COL[i]) * 95 + SD.ROW[i] * 22]), 'flash');
    setTimeout(() => winSheet(g), 8 * 95 + 8 * 22 + 660 + 250);
  }

  function startNew(level, daily = null) {
    const slot = daily ? 'daily' : 'free';
    const old = S.slots[slot];
    if (old && old.status !== 'won') recordEnd(old, false);
    S.slots[slot] = createGame(level, daily);
    S.slots[slot].sel = S.slots[slot].values.indexOf(0);
    S.active = slot;
    if (!daily) S.lastLevel = level;
    paused = false;
    save(true);
    closeSheet(true);
    go('game');
  }
  function openSlot(slot) {
    S.active = slot; paused = false; save();
    go('game');
    if (G().status === 'over') setTimeout(gameOverAlert, 150);
  }
  function playDaily() {
    const t = today();
    const s = S.slots.daily;
    if (s && s.daily === t && s.status !== 'won') return openSlot('daily');
    if (S.daily[t]) return;
    startNew(dailyLevel(t), t);
  }
  function restart() {
    const g = G(); if (!g || g.status === 'won') return;
    g.values = SD.parse(g.puzzle); g.notes = new Array(81).fill(0);
    g.mistakes = 0; g.chances = 0; g.undo = []; g.sel = -1; g.status = 'playing'; g.notesMode = false;
    g.elapsed = 0; g.score = 0; g.cellPts = 0; g.penalty = 0; g.awarded = new Array(81).fill(0); g.hints = 0;
    paused = false;
    closeSheet(true); renderGame(); save(true); syncTicker();
  }

  /* ---------------- sheets & alerts ---------------- */
  let sheetLocked = false, sheetTimer = null;
  // kind: 'page' (nav bar + Done) or 'action' (iOS action sheet)
  function openSheet(html, { lock = false, kind = 'page', title = '' } = {}) {
    clearTimeout(sheetTimer);
    sheetLocked = lock;
    $('toast').classList.remove('show');
    const root = $('sheet-root'), sh = $('sheet');
    sh.className = 'sheet ' + (kind === 'action' ? 'action-sheet' : 'page-sheet');
    sh.innerHTML = kind === 'page'
      ? `<div class="navbar"><span></span><span class="t">${title}</span>${lock ? '<span></span>' : '<button class="done" data-act="close">Done</button>'}</div>${html}`
      : html;
    root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    syncTicker();
  }
  function closeSheet(instant) {
    const root = $('sheet-root');
    if (root.hidden) return;
    root.classList.remove('open');
    const done = () => {
      root.hidden = true; syncTicker();
      const g = G();
      if (route === 'game' && g && g.status === 'over') setTimeout(gameOverAlert, 50);
    };
    clearTimeout(sheetTimer);
    if (instant) done(); else sheetTimer = setTimeout(done, 380);
  }
  function actionSheet(title, msg, buttons) {
    openSheet(`<div class="as-group">
        ${title || msg ? `<div class="as-title">${title ? `<b>${title}</b>` : ''}${msg || ''}</div>` : ''}
        ${buttons.map(b => `<button class="as-btn" ${b.attrs}>${b.label}</button>`).join('')}
      </div>
      <button class="as-btn as-cancel" data-act="close">Cancel</button>`, { kind: 'action' });
    $('sheet').querySelector('.as-group .as-btn').style.borderTop = title || msg ? '' : '0';
  }

  // iOS-style alert. buttons: [{label, style: 'bold'|'destructive', run}]
  function alertBox(title, msg, buttons) {
    closeAlert();
    const root = document.createElement('div');
    root.className = 'alert-root'; root.id = 'alert-root';
    root.innerHTML = `<div class="alert" role="alertdialog"><div class="body"><h3>${title}</h3>${msg ? `<p>${msg}</p>` : ''}</div>
      ${buttons.map((b, k) => `<button data-k="${k}" class="${b.style || ''}">${b.label}</button>`).join('')}</div>`;
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      closeAlert(); const fn = buttons[+b.dataset.k].run; fn && fn();
    });
    document.body.appendChild(root);
    $('toast').classList.remove('show');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    syncTicker();
  }
  function closeAlert() { const r = $('alert-root'); if (r) r.remove(); syncTicker(); }

  function newGameSheet() {
    const cur = S.slots.free && S.slots.free.status === 'playing' && S.slots.free.counted;
    actionSheet('New Game', cur ? `Your ${LABEL[S.slots.free.level]} game in progress will count as a loss.` : '',
      LEVELS.map(l => ({ label: LABEL[l], attrs: `data-act="start" data-level="${l}"` })));
  }

  function restartSheet() {
    const g = G();
    actionSheet('', '', [
      { label: 'Restart This Puzzle', attrs: 'data-act="do-restart"' },
      ...(g.daily ? [] : [{ label: 'New Game', attrs: 'data-act="new"' }]),
    ]);
  }

  function gameOverAlert() {
    const g = G(); if (!g || g.status !== 'over' || route !== 'game') return;
    alertBox('Game Over', `You made ${MAX_MISTAKES} mistakes. Keep going with one more chance?`, [
      { label: 'Second Chance', style: 'bold', run: secondChance },
      g.daily ? { label: 'Restart Puzzle', run: restart } : { label: 'New Game', run: newGameSheet },
      { label: 'Home', run: () => { paused = false; go('home'); save(); } },
    ]);
  }
  function secondChance() { const g = G(); g.chances = (g.chances || 0) + 1; g.status = 'playing'; renderGame(); save(); syncTicker(); }

  function winSheet(g) {
    if (route !== 'game' || G() !== g) return;
    const b = g.breakdown || scoreBreakdown(g);
    const st = S.stats[g.level];
    const sec = Math.floor(g.elapsed / 1000);
    const record = st.best === sec && st.won > 1;
    const row = (k, v, sub = '') => `<div class="cellrow"><span class="grow"><div>${k}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</span><span class="val">${v}</span></div>`;
    openSheet(`
      <div class="result-hero">
        <div class="badge-ic">${ICON.check}</div>
        <h2>${g.mistakes === 0 && !g.hints ? 'Flawless!' : 'Solved!'}</h2>
        <p>${g.daily ? 'Daily Challenge · ' : ''}${LABEL[g.level]}${record ? ' · New best time' : ''}</p>
      </div>
      <div class="sec-h">Result</div>
      <div class="group">${row('Time', fmtTime(sec))}${row('Mistakes', g.mistakes)}${g.hints ? row('Hints', g.hints) : ''}${row('Win Streak', st.streak)}</div>
      <div class="sec-h">Score</div>
      <div class="group">
        ${row('Numbers Placed', '+' + fmtNum(b.cells))}
        ${b.penalty ? row('Mistakes', '−' + fmtNum(b.penalty)) : ''}
        ${row('Finish Bonus', '+' + fmtNum(b.bonus), `speed ×${b.speed.toFixed(2)} · accuracy ×${b.care.toFixed(1)}`)}
        <div class="cellrow"><span class="grow"><b>Total</b></span><span class="val" style="color:var(--label1);font-weight:600">${fmtNum(g.score)}</span></div>
      </div>
      ${g.daily ? '' : `<button class="big-btn" data-act="start" data-level="${g.level}">New ${LABEL[g.level]} Game</button>`}
      <button class="big-btn ${g.daily ? '' : 'tinted'}" data-act="home">Done</button>`, { lock: true, title: '' });
  }

  function settingsSheet() {
    const st = S.settings;
    const sw = (key, title, desc = '') => `
      <label class="cellrow"><span class="grow"><div>${title}</div>${desc ? `<div class="sub">${desc}</div>` : ''}</span>
        <span class="switch"><input type="checkbox" data-set="${key}" ${st[key] ? 'checked' : ''}><span></span></span></label>`;
    openSheet(`
      <div class="sec-h" style="margin-top:8px">Game</div>
      <div class="group">
        ${sw('checkMistakes', 'Check Mistakes', 'Wrong numbers turn red right away')}
        ${sw('mistakeLimit', 'Mistake Limit', 'Game over after 3 mistakes')}
        ${sw('autoNotes', 'Auto-Remove Notes')}
        ${sw('showTimer', 'Show Timer')}
      </div>
      <div class="sec-h">Highlights</div>
      <div class="group">
        ${sw('hlArea', 'Row, Column & Box')}
        ${sw('hlSame', 'Identical Numbers')}
        ${sw('hlDupes', 'Duplicates')}
      </div>
      <div class="sec-h">Appearance</div>
      <div class="seg" style="margin:0">${['auto', 'light', 'dark'].map(t => `<button data-act="theme" data-theme="${t}" class="${st.theme === t ? 'on' : ''}">${t === 'auto' ? 'Automatic' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="sec-h">App</div>
      <div class="group">
        <button class="cellrow action" data-act="update">${updateReady ? 'Install Update' : 'Check for Updates'}</button>
        <div class="cellrow"><span class="grow">Version</span><span class="val">${VERSION}</span></div>
      </div>
      <div class="sec-h">Data</div>
      <div class="group">
        <button class="cellrow action" data-act="export">Back Up Progress</button>
        <button class="cellrow action" data-act="import">Restore From Backup</button>
        <button class="cellrow danger" data-act="reset-stats">Reset Statistics</button>
      </div>
      <div class="sec-f">Sudoku ${VERSION}. Works offline, no ads. Progress is saved on this iPhone only.</div>`, { title: 'Settings' });
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg, actLabel, fn) {
    const t = $('toast');
    t.innerHTML = '';
    const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
    if (actLabel) {
      const b = document.createElement('button'); b.textContent = actLabel;
      b.onclick = () => { t.classList.remove('show'); fn(); };
      t.appendChild(b);
    }
    if (route === 'game') {
      // float over the tool row (taps pass through), never over cells or the stat row
      const tr = document.querySelector('.tools').getBoundingClientRect();
      t.style.top = Math.round(tr.top + (tr.height - t.offsetHeight) / 2) + 'px';
    } else t.style.top = '';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), actLabel ? 8000 : 2600);
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    const t = S.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]').setAttribute('content', bg || '#f3f5fa');
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------------- backup ---------------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'sudoku', exported: new Date().toISOString(), data: S })], { type: 'application/json' });
    const file = new File([blob], `sudoku-backup-${today()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Sudoku backup' }).catch(() => { });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  }
  function importData() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (j.app !== 'sudoku' || !j.data || !j.data.stats) throw new Error('bad');
        alertBox('Restore Backup?', 'This replaces all progress on this iPhone.', [
          { label: 'Cancel' },
          { label: 'Restore', style: 'destructive', run: () => {
            localStorage.setItem(KEY, JSON.stringify(j.data));
            S = load(); applyTheme(); closeSheet(true); go('home'); toast('Backup restored');
          } },
        ]);
      } catch (e) { toast("That file isn't a Sudoku backup."); }
    };
    inp.click();
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case 'home': closeSheet(true); closeAlert(); paused = false; go('home'); save(); break;
      case 'tab-home': go('home'); break;
      case 'tab-stats': go('stats'); break;
      case 'stats-level': statsLevel = el.dataset.level; renderStats(); break;
      case 'new': newGameSheet(); break;
      case 'start': startNew(el.dataset.level); break;
      case 'continue': openSlot('free'); break;
      case 'daily': playDaily(); break;
      case 'restart': if (G() && G().status !== 'won') restartSheet(); break;
      case 'do-restart': restart(); break;
      case 'pause': paused = true; $('pv-time').textContent = fmtTime(G().elapsed / 1000); renderGame(); syncTicker(); break;
      case 'resume': paused = false; renderGame(); syncTicker(); break;
      case 'settings': settingsSheet(); break;
      case 'undo': undo(); break;
      case 'erase': erase(); break;
      case 'notes': { const g = G(); if (g) { g.notesMode = !g.notesMode; renderGame(); save(); } break; }
      case 'hint': hint(); break;
      case 'close': closeSheet(); break;
      case 'update': checkForUpdates(); break;
      case 'theme': S.settings.theme = el.dataset.theme; applyTheme(); save(); for (const b of el.parentNode.children) b.classList.toggle('on', b === el); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset-stats':
        alertBox('Reset Statistics?', 'Points, streaks and history will be erased. Games in progress are kept.', [
          { label: 'Cancel', style: 'bold' },
          { label: 'Reset', style: 'destructive', run: () => {
            const d = defaults(); S.stats = d.stats; S.weeks = {}; S.daily = {}; S.history = [];
            for (const k of ['free', 'daily']) if (S.slots[k]) S.slots[k].counted = false;
            save(true); closeSheet(); toast('Statistics reset');
          } },
        ]);
        break;
    }
  });

  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.set;
    if (!k) return;
    S.settings[k] = e.target.checked;
    save();
    if (route === 'game') renderGame();
  });

  $('sheet-backdrop').addEventListener('click', () => { if (!sheetLocked) closeSheet(); });

  // cells and digits react on touch-down: no 300ms wait, no missed fast taps
  $('board').addEventListener('pointerdown', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    e.preventDefault();
    select(+c.dataset.i);
  });
  $('pad').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    input(+b.dataset.d);
  });

  document.addEventListener('keydown', e => {
    if (route !== 'game' || !$('sheet-root').hidden || $('alert-root')) return;
    const g = G(); if (!g) return;
    if (e.key >= '1' && e.key <= '9') return input(+e.key);
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') return erase();
    const mv = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (mv) {
      e.preventDefault();
      let i = g.sel < 0 ? 40 : g.sel;
      const r = SD.ROW[i], c = SD.COL[i];
      if (mv === -9) i = ((r + 8) % 9) * 9 + c; else if (mv === 9) i = ((r + 1) % 9) * 9 + c;
      else if (mv === -1) i = r * 9 + (c + 8) % 9; else i = r * 9 + (c + 1) % 9;
      return select(i);
    }
    const k = e.key.toLowerCase();
    if (k === 'n') { g.notesMode = !g.notesMode; renderGame(); save(); }
    else if (k === 'z' || k === 'u') undo();
    else if (k === 'h') hint();
    else if (k === 'p' || k === ' ') { e.preventDefault(); paused = !paused; $('pv-time').textContent = fmtTime(g.elapsed / 1000); renderGame(); syncTicker(); }
  });

  // leaving the app pauses the clock; coming back shows the pause veil
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      syncTicker();
      const g = G();
      if (route === 'game' && g && g.status === 'playing') { paused = true; $('pv-time').textContent = fmtTime(g.elapsed / 1000); }
      save(true);
    } else {
      if (route === 'game') renderGame();
      if (route === 'home') renderHome(); // the day may have changed
      syncTicker();
    }
  });
  window.addEventListener('pagehide', () => save(true));

  /* ---------------- service worker / updates ----------------
     A new version installs in the background. Outside a game it applies on
     the spot; mid-game it waits and shows an "Update Available" row (home +
     Settings) and a toast. Settings → Check for Updates forces a check. */
  let swReg = null, updateReady = null;
  function applyUpdate() {
    const nw = updateReady || (swReg && swReg.waiting);
    if (nw) { save(true); nw.postMessage({ type: 'SKIP_WAITING' }); return true; }
    return false;
  }
  function checkForUpdates() {
    if (applyUpdate()) return;
    if (!swReg) { alertBox('Updates Unavailable', 'Open the app from the Home Screen to get updates.', [{ label: 'OK', style: 'bold' }]); return; }
    if (!navigator.onLine) { alertBox('You’re Offline', 'Connect to the internet to check for updates.', [{ label: 'OK', style: 'bold' }]); return; }
    toast('Checking for updates…');
    let settled = false;
    const finish = msg => { if (settled) return; settled = true; if (msg) alertBox(msg, `You have version ${VERSION}.`, [{ label: 'OK', style: 'bold' }]); };
    swReg.update().then(() => {
      const nw = swReg.installing || swReg.waiting;
      if (!nw) return finish('You’re Up to Date');
      if (nw.state === 'installed') { settled = true; updateReady = nw; applyUpdate(); return; }
      nw.addEventListener('statechange', () => { if (nw.state === 'installed') { settled = true; updateReady = nw; applyUpdate(); } });
      setTimeout(() => finish('Update Is Downloading'), 10000);
    }).catch(() => finish('Couldn’t Check for Updates'));
  }
  if ('serviceWorker' in navigator) {
    const busy = () => route === 'game' && G() && G().status === 'playing' && G().counted;
    const offer = nw => {
      if (!nw || !navigator.serviceWorker.controller) return;
      updateReady = nw;
      if (!busy()) { applyUpdate(); return; }
      if (route === 'home') renderHome();
      toast('A new version is ready', 'Update', applyUpdate);
    };
    navigator.serviceWorker.register('./sw.js').then(reg => {
      swReg = reg;
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed') offer(nw); });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (reg.waiting) offer(reg.waiting);
        reg.update().catch(() => { });
      });
    }).catch(() => { });
    let had = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) { had = true; return; }
      if (reloaded) return; reloaded = true; save(true); location.reload();
    });
  }

  /* ---------------- boot ---------------- */
  applyTheme();
  // a finished daily from a previous day is just history now
  if (S.slots.daily && S.slots.daily.daily !== today()) {
    if (S.slots.daily.status !== 'won') recordEnd(S.slots.daily, false);
    S.slots.daily = null;
    if (S.active === 'daily') S.active = 'free';
  }
  /* iOS freely kills a backgrounded home-screen app. Relaunching drops you
     straight back into the game you were in, paused, exactly as you left it. */
  {
    const g = G();
    if (S.route === 'game' && g && (g.status === 'playing' || g.status === 'over')) {
      paused = g.status === 'playing';
      go('game');
      $('pv-time').textContent = fmtTime(g.elapsed / 1000);
      if (g.status === 'over') setTimeout(gameOverAlert, 150);
    } else go(S.route === 'stats' ? 'stats' : 'home');
  }
  setTimeout(refillPregen, 2500);
  window.__sudoku = { get state() { return S; }, VERSION }; // for tests
})();
