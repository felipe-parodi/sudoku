# Sudoku

Ad-free, offline Sudoku for iPhone. Add it to the Home Screen once; after that it
needs no internet. Progress lives on each phone.

Live: https://pipeparodi.com/sudoku/

## Install on an iPhone
1. Open the link above in **Safari**.
2. Share button → **Add to Home Screen** → Add.
3. Play from the Home Screen icon (Safari-tab progress and Home Screen progress are
   separate on iOS, so install first, then play).

## What's in it
- **Easy / Medium / Hard / Extreme**, generated on the phone — every puzzle is new and
  has exactly one solution. Difficulty is graded by the techniques a person needs:
  Easy = scanning only (hidden singles, 36–40 clues) · Medium = singles, 28–32 clues ·
  Hard = locked candidates / pairs / triples · Extreme = X-wing, swordfish, XY/XYZ-wing,
  quads — never guessing.
- **Daily puzzle** — same puzzle on every phone that day (seeded by date); daily streak.
- 3 mistakes = game over (second chance offered). A wrong number turns red, and so does
  the number it clashes with.
- Completed rows / columns / boxes, and the whole board at the end, wash blue in a
  right-to-left wave.
- Undo, erase, notes (auto-cleared when you place a number), hints that explain the
  logic ("7 has only one place in this box"), pause (auto on leaving the app).
- **Score** = numbers you placed × level points − 2× per mistake + finish bonus
  (15 cells' worth × speed vs. par × accuracy). Weekly points, win streaks, win rate,
  best/average times, recent games.
- Settings: mistake checking/limit, highlights, timer, light/dark/auto, backup/restore.

## Develop
```sh
python3 -m http.server 8650        # then http://localhost:8650/
node tools/test/engine.test.js     # engine: uniqueness, grader soundness, bins
node tools/test/e2e.test.js        # WebKit iPhone flow + offline (needs the server)
node tools/test/shots.js "iPhone 13"   # screenshots → tools/test/out/
node tools/make_icons.js           # icons/icon.svg → PNGs
```
`npm i` installs Playwright (pinned to 1.63 to match the cached browsers).

## Deploy
GitHub Pages from `main` (root). **Bump `VERSION` in both `sw.js` and `app.js`** on every
release, or installed phones keep the old version. Phones update the next time the app is
opened online (silently, unless a game is in progress — then a "Reload" toast).
