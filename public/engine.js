// BALL RAIDERS engine: the whole game's rules, loaded by the page and by the tests.
// Deterministic: a seed and a list of aim positions always give the same run.
// Loot is parts of a ball, kept in whole units (100 units = 1 ball) so totals never drift.
// Physics uses only + - * / and Math.sqrt (correctly rounded everywhere), never sin/cos.
(function (root) {
  'use strict';

  const W = 360, H = 480;           // one board
  const BALL_R = 5, PEG_R = 4;
  const G = 0.095, BOUNCE = 0.42, WALL_BOUNCE = 0.4;
  const SUBSTEPS = 4;               // prevents tunneling through thin walls & pegs
  const AIMS = 33;                  // aim snaps to 33 drop positions
  const SLOTS = 6;                  // bottom slots per board
  const SLOT_Y = H - 24;            // where a ball counts as landed
  const MAX_TICKS = 6000;           // a stuck ball banks what it has
  const BOARDS = 3;
  const BIPS = [1, 3, 8];           // per bump on board 1, 2, 3
  const TRAPS = [0, 4, 7];          // hidden trap pegs on board 1, 2, 3
  const PRIZES = ['x2', '+50', 'TRAP', 'x3', '+20', 'TRAP', 'x2', '+100'];
  const HOLE = { x: W / 2, y: 300, r: 10 }; // the prize-line hole, board 2 only

  // Board 1: the nail layout traced (by eye, from kura's photos) from a real round 90s pachinko
  // machine. Coordinates are in the photo's pixels and mapped onto the board. Art is our own.
  const SRC = { cx: 805, cy: 1010, r: 565 };
  const RB = { cx: W / 2, cy: 245, r: 170 };
  const SC = RB.r / SRC.r;
  const sx = x => RB.cx + (x - SRC.cx) * SC;
  const sy = y => RB.cy + (y - SRC.cy) * SC;
  // The layout is symmetrical: left-side parts are listed once and mirrored to the right.
  const MX = x => 2 * SRC.cx - x;
  const mirrorRail = ([a, b]) => [[MX(a[0]), a[1]], [MX(b[0]), b[1]]];
  // rails: lines of nails the ball rolls along (from, to). Left side:
  const LEFT_RAILS = [
    [[470, 690], [650, 770]],    // top
    [[540, 840], [615, 995]],    // road down to the windmill
    [[360, 880], [330, 1060]],   // outer lane
    [[540, 1230], [700, 1300]],  // lower road
    [[470, 1240], [540, 1330]],  // guide to the lower IN pocket
  ];
  const CENTER_RAILS = [
    [[700, 700], [775, 745]],    // funnel into the top hole (left; mirrored below)
  ];
  const RAILS = [
    ...LEFT_RAILS,
    ...LEFT_RAILS.map(mirrorRail),
    ...CENTER_RAILS,
    ...CENTER_RAILS.map(mirrorRail),
  ];
  // single nails: either side of the start pocket, and the "S" cluster
  const NAILS = [[765, 1150], [MX(765), 1150], [775, 1275], [MX(775), 1275], [805, 1320]];
  // the screen and its topper are solid, with the top hole left open
  const SCREEN = [
    [600, 1130], [600, 880], [660, 820], [745, 785], null,
    [MX(745), 785], [MX(660), 820], [MX(600), 880], [MX(600), 1130], [600, 1130],
  ];
  const LEFT_POCKETS = [
    { x: 490, y: 800, r: 28, kind: 'BANK', label: 'IN' },
    { x: 418, y: 1280, r: 28, kind: 'BANK', label: 'IN' },
    { x: 592, y: 1388, r: 28, kind: 'BANK', label: 'IN' },
  ];
  const ROUND_POCKETS = [
    { x: 805, y: 778, r: 24, kind: 'DOWN', label: 'secret page' }, // top hole: warps to the next board
    ...LEFT_POCKETS,
    ...LEFT_POCKETS.map(p => Object.assign({}, p, { x: MX(p.x) })),
    { x: 805, y: 1170, r: 24, kind: 'PRIZE', label: 'START' },     // the start pocket = prize hole
  ];
  const WINDMILLS = [[502, 1070], [MX(502), 1070]]; // static round bumpers for now
  const GATE = [[700, 1400], [MX(700), 1400]];      // the OPEN gate, closed for now

  function line(a, b, step, out, extra) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy) / step));
    for (let i = 0; i <= n; i++) {
      out.push(Object.assign(
        { x: sx(a[0] + (dx * i) / n), y: sy(a[1] + (dy * i) / n), trap: false },
        extra || {}
      ));
    }
  }

  function makeRoundBoard() {
    const pegs = [], walls = [];
    const seg = (a, b, r) => walls.push({ x1: sx(a[0]), y1: sy(a[1]), x2: sx(b[0]), y2: sy(b[1]), r });
    for (const [a, b] of RAILS) {
      line(a, b, 30, pegs, { rail: true });
      seg(a, b, PEG_R);
    }
    for (const [x, y] of NAILS) pegs.push({ x: sx(x), y: sy(y), trap: false });
    for (let i = 0; i < SCREEN.length - 1; i++) {
      if (!SCREEN[i] || !SCREEN[i + 1]) continue;
      seg(SCREEN[i], SCREEN[i + 1], 2.2);
    }
    seg([745, 790], [805, 806], 2.2);
    seg([805, 806], [865, 790], 2.2); // floor under the top hole
    seg(GATE[0], GATE[1], 3);
    for (const [x, y] of WINDMILLS) {
      pegs.push({ x: sx(x), y: sy(y), trap: false, r: 45 * SC, windmill: true });
    }
    const pockets = ROUND_POCKETS.map(p => ({
      x: sx(p.x), y: sy(p.y), r: p.r * SC, kind: p.kind, label: p.label,
    }));
    const screen = { x: sx(600), y: sy(880), w: (1010 - 600) * SC, h: (1130 - 880) * SC };
    const gate = { x: sx(GATE[0][0]), y: sy(GATE[0][1]) - 3, w: (GATE[1][0] - GATE[0][0]) * SC, h: 6 };
    return { round: RB, pegs, walls, pockets, screen, gate, slots: [] };
  }

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
    boards.push(makeRoundBoard());
    for (let b = 1; b < BOARDS; b++) {
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
      for (let s = 0; s < SLOTS; s++) {
        slots.push(b === BOARDS - 1 ? 'BANK' : (r() < 0.5 ? 'BANK' : 'DOWN'));
      }
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

  // The handle: power 0..AIMS-1. The ball is shot from the bottom right and runs up the
  // launch rail just outside the field, along the frame, over the top. Where it leaves the
  // rail (top left) and how fast depends only on the power, so a shot is always the same.
  const RAIL_R = RB.r + 7;
  const LAUNCH_MIN = 3.7, LAUNCH_MAX = 4.8; // half strength; weakest powers roll back as fouls
  function launchSpeed(power) {
    return LAUNCH_MIN + (power * (LAUNCH_MAX - LAUNCH_MIN)) / (AIMS - 1);
  }

  // Walks the rail; calls onTick for drawing. Returns { foul } or the release point and velocity.
  function launch(power, onTick) {
    let ux = 0.77, uy = 0.64;           // start at about 4-5 o'clock (screen coords, y down)
    let sp = launchSpeed(power);
    for (let t = 0; t < 2000; t++) {
      const tx = uy, ty = -ux;          // direction of travel: up the right side, over the top
      sp += G * ty;                     // gravity along the rail
      if (sp <= 0) return { foul: true };
      ux += tx * (sp / RAIL_R);
      uy += ty * (sp / RAIL_R);
      const n = Math.sqrt(ux * ux + uy * uy);
      ux /= n;
      uy /= n;
      if (onTick) {
        onTick({ board: 0, x: RB.cx + ux * RAIL_R, y: RB.cy + uy * RAIL_R, bips: 0, rail: true });
      }
      if (ux <= -0.15 && uy < 0) {       // the end of the rail, just past the top: into the field
        const ex = uy, ey = -ux, lim = RB.r - BALL_R - 1;
        return { x: RB.cx + ux * lim, y: RB.cy + uy * lim, vx: ex * sp * 0.9, vy: ey * sp * 0.9 };
      }
    }
    return { foul: true };
  }

  // One ball, start to finish. state = { prizeIndex, revealed:Set } is shared across a run.
  // Calls onTick(frame) if given, for drawing. Returns what happened.
  function dropBall(machine, aim, state, onTick) {
    const shot = launch(aim, onTick);
    if (shot.foul) return { result: 'FOUL', board: 0, bips: 0, events: [] };

    let board = 0, x = shot.x, y = shot.y, vx = shot.vx, vy = shot.vy, bips = 0;
    let touching = new Set(), inHole = false, events = [];
    let still = 0, px0 = x, py0 = y, nudges = 0;

    function resetBoardMotion() {
      touching = new Set();
      inHole = false;
      still = 0;
      px0 = x;
      py0 = y;
      nudges = 0;
    }

    for (let tick = 0; tick < MAX_TICKS * BOARDS; tick++) {
      const B = machine.boards[board];
      vy += G;

      const maxSp = 10.5;
      const sp2 = vx * vx + vy * vy;
      if (sp2 > maxSp * maxSp) {
        const s = maxSp / Math.sqrt(sp2);
        vx *= s;
        vy *= s;
      }

      const stepVx = vx / SUBSTEPS;
      const stepVy = vy / SUBSTEPS;
      const now = new Set();

      for (let sub = 0; sub < SUBSTEPS; sub++) {
        x += stepVx;
        y += stepVy;

        if (B.round) {
          const R = B.round, dx = x - R.cx, dy = y - R.cy, lim = R.r - BALL_R;
          const d2 = dx * dx + dy * dy;
          if (d2 > lim * lim) {
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
            x = R.cx + nx * lim;
            y = R.cy + ny * lim;
            const vn = vx * nx + vy * ny;
            if (vn > 0) {
              vx -= (1 + WALL_BOUNCE) * vn * nx;
              vy -= (1 + WALL_BOUNCE) * vn * ny;
            }
          }
        } else {
          if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx) * WALL_BOUNCE; }
          if (x > W - BALL_R) { x = W - BALL_R; vx = -Math.abs(vx) * WALL_BOUNCE; }
        }

        if (B.walls) {
          for (const w of B.walls) {
            const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
            const len2 = ex * ex + ey * ey;
            if (len2 === 0) continue;
            let t = ((x - w.x1) * ex + (y - w.y1) * ey) / len2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx0 = w.x1 + ex * t, cy0 = w.y1 + ey * t;
            const dx = x - cx0, dy = y - cy0, rr = BALL_R + w.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 === 0) continue;
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
            x = cx0 + nx * rr;
            y = cy0 + ny * rr;
            const vn = vx * nx + vy * ny;
            if (vn < 0) {
              vx -= (1 + BOUNCE) * vn * nx;
              vy -= (1 + BOUNCE) * vn * ny;
            }
          }
        }

        for (let i = 0; i < B.pegs.length; i++) {
          const p = B.pegs[i];
          const dx = x - p.x, dy = y - p.y, rr = BALL_R + (p.r || PEG_R);
          const d2 = dx * dx + dy * dy;
          const reach = p.rail ? rr + 0.6 : rr;
          if (d2 >= reach * reach || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          if (!p.rail) {
            x = p.x + nx * rr;
            y = p.y + ny * rr;
            const vn = vx * nx + vy * ny;
            const restitution = p.windmill ? 0.68 : BOUNCE;
            if (vn < 0) {
              vx -= (1 + restitution) * vn * nx;
              vy -= (1 + restitution) * vn * ny;
            }
          }
          // a tiny push off the top of a peg so a ball never balances forever
          if (Math.abs(nx) < 0.08 && ny < 0) {
            vx += (i % 2 ? 0.09 : -0.09);
          }
          now.add(i);
          if (!touching.has(i)) {
            const key = board + ':' + i;
            if (p.trap) {
              state.revealed.add(key);
              events.push({ type: 'trap', board, x, y });
              if (onTick) onTick({ board, x, y, bips, done: 'trap' });
              return { result: 'TRAP', board, bips: 0, lost: bips, events };
            }
            if (!p.hidden) {
              bips += BIPS[board];
              events.push({ type: 'bump', board, peg: i, bips: BIPS[board] });
            }
          }
        }
      }
      touching = now;

      // a ball resting in a nook gets a fixed shove toward the middle (same every time, so still fair)
      if (++still >= 45) {
        const mx = x - px0, my = y - py0;
        if (mx * mx + my * my < 6) {
          nudges++;
          const towardCenter = B.round ? (B.round.cx - x) * 0.015 : (W / 2 - x) * 0.01;
          vx += (nudges % 2 ? 1.5 : -1.5) + towardCenter;
          vy += nudges >= 2 ? 1.8 : -1.2;
          if (nudges >= 4 && B.round) {
            x += (x < B.round.cx ? 12 : -12);
            y += 10;
            vy = 1.5;
          }
        }
        still = 0; px0 = x; py0 = y;
      }

      if (B.round) {
        let pk = null;
        for (const p of B.pockets) {
          const px = x - p.x, py = y - p.y;
          const capR = p.r * 1.15;
          if (px * px + py * py < capR * capR) { pk = p; break; }
        }
        const R = B.round, ox = x - R.cx, oy = y - R.cy;
        const outHole = !pk && oy > R.r * 0.88 && Math.abs(ox) < 34;
        if (pk && pk.kind === 'PRIZE') {
          const prize = machine.prizes[state.prizeIndex % machine.prizes.length];
          state.prizeIndex++;
          events.push({ type: 'prize', prize });
          if (prize === 'TRAP') {
            if (onTick) onTick({ board, x, y, bips, done: 'trap' });
            return { result: 'TRAP', board, bips: 0, lost: bips, events, prize };
          }
          if (prize[0] === 'x') bips *= Number(prize.slice(1));
          else bips += Number(prize.slice(1));
          if (onTick) onTick({ board, x, y, bips });
          return { result: 'BANK', board, bips, events, pocket: pk.label, prize };
        }
        if (pk && pk.kind === 'BANK') {
          if (onTick) onTick({ board, x, y, bips });
          return { result: 'BANK', board, bips, events, pocket: pk.label };
        }
        if ((pk && pk.kind === 'DOWN') || outHole) {
          if (onTick) onTick({ board, x, y, bips });
          board++;
          x = aimX(aim);
          y = 14;
          vx = 0;
          vy = Math.max(0.5, vy * 0.25);
          resetBoardMotion();
          events.push({ type: 'down', board, via: pk ? 'secret page' : 'out hole' });
          continue;
        }
        if (onTick) onTick({ board, x, y, bips });
        continue;
      }

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
          board++;
          y = 14;
          vy = Math.max(0.5, vy * 0.25);
          resetBoardMotion();
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
      if (r.result === 'FOUL') {
        results.push({ result: 'FOUL', board: 0, bips: 0 });
        continue;
      }
      results.push({ result: r.result, board: r.board, bips: r.bips });
    }
    return { banked, results };
  }

  // Loot is parts of a new ball: 100 units = 1 whole ball. Banked whole balls become lives.
  const TICKER = 'balls';
  function money(units) {
    const s = String(Math.max(0, Math.floor(units))).padStart(3, '0');
    return s.slice(0, -2) + '.' + s.slice(-2) + ' ' + TICKER;
  }

  root.BallRaiders = {
    RB, W, H, BALL_R, PEG_R, AIMS, SLOTS, SLOT_Y, BOARDS, BIPS, HOLE, TICKER,
    rng, seedFromText, makeMachine, aimX, launch, launchSpeed, RAIL_R, dropBall, playRun, money,
  };
})(typeof window !== 'undefined' ? window : globalThis);
