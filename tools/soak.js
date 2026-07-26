/* ============================================================
   DEADMAN VOLLEY — tools/soak.js
   Headless simulation harness.

   Loads the game's logic modules (no rendering, no DOM) and
   plays rooms with a scripted bot so balance and stability can
   be checked without a browser.

     node tools/soak.js                  # default sweep
     node tools/soak.js --vessel=wraith --rooms=40
     node tools/soak.js --watchdog=2000  # ms per frame before abort

   Exits non-zero if any frame throws or trips the watchdog.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---------- args ---------- */
const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const WATCHDOG = Number(args.watchdog || 4000);
const SEED = Number(args.seed || 12345);
const VERBOSE = !!args.verbose;

/* ============================================================
   Minimal browser shims — enough for the logic modules.
   Nothing here draws; draw() is never called.
   ============================================================ */
const noop = () => { };
const sandbox = {
  console,
  Math, Date, JSON, performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: noop,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.navigator = { getGamepads: () => [] };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
sandbox.document = {
  readyState: 'complete',
  addEventListener: noop, removeEventListener: noop,
  getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, addEventListener: noop }),
};
sandbox.addEventListener = noop;
sandbox.removeEventListener = noop;

vm.createContext(sandbox);

/* load only the logic modules — ui.js and game.js are DOM-bound */
const MODULES = ['util.js', 'audio.js', 'input.js', 'fx.js', 'touch.js', 'content.js', 'entities.js', 'arena.js', 'map.js'];
for (const f of MODULES) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'js/' + f });
}
const DV = sandbox.DV;
const U = DV.U, C = DV.Content, IN = DV.Input;

/* --stage=portrait runs the identical sweep on the mobile vertical arena,
   which is how we prove the geometry refactor did not break the game. */
const STAGE_MODE = args.stage || 'desktop';
if (STAGE_MODE === 'portrait') DV.setStage(720, 1280, { touch: true });
else if (STAGE_MODE === 'landscape') DV.setStage(1280, 720, { touch: true });
console.log(`stage: ${STAGE_MODE} (${DV.STAGE.w}x${DV.STAGE.h}, touch=${DV.STAGE.touch})`);

/* ============================================================
   Fake Game shell (the part arena.js actually touches)
   ============================================================ */
function buildStats(vesselId, sigilIds, overrides) {
  const st = JSON.parse(JSON.stringify(C.BASE_STATS));
  st.powerMult = 1; st.maxHpMult = 1;
  const merge = (d) => {
    for (const k in d) {
      const v = d[k];
      if (k === 'critMult') st[k] = Math.max(st[k] || 0, v);
      else if (k.endsWith('Mult')) st[k] = (st[k] != null ? st[k] : 1) * v;
      else st[k] = (st[k] || 0) + v;
    }
  };
  const vessel = C.VESSEL_MAP[vesselId];
  merge(vessel.stats || {});
  for (const id of sigilIds) { const s = C.SIGIL_MAP[id]; if (s && s.stats) merge(s.stats); }
  st.maxHp = Math.max(20, Math.round(st.maxHp * (st.maxHpMult || 1)));
  st.dashCharges = Math.max(1, Math.round(st.dashCharges));
  Object.assign(st, overrides || {});
  return st;
}

function makeGame(vesselId, sigilIds, techIds, statOverrides) {
  const vessel = C.VESSEL_MAP[vesselId];
  const stats = buildStats(vesselId, sigilIds, statOverrides);
  const run = {
    seed: SEED, vessel, sigils: sigilIds.map(id => C.SIGIL_MAP[id]).filter(Boolean),
    techs: techIds.slice(), stats,
    hp: stats.maxHp, ki: stats.kiMax, shards: 0, shardsEarned: 0,
    sectorN: 1, roomsCleared: 0, kills: 0, parries: 0, perfects: 0, bestRally: 0,
    damageDealt: 0, damageTaken: 0, deadmanStacks: 0, ascension: 0,
  };
  const game = {
    run, meta: {},
    onRoomCleared() { game._cleared = true; },
    onRunEnd() { game._dead = true; },
  };
  return game;
}

/* ============================================================
   The bot
   ============================================================ */
function installBot(getArena) {
  IN.moveVec = () => {
    const a = getArena(); if (!a || !a.player) return { x: 0, y: 0, mag: 0 };
    const p = a.player; let bx = 0, by = 0;
    for (const o of a.orbs) {
      if (o.owner !== 'enemy') continue;
      const d = U.dist(p.x, p.y, o.x, o.y);
      if (d < 190) { const g = U.angTo(o.x, o.y, p.x, p.y), w = (190 - d) / 190; bx += Math.cos(g) * w * 2; by += Math.sin(g) * w * 2; }
    }
    for (const e of a.enemies) {
      const d = U.dist(p.x, p.y, e.x, e.y);
      if (d < 210) { const g = U.angTo(e.x, e.y, p.x, p.y), w = (210 - d) / 210; bx += Math.cos(g) * w * 1.6; by += Math.sin(g) * w * 1.6; }
    }
    const cx = a.bounds.x + a.bounds.w / 2, cy = a.bounds.y + a.bounds.h / 2;
    const ca = U.angTo(p.x, p.y, cx, cy), cd = U.dist(p.x, p.y, cx, cy);
    bx += Math.cos(ca) * Math.min(1, cd / 300) * 0.7; by += Math.sin(ca) * Math.min(1, cd / 300) * 0.7;
    const m = Math.hypot(bx, by); if (m > 1) { bx /= m; by /= m; }
    return { x: bx, y: by, mag: Math.min(1, m) };
  };
  IN.aimAngle = (x, y) => {
    const a = getArena(); if (!a) return 0;
    let best = null, bd = Infinity;
    for (const e of a.enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      const sc = U.dist(x, y, e.x, e.y) * 0.3 + (e.parry ? e.parry.skill : 0) * 400;
      if (sc < bd) { bd = sc; best = e; }
    }
    return best ? U.angTo(x, y, best.x, best.y) : 0;
  };
  IN.parryHit = () => {
    const a = getArena(); if (!a || !a.player) return false;
    const p = a.player;
    if (p.parryT > 0 || p.parryCd > 0 || p.whiff > 0) return false;
    for (const o of a.orbs) {
      if (((o.x - p.x) * o.vx + (o.y - p.y) * o.vy) >= 0) continue;
      const lead = (U.dist(p.x, p.y, o.x, o.y) - p.parryRadius * 0.55) / Math.max(1, o.speed);
      if (lead < p.perfectWindow * 0.8 && lead > -0.02) return true;
    }
    return false;
  };
  /* Alternates between releasing exactly on the full-charge beat (perfect) and
     letting go early, so both fire paths get exercised. */
  IN.fireDown = () => {
    const a = getArena(); if (!a || !a.player) return false;
    const p = a.player;
    if (a.orbs.some(o => o.owner === 'player' && !o.live)) return false;
    if (!p.charging) return (a.time % 1.4) < 0.7;
    const wantPerfect = Math.floor(a.time / 3) % 2 === 0;
    return wantPerfect ? p.charge < 1 : p.charge < 0.55;
  };
  IN.fireHit = () => false;
  IN.fireUp = () => false;
  IN.act = () => false;
  IN.actHit = (n) => {
    const a = getArena(); if (!a || !a.player) return false;
    if (a.player.ki < 70) return false;
    if (n === 'tech1') return (a.time % 5) < 0.017;
    if (n === 'tech2') return (a.time % 6.7) < 0.017;
    return false;
  };
  IN.pollPad = noop; IN.endFrame = noop; IN.clearAll = noop;
  IN.mouse = { x: 640, y: 360 };
}

/* ============================================================
   Global instrumentation
   Wraps the real methods so the sweep passively proves the
   invariants instead of us hoping they hold.
   ============================================================ */
const probe = {
  parryTimes: new Map(),   // orb id -> last parry time
  doubleParries: [],       // violations of the 0.30s lockout
  selfParries: [],         // player-owned orbs parried without the relic
  shieldBreaks: 0,
  perfectReleases: 0,
  liveOrbs: 0,
};

(function instrument() {
  const AP = DV.Arena.prototype;

  /* Count enemy returns so the lockout assertion can tell a legitimate fast
     rally (enemy sent it back, it is a fresh threat) from the actual bug
     (one press re-parrying the same orb with nothing in between). */
  const realEnemyParry = AP.enemyParry;
  AP.enemyParry = function (e, orb) {
    orb._exchange = (orb._exchange || 0) + 1;
    return realEnemyParry.call(this, e, orb);
  };

  /* Techniques (Phase Step, Shear) deliberately seize any orb they cross — that
     is their printed effect, and they are Ki-costed and on cooldown. They are
     allowed to bypass the lockout; the assertion covers hand-parries only. */
  const realExecTech = AP.execTech;
  AP.execTech = function (t) {
    probe.inTech = true;
    try { return realExecTech.call(this, t); }
    finally { probe.inTech = false; }
  };

  const realParry = AP.parryOrb;
  AP.parryOrb = function (orb, forced, aim) {
    const last = probe.parryTimes.get(orb.id);
    const ex = orb._exchange || 0;
    if (!probe.inTech && last && this.time - last.t < 0.30 - 1e-6 && ex === last.ex) {
      probe.doubleParries.push({ id: orb.id, gap: +(this.time - last.t).toFixed(4) });
    }
    if (orb.owner === 'player' && !orb.live && !this.st.selfVolley) {
      probe.selfParries.push({ id: orb.id, volley: orb.volley });
    }
    probe.parryTimes.set(orb.id, { t: this.time, ex });
    const out = realParry.call(this, orb, forced, aim);
    if (orb.live) probe.liveOrbs++;
    return out;
  };

  const EP = DV.Enemy.prototype;
  const realBreak = EP.breakShield;
  EP.breakShield = function (a) {
    const was = this.shieldBroken;
    const out = realBreak.call(this, a);
    if (!was && this.shieldBroken) probe.shieldBreaks++;
    return out;
  };

  const PP = DV.Player.prototype;
  const realFire = PP.fire;
  PP.fire = function (a) {
    const out = realFire.call(this, a);
    if (this.lastReleasePerfect) probe.perfectReleases++;
    return out;
  };
})();

/* ============================================================
   Targeted checks — deterministic, no reliance on the bot
   getting lucky during the sweep.
   ============================================================ */
function targetedChecks() {
  const fails = [];
  const mkArena = (sigils, overrides) => {
    const game = makeGame('ronin', sigils || [], ['phase_step', 'shear'], overrides || { maxHp: 5000 });
    const room = { index: 1, type: 'combat', sector: 1, depth: 1, waves: [[{ id: 'husk', count: 1 }]] };
    const a = new DV.Arena(game, room);
    a.startFight();
    return a;
  };

  /* --- 1. your own orb is inert without the relic --- */
  {
    const a = mkArena();
    const p = a.player;
    const orb = a.spawnOrb({
      x: p.x + 30, y: p.y, angle: Math.PI, speed: 200,
      owner: 'player', damage: 20, r: 12, volley: 1, grace: 0,
    });
    p.parryT = p.parryWindow;
    a.resolveOrbCollisions(1 / 60);
    if (orb.volley !== 1) fails.push('self-parry: own orb was parried without Both Hands');
    if (orb.live) fails.push('self-parry: own orb went live without the relic');
  }

  /* --- 2. Both Hands re-opens it, and the orb turns LIVE --- */
  {
    const a = mkArena(['both_hands']);
    const p = a.player;
    if (!a.st.selfVolley) fails.push('both_hands: selfVolley stat did not resolve');
    const orb = a.spawnOrb({
      x: p.x + 30, y: p.y, angle: Math.PI, speed: 200,
      owner: 'player', damage: 20, r: 12, volley: 1, grace: 0,
    });
    p.parryT = p.parryWindow;
    a.resolveOrbCollisions(1 / 60);
    if (orb.volley !== 2) fails.push(`both_hands: own orb not parried (volley=${orb.volley})`);
    if (!orb.live) fails.push('both_hands: parried own orb did not turn LIVE');
    if (!orb.hostile) fails.push('both_hands: LIVE orb is not hostile to the player');
    if (orb.owner !== 'player') fails.push('both_hands: LIVE orb lost player ownership (would stop hurting enemies)');
  }

  /* --- 3. an orb cannot be re-parried inside the lockout --- */
  {
    const a = mkArena(['both_hands']);
    const p = a.player;
    const orb = a.spawnOrb({
      x: p.x + 30, y: p.y, angle: Math.PI, speed: 200,
      owner: 'enemy', damage: 20, r: 12, volley: 0, grace: 0,
    });
    p.parryT = p.parryWindow;
    a.resolveOrbCollisions(1 / 60);
    const after = orb.volley;
    /* keep it in reach and the window open, then hammer it */
    for (let i = 0; i < 20; i++) {
      orb.x = p.x + 20; orb.y = p.y;
      p.parryT = p.parryWindow;
      a.resolveOrbCollisions(1 / 60);
    }
    if (orb.volley !== after) {
      fails.push(`lockout: orb re-parried ${orb.volley - after}x inside 0.30s (this was the 5-per-click bug)`);
    }
  }

  /* --- 4. a 3+ rally shatters a shield; a weak orb does not --- */
  {
    const a = mkArena();
    const weak = a.spawnEnemy('sentinel', 400, 300);
    weak.spawnT = 0; weak.facing = 0;                       // shield faces +x
    const inc = { vx: -100, vy: 0, volley: 1, color: '#fff' };  // arriving from +x
    a.hitEnemy(weak, 100, { orb: inc, source: 'test' });
    if (weak.shieldBroken) fails.push('shield: a volley-1 orb broke the shield');

    const strong = a.spawnEnemy('sentinel', 700, 300);
    strong.spawnT = 0; strong.facing = 0;
    const hpBefore = strong.hp;
    a.hitEnemy(strong, 100, { orb: { vx: -100, vy: 0, volley: 3, color: '#fff' }, source: 'test' });
    if (!strong.shieldBroken) fails.push('shield: a volley-3 orb failed to break the shield');
    if (hpBefore - strong.hp < 90) fails.push(`shield: break-through was still mitigated (dealt ${(hpBefore - strong.hp).toFixed(1)} of 100)`);
    if (strong.blocks(Math.PI)) fails.push('shield: blocks() still true after breaking');
  }

  /* --- 5. perfect release pays out, late release does not --- */
  {
    const a = mkArena();
    const p = a.player;
    p.charge = 1; p.chargeFullT = a.time;                 // released on the beat
    const good = p.fire(a);
    if (!p.lastReleasePerfect) fails.push('perfect release: on-beat release not detected');
    if (good.volley !== 2) fails.push(`perfect release: expected volley 2, got ${good.volley}`);

    p.charge = 1; p.chargeFullT = a.time - 1.0;           // long past the window
    const late = p.fire(a);
    if (p.lastReleasePerfect) fails.push('perfect release: late release wrongly counted as perfect');
    if (late.volley !== 1) fails.push(`perfect release: late shot should be volley 1, got ${late.volley}`);
    if (!(good.damage > late.damage * 1.4)) {
      fails.push(`perfect release: bonus too small (${good.damage.toFixed(1)} vs ${late.damage.toFixed(1)})`);
    }
  }

  return fails;
}

/* ============================================================
   Run one room
   ============================================================ */
function runRoom(game, room, opts) {
  opts = opts || {};
  let arena = new DV.Arena(game, room);
  game._cleared = false; game._dead = false;
  installBot(() => arena);

  const stats = { frames: 0, peakOrbs: 0, peakEnemies: 0, slowestFrame: 0, slowestAt: 0 };
  const maxFrames = opts.maxFrames || 60 * 90;   // 90 in-game seconds

  while (stats.frames < maxFrames && !game._cleared && !game._dead) {
    const t0 = Date.now();
    arena.update(1 / 60);
    const took = Date.now() - t0;
    if (took > stats.slowestFrame) { stats.slowestFrame = took; stats.slowestAt = stats.frames; }
    if (took > WATCHDOG) {
      const err = new Error(
        `WATCHDOG: frame ${stats.frames} took ${took}ms ` +
        `(orbs=${arena.orbs.length} enemies=${arena.enemies.length} ` +
        `state=${arena.state} room=${room.type}/${room.bossId || ''})`);
      err.arena = arena;
      throw err;
    }
    stats.frames++;
    stats.peakOrbs = Math.max(stats.peakOrbs, arena.orbs.length);
    stats.peakEnemies = Math.max(stats.peakEnemies, arena.enemies.length);
    /* keep the bot alive so we test full rooms, not survival */
    if (opts.godMode) { arena.player.hp = arena.st.maxHp; game.run.hp = arena.st.maxHp; }
  }
  stats.cleared = game._cleared;
  stats.died = game._dead;
  stats.timedOut = stats.frames >= maxFrames;
  return stats;
}

/* ============================================================
   Sweep
   ============================================================ */
const ALL_SIGILS = C.SIGILS.map(s => s.id);
const ALL_TECHS = C.TECHNIQUES.map(t => t.id);

function fakeNode(sector, depth, type, bossId, modifier, seed) {
  return { id: depth, row: depth, col: 0, type, bossId, modifier, depth, sector, seed };
}

function main() {
  const results = [];
  const failures = [];
  const vessels = args.vessel ? [args.vessel] : C.VESSELS.map(v => v.id);

  /* deterministic invariant checks first — cheap, and they fail loudly */
  const checkFails = targetedChecks();
  if (checkFails.length) {
    console.log('\n──────── TARGETED CHECKS ────────');
    for (const f of checkFails) console.error('  ✗ ' + f);
  } else {
    console.log('✓ targeted checks: self-parry gating, Both Hands, parry lockout, shield break, perfect release');
  }
  for (const f of checkFails) failures.push({ label: 'check', msg: f, stack: '' });

  for (const vId of vessels) {
    /* every sigil bound at once — the worst case for hook interactions */
    const sigils = args.sigils === 'none' ? [] : ALL_SIGILS;

    for (let sector = 1; sector <= 4; sector++) {
      const bossId = C.SECTORS[sector - 1].boss;

      /* pair up techniques so every one gets exercised */
      for (let ti = 0; ti < ALL_TECHS.length; ti += 2) {
        const techs = [ALL_TECHS[ti], ALL_TECHS[ti + 1] || ALL_TECHS[0]];
        const game = makeGame(vId, sigils, techs, { maxHp: 12000, noDash: 0 });
        game.run.sectorN = sector;

        const jobs = [];
        const node = fakeNode(sector, 5, 'combat', null, null, (SEED + sector * 31 + ti) >>> 0);
        jobs.push(DV.MapGen.buildRoom(node, game.run));
        const en = fakeNode(sector, 7, 'elite', null, 'keen', (SEED + sector * 97 + ti) >>> 0);
        en.type = 'elite';
        jobs.push(DV.MapGen.buildRoom(en, game.run));
        if (ti === 0) jobs.push({ index: 999, type: 'boss', sector, depth: 12, bossId, waves: [] });

        for (const room of jobs) {
          const label = `${vId}/s${sector}/${room.type}${room.bossId ? ':' + room.bossId : ''}/t${ti}`;
          try {
            const st = runRoom(game, room, { godMode: true, maxFrames: room.type === 'boss' ? 60 * 240 : 60 * 90 });
            results.push({ label, ...st });
            if (VERBOSE || st.slowestFrame > 60) {
              console.log(`  ${label}  frames=${st.frames} orbs=${st.peakOrbs} en=${st.peakEnemies} ` +
                `slowest=${st.slowestFrame}ms ${st.cleared ? 'CLEAR' : st.timedOut ? 'TIMEOUT' : 'DEAD'}`);
            }
          } catch (e) {
            failures.push({ label, msg: e.message, stack: (e.stack || '').split('\n').slice(1, 4).join('\n') });
            console.error(`  FAIL ${label}: ${e.message}`);
          }
        }
      }
    }
    console.log(`✓ ${vId} done (${results.length} rooms so far, ${failures.length} failures)`);
  }

  /* ---------- report ---------- */
  const slow = results.slice().sort((a, b) => b.slowestFrame - a.slowestFrame).slice(0, 5);
  const timeouts = results.filter(r => r.timedOut);
  console.log('\n──────── SOAK REPORT ────────');
  console.log(`stage           : ${STAGE_MODE} ${DV.STAGE.w}x${DV.STAGE.h}`);
  console.log(`rooms simulated : ${results.length}`);
  console.log(`failures        : ${failures.length}`);
  console.log(`timeouts        : ${timeouts.length}${timeouts.length ? ' -> ' + timeouts.slice(0, 6).map(t => t.label).join(', ') : ''}`);
  console.log(`peak orbs       : ${Math.max(...results.map(r => r.peakOrbs), 0)}`);
  console.log(`peak enemies    : ${Math.max(...results.map(r => r.peakEnemies), 0)}`);
  console.log('slowest frames  :');
  for (const s of slow) console.log(`   ${s.slowestFrame}ms  ${s.label} (frame ${s.slowestAt}, orbs ${s.peakOrbs})`);

  /* ---- invariants observed across the whole sweep ---- */
  console.log('\n──────── INVARIANTS ────────');
  const inv = (ok, label, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures.push({ label: 'invariant', msg: label + ' ' + (detail || ''), stack: '' });
  };
  inv(probe.doubleParries.length === 0, 'no orb re-parried within 0.30s without an enemy return',
    probe.doubleParries.length ? `${probe.doubleParries.length} violations, e.g. gap ${probe.doubleParries[0].gap}s` : 'lockout holding');
  inv(probe.selfParries.length === 0, 'own orbs never parried without Both Hands',
    probe.selfParries.length ? `${probe.selfParries.length} violations` : 'gating holding');
  inv(probe.shieldBreaks > 0, 'shield break-through exercised', `${probe.shieldBreaks} shields shattered`);
  inv(probe.perfectReleases > 0, 'perfect release exercised', `${probe.perfectReleases} on-beat releases`);
  inv(probe.liveOrbs > 0, 'LIVE (Both Hands) orbs exercised', `${probe.liveOrbs} self-parries`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures.slice(0, 10)) console.log(` • ${f.label}\n   ${f.msg}\n${f.stack}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main();
