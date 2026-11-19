// BALL RAIDERS engine: the whole game's rules, loaded by the page and by the tests.
// Deterministic: a seed and a list of aim positions always give the same run.
// Loot is kept in whole units (1 unit = 0.000001 coin) so there is no float drift in totals.
// Physics uses only + - * / and Math.sqrt (correctly rounded everywhere), never sin/cos.
(function (root) {
  'use strict';

  const W = 360, H = 480;           // one board
  const BALL_R = 5, PEG_R = 4;
  const G = 0.12, BOUNCE = 0.55, WALL_BOUNCE = 0.5;
  const AIMS = 33;                  // aim snaps to 33 drop positions
  const SLOTS = 6;                  // bottom slots per board
  const SLOT_Y = H - 24;            // where a ball counts as landed
  const MAX_TICKS = 6000;           // a stuck ball banks what it has
  const BOARDS = 3;
  const BIPS = [1, 3, 8];           // per bump on board 1, 2, 3
  const TRAPS = [0, 4, 7];          // hidden trap pegs on board 1, 2, 3
  const PRIZES = ['x2', '+50', 'TRAP', 'x3', '+20', 'TRAP', 'x2', '+100'];
  const HOLE = { x: W / 2, y: 300, r: 10 }; // the prize-line hole, board 2 only

  // mulberry32: integer-only, the same on every engine
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFromText(text) {
    let h = 2166136261 >>> 0;     // FNV-1a
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  // Build the machine for a seed: three boards of pegs, traps, slot kinds, the prize line.
  function makeMachine(seedText) {
    const r = rng(seedFromText(String(seedText)));
    const boards = [];
    for (let b = 0; b < BOARDS; b++) {
      const pegs = [];
      for (let row = 0; row < 11; row++) {
        const y = 70 + row * 34;
        const odd = row % 2;
        for (let col = 0; col < 9; col++) {
          const x = 24 + col * 39 + (odd ? 19.5 : 0) + Math.floor(r() * 9) - 4;
          if (x > W - 14) continue;
          if (b === 1 && Math.abs(x - HOLE.x) < 22 && Math.abs(y - HOLE.y) < 22) continue;
          if (r() < 0.12) continue;  // gaps make each board different
          pegs.push({ x, y, trap: false });
        }
      }
      for (let t = 0; t < TRAPS[b]; t++) pegs[Math.floor(r() * pegs.length)].trap = true;
      // slot kinds: the last board is all BANK; others mix BANK and DOWN, at least one of each
      const slots = [];
      for (let s = 0; s < SLOTS; s++) slots.push(b === BOARDS - 1 ? 'BANK' : (r() < 0.5 ? 'BANK' : 'DOWN'));
      if (b < BOARDS - 1) {
        if (!slots.includes('BANK')) slots[Math.floor(r() * SLOTS)] = 'BANK';
        if (!slots.includes('DOWN')) slots[Math.floor(r() * SLOTS)] = 'DOWN';
      }
      boards.push({ pegs, slots });
    }
    const prizes = [];
    for (let i = 0; i < 12; i++) prizes.push(PRIZES[Math.floor(r() * PRIZES.length)]);
    return { seed: String(seedText), boards, prizes };
  }

  function aimX(aim) {
    return 14 + (aim * (W - 28)) / (AIMS - 1);
  }

  // One ball, start to finish. state = { prizeIndex, revealed:Set } is shared across a run.
  // Calls onTick(frame) if given, for drawing. Returns what happened.
  function dropBall(machine, aim, state, onTick) {
    let board = 0, x = aimX(aim), y = 12, vx = 0, vy = 0, bips = 0;
    let touching = new Set(), inHole = false, events = [];
    for (let tick = 0; tick < MAX_TICKS * BOARDS; tick++) {
      const B = machine.boards[board];
      vy += G;
      x += vx; y += vy;
      if (x < BALL_R) { x = BALL_R; vx = -vx * WALL_BOUNCE; }
      if (x > W - BALL_R) { x = W - BALL_R; vx = -vx * WALL_BOUNCE; }
      const now = new Set();
      for (let i = 0; i < B.pegs.length; i++) {
        const p = B.pegs[i];
        const dx = x - p.x, dy = y - p.y, rr = BALL_R + PEG_R;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        x = p.x + nx * rr; y = p.y + ny * rr;
        const vn = vx * nx + vy * ny;
        if (vn < 0) { vx -= (1 + BOUNCE) * vn * nx; vy -= (1 + BOUNCE) * vn * ny; }
        // a tiny push off the top of a peg so a ball never balances forever
        if (Math.abs(nx) < 0.05 && ny < 0) vx += (i % 2 ? 0.06 : -0.06);
        now.add(i);
        if (!touching.has(i)) {
          const key = board + ':' + i;
          if (p.trap) {
            state.revealed.add(key);
            events.push({ type: 'trap', board, x, y });
            if (onTick) onTick({ board, x, y, bips, done: 'trap' });
            return { result: 'TRAP', board, bips: 0, lost: bips, events };
          }
          bips += BIPS[board];
          events.push({ type: 'bump', board, peg: i, bips: BIPS[board] });
        }
      }
      touching = now;
      // the prize-line hole on board 2: a ball passing through takes the next prize
      if (board === 1) {
        const hx = x - HOLE.x, hy = y - HOLE.y;
        const inside = hx * hx + hy * hy < HOLE.r * HOLE.r;
        if (inside && !inHole) {
          const prize = machine.prizes[state.prizeIndex % machine.prizes.length];
          state.prizeIndex++;
          events.push({ type: 'prize', prize });
          if (prize === 'TRAP') {
            if (onTick) onTick({ board, x, y, bips, done: 'trap' });
            return { result: 'TRAP', board, bips: 0, lost: bips, events, prize };
          }
          if (prize[0] === 'x') bips *= Number(prize.slice(1));
          else bips += Number(prize.slice(1));
        }
        inHole = inside;
      }
      if (onTick) onTick({ board, x, y, bips });
      if (y >= SLOT_Y) {
        const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor((x / W) * SLOTS)));
        const kind = B.slots[slot];
        if (kind === 'DOWN' && board < BOARDS - 1) {
          board++; y = 12; vy = vy * 0.3; touching = new Set();
          events.push({ type: 'down', board });
          continue;
        }
        return { result: 'BANK', board, bips, events, slot };
      }
    }
    return { result: 'BANK', board, bips, events, stuck: true };
  }

  // A whole run without drawing: seed + aims (+ extra balls) -> total banked.
  function playRun(seedText, aims, balls) {
    const machine = makeMachine(seedText);
    const state = { prizeIndex: 0, revealed: new Set() };
    let banked = 0;
    const results = [];
    const n = Math.min(aims.length, balls || 3);
    for (let i = 0; i < n; i++) {
      const r = dropBall(machine, aims[i], state);
      if (r.result === 'BANK') banked += r.bips;
      results.push({ result: r.result, board: r.board, bips: r.bips });
    }
    return { banked, results };
  }

  // Display: whole units shown as a coin with 6 decimals. TICKER is a placeholder name.
  const TICKER = 'BALL';
  function money(units) {
    const s = String(Math.max(0, Math.floor(units))).padStart(7, '0');
    return s.slice(0, -6) + '.' + s.slice(-6) + ' ' + TICKER;
  }

  root.BallRaiders = {
    W, H, BALL_R, PEG_R, AIMS, SLOTS, SLOT_Y, BOARDS, BIPS, HOLE, TICKER,
    rng, seedFromText, makeMachine, aimX, dropBall, playRun, money,
  };
})(typeof window !== 'undefined' ? window : globalThis);
