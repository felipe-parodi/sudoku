'use strict';
/* Sudoku — app shell. Everything lives on this phone (localStorage);
   puzzles are generated on-device by sudoku.js, so there is nothing to
   download after install and no two games are alike. */
(() => {
  const SD = window.Sudoku;
  const VERSION = '1.0.0'; // keep in sync with sw.js
  const KEY = 'sudoku:v1';
  const LEVELS = ['easy', 'medium', 'hard', 'extreme'];
  const LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Extreme' };
  const BLURB = {
    easy: 'Relaxed — lots of clues',
    medium: 'Fewer clues, simple logic',
    hard: 'Needs pairs & pointing',
    extreme: 'X-wings, wings & beyond',
  };
  const BASE = { easy: 30, medium: 60, hard: 120, extreme: 200 };   // points per correct cell
  const PAR = { easy: 300, medium: 600, hard: 1200, extreme: 1800 }; // seconds, for the time bonus
  const DAILY_LEVEL = ['medium', 'easy', 'medium', 'medium', 'hard', 'hard', 'extreme']; // Sun..Sat
  const MAX_MISTAKES = 3;
  const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const $ = id => document.getElementById(id);
  const ICON = {
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
  function createGame(level, daily = null) {
    const seed = daily ? SD.hashString('daily:' + daily) : crypto.getRandomValues(new Uint32Array(1))[0];
    const rng = SD.mulberry32(seed);
    let r = null;
    for (let k = 0; k < 2000 && !r; k++) r = SD.generate(level, rng);
    const p = r.puzzle;
    const sol = SD.solve(p, 1).solution;
    return {
      level, daily, puzzle: SD.stringify(p), solution: sol.join(''),
      values: p.slice(), notes: new Array(81).fill(0), awarded: new Array(81).fill(0),
      mistakes: 0, limit: MAX_MISTAKES, score: 0, hints: 0, elapsed: 0,
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

  function addPoints(g, pts) {
    g.score += pts;
    const k = weekKey();
    S.weeks[k] = (S.weeks[k] || 0) + pts;
  }
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
    const streak = dailyStreak();
    const totals = { played: 0, won: 0, streak: 0 };
    for (const l of LEVELS) { totals.played += S.stats[l].started; totals.won += S.stats[l].won; }
    totals.streak = S.history.length ? (() => { let n = 0; for (const h of S.history) { if (!h.won) break; n++; } return n; })() : 0;

    // this week's daily strip, Mon..Sun
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    let dots = '';
    for (let k = 0; k < 7; k++) {
      const d = new Date(monday); d.setDate(monday.getDate() + k);
      const key = ymd(d);
      dots += `<div><b class="${S.daily[key] ? 'on' : ''} ${key === t ? 'today' : ''}"></b>${'MTWTFSS'[k]}</div>`;
    }

    const dailyCard = `
      <div class="card">
        <h3>Daily puzzle · ${LABEL[dl]}</h3>
        <div class="hero" style="margin-top:10px">
          <div class="txt">
            <div class="t1">${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>
            <div class="t2">${dDone ? `Solved in ${fmtTime(dDone.time)} · ${fmtNum(dDone.score)} pts`
        : dSlot && dSlot.counted ? `In progress · ${fmtTime(dSlot.elapsed / 1000)}` : 'Same puzzle on every phone today'}</div>
            <div class="t2">${streak ? `${streak}-day streak` : 'Start a streak today'}</div>
          </div>
          ${dDone ? `<span class="check-chip">${ICON.check}Done</span>`
        : `<button class="pill-btn small" data-act="daily">${dSlot && dSlot.counted ? 'Resume' : 'Play'}</button>`}
        </div>
        <div class="week-dots">${dots}</div>
      </div>`;

    const cont = free ? `
      <div class="card">
        <h3>Continue</h3>
        <div class="hero" style="margin-top:10px">
          ${miniBoard(free)}
          <div class="txt">
            <div class="t1">${LABEL[free.level]}</div>
            <div class="t2">${fmtTime(free.elapsed / 1000)} · ${free.status === 'over' ? 'Out of mistakes' : `${filled(free)}/${toFill(free)} filled`}</div>
            <div class="progress"><i style="width:${(100 * filled(free) / toFill(free)).toFixed(1)}%"></i></div>
          </div>
        </div>
        <div class="btn-col" style="margin-top:14px"><button class="pill-btn wide" data-act="continue">${ICON.play}Continue</button></div>
      </div>` : '';

    $('home').innerHTML = `
      <div class="page">
        <div class="date-line">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div class="big-title">Sudoku</div>
        ${cont}
        <button class="pill-btn wide ${free ? 'ghost' : ''}" data-act="new">New Game</button>
        ${dailyCard}
        <div class="card">
          <div class="week-row"><h3>This week</h3><span class="n">${ICON.trophy}${fmtNum(wk)}</span></div>
          <div class="quick">
            <div><b>${totals.played}</b><span>Played</span></div>
            <div><b>${totals.won}</b><span>Won</span></div>
            <div><b>${totals.streak}</b><span>Win streak</span></div>
            <div><b>${streak}</b><span>Daily streak</span></div>
          </div>
        </div>
      </div>`;
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
      agg.streak = Math.max(agg.streak, s.streak); agg.bestStreak = Math.max(agg.bestStreak, s.bestStreak);
    }
    const rate = agg.started ? Math.round(100 * agg.won / agg.started) + '%' : '—';
    const avg = agg.won ? fmtTime(agg.total / agg.won) : '—';
    const hist = S.history.filter(h => statsLevel === 'all' || h.level === statsLevel).slice(0, 25);
    const tile = (k, n) => `<div class="tile"><div class="k">${k}</div><div class="n">${n}</div></div>`;
    const weeks = Object.keys(S.weeks).sort().reverse().slice(0, 1);
    const best = Math.max(0, ...Object.values(S.weeks));
    $('stats').innerHTML = `
      <div class="page">
        <div class="big-title" style="margin-top:6px">Statistics</div>
        <div class="seg">${['all', ...LEVELS].map(l => `<button data-act="stats-level" data-level="${l}" class="${l === statsLevel ? 'on' : ''}">${l === 'all' ? 'All' : LABEL[l]}</button>`).join('')}</div>
        <div class="section-h">Games</div>
        <div class="tiles">
          ${tile('Games started', agg.started)}${tile('Games won', agg.won)}
          ${tile('Win rate', rate)}${tile('Wins, no mistakes', agg.perfect)}
        </div>
        <div class="section-h">Time</div>
        <div class="tiles">${tile('Best time', agg.best == null ? '—' : fmtTime(agg.best))}${tile('Average time', avg)}</div>
        <div class="section-h">Streaks</div>
        <div class="tiles">
          ${tile('Current win streak', agg.streak)}${tile('Best win streak', agg.bestStreak)}
          ${tile('Daily streak', dailyStreak())}${tile('Dailies solved', Object.keys(S.daily).length)}
        </div>
        <div class="section-h">Points</div>
        <div class="tiles">${tile('This week', fmtNum(S.weeks[weekKey()] || 0))}${tile('Best week', fmtNum(best))}</div>
        <div class="section-h">Recent games</div>
        <div class="list">${hist.length ? hist.map(h => `
          <div class="row">
            <div><div>${LABEL[h.level]}${h.daily ? ' · Daily' : ''}</div><div class="sub">${new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${h.mistakes} mistake${h.mistakes === 1 ? '' : 's'}${h.hints ? ` · ${h.hints} hint${h.hints === 1 ? '' : 's'}` : ''}</div></div>
            <div class="r"><span class="tag ${h.won ? 'won' : ''}">${h.won ? 'Won' : 'Lost'}</span><div class="sub" style="margin-top:4px">${fmtTime(h.time)}${h.won ? ' · ' + fmtNum(h.score) : ''}</div></div>
          </div>`).join('') : '<div class="empty">No finished games yet.</div>'}</div>
      </div>`;
    void weeks;
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
      if (c.v.textContent !== txt) c.v.textContent = txt;
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
      const done = counts[d] >= 9;
      if (btn.classList.contains('done') !== done) {
        btn.classList.toggle('done', done);
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
      $('st-week').textContent = fmtTime(g.elapsed / 1000);
    } else {
      first.firstChild.textContent = 'This Week';
      $('st-week').innerHTML = ICON.trophy + fmtNum(S.weeks[weekKey()] || 0);
    }
    $('st-level').textContent = (g.daily ? 'Daily · ' : '') + LABEL[g.level];
    $('st-score').textContent = fmtNum(g.score);
    const m = $('st-mistakes');
    m.textContent = !S.settings.checkMistakes ? 'Off' : S.settings.mistakeLimit ? `${g.mistakes}/${g.limit}` : String(g.mistakes);
    m.classList.toggle('bad', S.settings.checkMistakes && g.mistakes > 0);
  }

  function anim(i, cls, ms, delay = 0) {
    const el = cells[i].el;
    setTimeout(() => {
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), ms);
    }, delay);
  }

  /* ---------------- timer ---------------- */
  let ticker = null, lastTick = 0, saveTick = 0;
  function running() {
    const g = G();
    return route === 'game' && g && g.status === 'playing' && !paused && document.visibilityState === 'visible' && $('sheet-root').hidden;
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
    g.sel = i; renderGame(); save();
  }

  function unitsCompleted(g, i) {
    const done = [];
    for (const u of SD.UNITS_OF[i]) if (SD.UNITS[u].every(j => correct(g, j))) done.push(u);
    return done;
  }
  // completed row / column / box: cells wash blue in a wave sweeping right → left
  function celebrateUnits(g, i, units) {
    const seen = new Set();
    for (const u of units) for (const j of SD.UNITS[u]) {
      if (seen.has(j)) continue; seen.add(j);
      anim(j, 'flash', 700, (8 - SD.COL[j]) * 45 + SD.ROW[j] * 12);
    }
  }

  function input(d) {
    const g = G(); if (!g || g.status !== 'playing' || paused) return;
    const i = g.sel; if (i < 0) return;
    if (locked(g, i)) {
      // tapping a digit on a filled cell just highlights that digit — but only for unlocked cells do we write
      return;
    }
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
        if (!g.awarded[i]) { g.awarded[i] = 1; addPoints(g, BASE[g.level]); }
        anim(i, 'pop', 240);
        const units = unitsCompleted(g, i);
        if (isSolved(g)) return win(g);
        if (units.length) celebrateUnits(g, i, units);
      } else {
        g.mistakes++;
        g.score = Math.max(0, g.score - BASE[g.level] * 2); // a mistake costs two cells' worth
        anim(i, 'shake', 380);
        if (S.settings.mistakeLimit && g.mistakes >= g.limit) {
          g.status = 'over';
          renderGame(); save(true); syncTicker();
          setTimeout(gameOverSheet, 420);
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

  function win(g) {
    g.status = 'won';
    const sec = g.elapsed / 1000;
    // finish bonus: faster than par pays more (0.5×–2×), and every mistake trims it by a fifth
    const speed = Math.min(2, Math.max(.5, PAR[g.level] / Math.max(sec, 1)));
    const care = Math.max(.2, 1 - .2 * g.mistakes - .1 * g.hints);
    const bonus = Math.round(BASE[g.level] * 15 * speed * care);
    addPoints(g, bonus);
    recordEnd(g, true);
    g.sel = -1; paused = false;
    renderGame(); save(true); syncTicker();
    for (let i = 0; i < 81; i++) anim(i, 'flash', 700, (8 - SD.COL[i]) * 70 + SD.ROW[i] * 18);
    setTimeout(() => winSheet(g, bonus), 1500);
  }

  function startNew(level, daily = null) {
    const slot = daily ? 'daily' : 'free';
    const old = S.slots[slot];
    if (old && old.status !== 'won') recordEnd(old, false);
    S.slots[slot] = createGame(level, daily);
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
    if (G().status === 'over') setTimeout(gameOverSheet, 150);
  }
  function playDaily() {
    const t = today();
    const s = S.slots.daily;
    if (s && s.daily === t && s.status !== 'won') return openSlot('daily');
    if (S.daily[t]) return;
    startNew(dailyLevel(t), t);
  }
  function restart() {
    const g = G(); if (!g) return;
    g.values = SD.parse(g.puzzle); g.notes = new Array(81).fill(0);
    g.mistakes = 0; g.limit = MAX_MISTAKES; g.undo = []; g.sel = -1; g.status = 'playing'; g.notesMode = false;
    g.elapsed = 0; g.score = 0; g.awarded = new Array(81).fill(0); g.hints = 0;
    paused = false;
    closeSheet(true); renderGame(); save(true); syncTicker();
  }

  /* ---------------- sheets ---------------- */
  let sheetLocked = false;
  function openSheet(html, { lock = false } = {}) {
    sheetLocked = lock;
    const root = $('sheet-root');
    $('sheet').innerHTML = (lock ? '' : '<div class="grabber"></div>') + html;
    root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    syncTicker();
  }
  function closeSheet(instant) {
    const root = $('sheet-root');
    if (root.hidden) return;
    root.classList.remove('open');
    const done = () => { root.hidden = true; syncTicker(); };
    if (instant) done(); else setTimeout(done, 280);
  }

  function newGameSheet() {
    const cur = S.slots.free && S.slots.free.status === 'playing' && S.slots.free.counted;
    openSheet(`
      <h2>New Game</h2>
      <p class="lead">Every puzzle is new, with exactly one solution.</p>
      <div class="levels">${LEVELS.map((l, k) => `
        <button class="level-btn" data-act="start" data-level="${l}">
          <span class="dots">${[0, 1, 2, 3].map(j => `<i class="${j <= k ? 'on' : ''}"></i>`).join('')}</span>
          <span class="t"><b>${LABEL[l]}</b><span>${BLURB[l]}</span></span>
          <span class="w">${S.stats[l].won ? `${S.stats[l].won} won` : ''}${S.stats[l].best != null ? `<br>best ${fmtTime(S.stats[l].best)}` : ''}</span>
        </button>`).join('')}
      </div>
      ${cur ? `<div class="warn">Your ${LABEL[S.slots.free.level]} game in progress will count as a loss.</div>` : ''}`);
  }

  function restartSheet() {
    const g = G();
    openSheet(`
      <h2>${g.daily ? 'Daily puzzle' : LABEL[g.level]}</h2>
      <div class="btn-col">
        <button class="pill-btn wide ghost" data-act="do-restart">Restart this puzzle</button>
        ${g.daily ? '' : '<button class="pill-btn wide" data-act="new">New game</button>'}
      </div>`);
  }

  function gameOverSheet() {
    const g = G(); if (!g || g.status !== 'over' || route !== 'game') return;
    openSheet(`
      <div class="big-mark bad"><span>${ICON.x}</span></div>
      <h2>Game Over</h2>
      <p class="lead">You made ${g.limit} mistakes.</p>
      <div class="btn-col">
        <button class="pill-btn wide" data-act="second-chance">Second chance</button>
        ${g.daily ? '<button class="pill-btn wide ghost" data-act="do-restart">Restart puzzle</button>'
        : '<button class="pill-btn wide ghost" data-act="new">New game</button>'}
        <button class="pill-btn wide ghost" data-act="home">Home</button>
      </div>`, { lock: true });
  }

  function winSheet(g, bonus) {
    if (route !== 'game') return;
    const st = S.stats[g.level];
    const sec = Math.floor(g.elapsed / 1000);
    const record = st.best === sec && st.won > 1;
    openSheet(`
      <div class="big-mark"><span>${ICON.check}</span></div>
      <h2>${g.mistakes === 0 && !g.hints ? 'Flawless!' : 'Solved!'}</h2>
      <p class="lead">${g.daily ? 'Daily puzzle · ' : ''}${LABEL[g.level]}${record ? ' · New best time' : ''}</p>
      <div class="result-grid">
        <div><div class="k">Time</div><div class="n">${fmtTime(sec)}</div></div>
        <div><div class="k">Score</div><div class="n">${fmtNum(g.score)}</div></div>
        <div><div class="k">Mistakes</div><div class="n">${g.mistakes}</div></div>
      </div>
      <p class="lead" style="margin:8px 0 0">Includes a ${fmtNum(bonus)}-point finish bonus for speed${g.mistakes ? '' : ' and no mistakes'}<br>Win streak ${st.streak} · ${st.won} ${LABEL[g.level]} game${st.won === 1 ? '' : 's'} won</p>
      <div class="btn-col">
        ${g.daily ? '' : `<button class="pill-btn wide" data-act="start" data-level="${g.level}">Next ${LABEL[g.level]} game</button>`}
        <button class="pill-btn wide ${g.daily ? '' : 'ghost'}" data-act="home">Home</button>
      </div>`, { lock: true });
  }

  function settingsSheet() {
    const st = S.settings;
    const sw = (key, title, desc = '') => `
      <label class="set-row"><div><div>${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>
        <span class="switch"><input type="checkbox" data-set="${key}" ${st[key] ? 'checked' : ''}><span></span></span></label>`;
    openSheet(`
      <h2>Settings</h2>
      <div class="set-group-h">Game</div>
      <div class="set-group">
        ${sw('checkMistakes', 'Check mistakes', 'Wrong numbers turn red right away')}
        ${sw('mistakeLimit', 'Mistake limit', 'Game over after 3 mistakes')}
        ${sw('autoNotes', 'Auto-remove notes', 'Placing a number clears it from notes nearby')}
        ${sw('showTimer', 'Show timer', 'In place of this week’s points')}
      </div>
      <div class="set-group-h">Highlights</div>
      <div class="set-group">
        ${sw('hlArea', 'Row, column & box')}
        ${sw('hlSame', 'Identical numbers')}
        ${sw('hlDupes', 'Duplicates', 'Same number twice in a row, column or box')}
      </div>
      <div class="set-group-h">Appearance</div>
      <div class="set-group" style="padding:10px">
        <div class="seg">${['auto', 'light', 'dark'].map(t => `<button data-act="theme" data-theme="${t}" class="${st.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="set-group-h">Your data</div>
      <div class="set-group">
        <button class="set-row btn" data-act="export">Back up progress…</button>
        <button class="set-row btn" data-act="import">Restore from backup…</button>
        <button class="set-row btn danger" data-act="reset-stats">Reset statistics</button>
      </div>
      <div class="foot">Sudoku ${VERSION} · works offline · no ads, no tracking<br>Progress is saved on this phone only.</div>`);
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
        if (!confirm('Replace everything on this phone with the backup?')) return;
        localStorage.setItem(KEY, JSON.stringify(j.data));
        S = load(); applyTheme(); closeSheet(true); go('home'); toast('Backup restored');
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
      case 'home': closeSheet(true); paused = false; go('home'); save(); break;
      case 'tab-home': go('home'); break;
      case 'tab-stats': go('stats'); break;
      case 'stats-level': statsLevel = el.dataset.level; renderStats(); break;
      case 'new': newGameSheet(); break;
      case 'start': startNew(el.dataset.level); break;
      case 'continue': openSlot('free'); break;
      case 'daily': playDaily(); break;
      case 'restart': restartSheet(); break;
      case 'do-restart': restart(); break;
      case 'pause': paused = true; $('pv-time').textContent = fmtTime(G().elapsed / 1000); renderGame(); syncTicker(); break;
      case 'resume': paused = false; renderGame(); syncTicker(); break;
      case 'settings': settingsSheet(); break;
      case 'undo': undo(); break;
      case 'erase': erase(); break;
      case 'notes': { const g = G(); if (g) { g.notesMode = !g.notesMode; renderGame(); save(); } break; }
      case 'hint': hint(); break;
      case 'second-chance': { const g = G(); g.limit++; g.status = 'playing'; closeSheet(); renderGame(); save(); setTimeout(syncTicker, 300); break; }
      case 'theme': S.settings.theme = el.dataset.theme; applyTheme(); save(); for (const b of el.parentNode.children) b.classList.toggle('on', b === el); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset-stats':
        if (confirm('Reset all statistics, points and history? Games in progress are kept.')) {
          const d = defaults(); S.stats = d.stats; S.weeks = {}; S.daily = {}; S.history = [];
          save(true); closeSheet(); toast('Statistics reset');
        }
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
  $('pad').addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('done')) return;
    e.preventDefault();
    input(+b.dataset.d);
  });

  document.addEventListener('keydown', e => {
    if (route !== 'game' || !$('sheet-root').hidden) return;
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

  /* ---------------- service worker ---------------- */
  if ('serviceWorker' in navigator) {
    const busy = () => route === 'game' && G() && G().status === 'playing' && G().counted;
    const offer = nw => {
      if (!nw || !navigator.serviceWorker.controller) return;
      if (!busy()) { nw.postMessage({ type: 'SKIP_WAITING' }); return; }
      toast('Update ready', 'Reload', () => nw.postMessage({ type: 'SKIP_WAITING' }));
    };
    navigator.serviceWorker.register('./sw.js').then(reg => {
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
  go('home');
  window.__sudoku = { get state() { return S; }, VERSION }; // for tests
})();
