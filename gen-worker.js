'use strict';
/* Generates puzzles off the main thread so taps never wait on the engine. */
importScripts('./sudoku.js');
self.onmessage = e => {
  const { level, seed } = e.data;
  const rng = Sudoku.mulberry32(seed);
  let r = null;
  for (let k = 0; k < 3000 && !r; k++) r = Sudoku.generate(level, rng);
  self.postMessage({ level, puzzle: r ? Sudoku.stringify(r.puzzle) : null });
};
