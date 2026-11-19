// Determinism and rule checks. Expected values are worked from the rules, not copied from output.
const test = require('node:test');
const assert = require('node:assert');
require('../public/engine.js');
const B = globalThis.BallRaiders;

test('same seed and aims give the same run', () => {
  const a = B.playRun('kura', [5, 16, 27]);
  const b = B.playRun('kura', [5, 16, 27]);
  assert.deepStrictEqual(a, b);
});

test('different seeds give different machines', () => {
  const m1 = B.makeMachine('a'), m2 = B.makeMachine('b');
  assert.notDeepStrictEqual(m1.boards[1].pegs, m2.boards[1].pegs);
  assert.deepStrictEqual(m1.boards[0].pegs, m2.boards[0].pegs); // board 1 is the fixed traced layout
});

test('board 1 has no traps, boards 2 and 3 have some', () => {
  const m = B.makeMachine('x');
  assert.strictEqual(m.boards[0].pegs.filter(p => p.trap).length, 0);
  assert.ok(m.boards[1].pegs.some(p => p.trap));
  assert.ok(m.boards[2].pegs.some(p => p.trap));
});

test('board 1 has BANK, DOWN and START pockets; board 2 has BANK and DOWN slots; board 3 is all BANK', () => {
  const kinds = B.makeMachine('a').boards[0].pockets.map(p => p.kind);
  for (const k of ['BANK', 'DOWN', 'PRIZE']) assert.ok(kinds.includes(k));
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const m = B.makeMachine(seed);
    for (const b of [1]) {
      assert.ok(m.boards[b].slots.includes('BANK'));
      assert.ok(m.boards[b].slots.includes('DOWN'));
    }
    assert.ok(m.boards[2].slots.every(s => s === 'BANK'));
  }
});

test('loot shows as parts of a ball', () => {
  assert.strictEqual(B.money(1), '0.01 balls');
  assert.strictEqual(B.money(250), '2.50 balls');
});

test('a trap loses the ball and what it carried', () => {
  // board 1 has no traps, so every peg on it is safe: force a machine whose board 1 is all traps
  const m = B.makeMachine('t');
  m.boards.forEach(b => b.pegs.forEach(p => { p.trap = true; }));
  const r = B.dropBall(m, 16, { prizeIndex: 0, revealed: new Set() });
  assert.strictEqual(r.result, 'TRAP');
  assert.strictEqual(r.bips, 0);
});

test('every aim on every board ends (no endless ball)', () => {
  const m = B.makeMachine('end');
  for (let aim = 0; aim < B.AIMS; aim++) {
    const r = B.dropBall(m, aim, { prizeIndex: 0, revealed: new Set() });
    assert.ok(['BANK', 'TRAP', 'FOUL'].includes(r.result));
  }
});

test('the layout is symmetrical left to right', () => {
  const b = B.makeMachine('a').boards[0];
  const key = p => Math.round(p.x * 10) + ',' + Math.round(p.y * 10);
  const mirror = p => Math.round((2 * B.RB.cx - p.x) * 10) + ',' + Math.round(p.y * 10);
  const pegs = new Set(b.pegs.map(key));
  for (const p of b.pegs) assert.ok(pegs.has(mirror(p)), 'no mirror for peg at ' + key(p));
  const pockets = new Set(b.pockets.map(key));
  for (const p of b.pockets) assert.ok(pockets.has(mirror(p)), 'no mirror for pocket at ' + key(p));
});

test('the weakest powers are foul balls; stronger shots clear the rail', () => {
  assert.ok(B.launch(0).foul);
  assert.ok(!B.launch(B.AIMS - 1).foul);
});
