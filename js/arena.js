/* ============================================================
   DEADMAN VOLLEY — arena.js
   The combat scene: spawning, waves, collision, the parry
   pipeline, techniques, and all in-game rendering + HUD.
   ============================================================ */
(function () {
  const U = DV.U, FX = DV.FX, R = U.rnd, A = DV.Audio, C = DV.Content;

  /* Logical stage size. Mutable: mobile reshapes it (see DV.STAGE). */
  let W = DV.STAGE.w, H = DV.STAGE.h;
  DV.onStage(() => { W = DV.STAGE.w; H = DV.STAGE.h; });

  /* rally needed to punch through a Sentinel's shield — mirrored in entities.js */
  const SHIELD_BREAK_VOLLEY = 3;

  /* Haptics. Android-only in practice; a silent no-op everywhere else. */
  function buzz(pattern) {
    const g = DV.Game;
    if (!g || !g.touch || !g.settings || !g.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { } }
  }

  /* Arena inset. On touch the bottom band is reserved for thumbs so the
     action never hides under the player's hands. */
  function computeBounds() {
    const st = DV.STAGE;
    if (!st.touch) {
      const pad = 74;
      return { x: pad, y: pad + 24, w: W - pad * 2, h: H - pad * 2 - 24 };
    }
    const padX = st.portrait ? 34 : 56;
    const top = st.portrait ? 104 : 74;
    /* must equal DV.Touch's control band, or buttons overlap the playfield */
    const bottom = st.portrait ? 310 : 160;
    return { x: padX, y: top, w: W - padX * 2, h: H - top - bottom };
  }

  class Arena {
    constructor(game, room) {
      this.game = game;
      this.run = game.run;
      this.room = room;
      this.st = this.run.stats;
      this.rng = U.makeRNG((this.run.seed + room.index * 7919) >>> 0);

      this.bounds = computeBounds();

      this.time = 0;
      this.realTime = 0;
      this.orbs = [];
      this.enemies = [];
      this.pickups = [];
      this.wells = [];
      this.decoy = null;
      this.hazards = [];

      this.sector = C.SECTORS[Math.min(3, room.sector - 1)];
      this.dmgMult = this.sector.dmgMult;
      this.hpMult = this.sector.hpMult;
      this.modifier = room.modifier ? C.MODIFIERS.find(m => m.id === room.modifier) : null;

      this.player = new DV.Player(W / 2, H * 0.68, this.st, this.run.vessel);
      this.player.hp = this.run.hp;
      this.player.maxHp = this.st.maxHp;
      this.player.ki = this.run.ki != null ? this.run.ki : this.st.kiMax * 0.5;
      this.player.techs = this.run.techs.slice();
      this.player.revives = this.st.revives || 0;
      this.player.deadmanStacks = this.run.deadmanStacks || 0;

      this.wave = 0;
      this.waves = room.waves || [];
      this.waveTimer = 1.0;
      this.state = 'intro';      // intro | fight | clear | dead
      this.stateT = 0;
      this.cleared = false;
      this.deadT = 0;

      this.banners = [];
      this.rally = 0;            // current highest volley in play
      this.rallyPeak = 0;
      this.rallyHold = 0;
      this.crescendoStacks = 0;
      this.parryChainCount = 0;
      this.aimTarget = null;
      this.echoCounter = 0;
      this.metronomeFlip = false;
      this.cheatUsed = false;
      this.roomTime = 0;
      this.hitsTaken = 0;
      this.parriesMade = 0;
      this.perfects = 0;

      this.bossRef = null;
      this.introText = null;

      /* background field */
      this.stars = [];
      for (let i = 0; i < 90; i++) {
        this.stars.push({
          x: R.range(0, W), y: R.range(0, H),
          r: R.range(0.4, 1.7), a: R.range(0.06, 0.4),
          s: R.range(3, 16), ph: R.range(0, U.TAU)
        });
      }
      this.motes = [];
      for (let i = 0; i < 34; i++) {
        this.motes.push({
          x: R.range(this.bounds.x, this.bounds.x + this.bounds.w),
          y: R.range(this.bounds.y, this.bounds.y + this.bounds.h),
          vx: R.spread(14), vy: R.spread(14), r: R.range(0.8, 2.6), a: R.range(0.1, 0.35)
        });
      }

      this.setupRoom();
    }

    /* The device rotated (or the window resized) mid-room. Rebuild the arena
       to the new stage and pull everything back inside it — nothing may be
       left stranded outside the walls. */
    onStageChange() {
      const old = this.bounds;
      const b = this.bounds = computeBounds();

      /* map old positions proportionally into the new box so the fight keeps its shape */
      const remap = (e) => {
        const fx = old.w ? (e.x - old.x) / old.w : 0.5;
        const fy = old.h ? (e.y - old.y) / old.h : 0.5;
        const r = e.r || 0;
        e.x = U.clamp(b.x + fx * b.w, b.x + r, b.x + b.w - r);
        e.y = U.clamp(b.y + fy * b.h, b.y + r, b.y + b.h - r);
      };
      if (this.player) { remap(this.player); this.player.afterimages.length = 0; }
      for (const e of this.enemies) remap(e);
      for (const o of this.orbs) { remap(o); o.trail.length = 0; }
      for (const p of this.pickups) remap(p);
      if (this.decoy) remap(this.decoy);
      for (const g of this.wells) remap(g);

      /* backdrop fields are sized to the stage */
      for (const s of this.stars) { s.x = R.range(0, W); s.y = R.range(0, H); }
      for (const m of this.motes) {
        m.x = R.range(b.x, b.x + b.w);
        m.y = R.range(b.y, b.y + b.h);
      }
    }

    /* ============================================================
       SETUP
       ============================================================ */
    setupRoom() {
      const room = this.room;
      if (room.type === 'boss') {
        const bd = C.BOSS_MAP[room.bossId];
        this.introText = bd;
        A.setMusic('boss');
        this.state = 'intro';
        this.stateT = 0;
        this.introTime = 2.9;
      } else {
        A.setMusic(room.type === 'elite' ? 'elite' : 'combat');
        this.introTime = 0.6;
      }
      if (this.modifier) this.banner(this.modifier.name.toUpperCase() + ' — ' + this.modifier.desc, this.modifier.color, 3.2, 0.4);
    }

    startFight() {
      this.state = 'fight';
      this.stateT = 0;
      if (this.room.type === 'boss') {
        const bd = C.BOSS_MAP[this.room.bossId];
        const b = new DV.Boss(bd, W / 2, this.bounds.y + 130, this, {
          hpMult: this.hpMult * (this.run.ascension ? 1 + this.run.ascension * 0.15 : 1),
          dmgMult: this.dmgMult
        });
        this.enemies.push(b);
        this.bossRef = b;
        if (bd.twin) {
          const b2 = new DV.Boss(Object.assign({}, bd, { name: bd.name + ' II' }), W / 2 + 200, this.bounds.y + 170, this, {
            hpMult: this.hpMult, dmgMult: this.dmgMult
          });
          b2.x = W / 2 + 220;
          this.enemies.push(b2);
          this.twinRef = b2;
        }
        this.banner(bd.name, bd.color, 2.6, 0, 44);
      } else {
        this.spawnWave();
      }
    }

    spawnWave() {
      const w = this.waves[this.wave];
      if (!w) return;
      this.wave++;
      if (this.waves.length > 1) this.banner(`WAVE ${this.wave} / ${this.waves.length}`, this.sector.color, 1.6, 0, 26);
      const b = this.bounds;
      for (const grp of w) {
        for (let i = 0; i < grp.count; i++) {
          let x, y, tries = 0;
          do {
            x = this.rng.range(b.x + 60, b.x + b.w - 60);
            y = this.rng.range(b.y + 60, b.y + b.h - 60);
            tries++;
          } while (tries < 24 && U.dist(x, y, this.player.x, this.player.y) < 210);
          this.spawnEnemy(grp.id, x, y, { elite: this.room.type === 'elite' });
        }
      }
      A.play('orb_spawn');
    }

    spawnEnemy(id, x, y, opts) {
      const def = C.ENEMY_MAP[id];
      if (!def) return null;
      opts = opts || {};
      let hpMult = this.hpMult * (opts.hpMult || 1);
      let speedMult = 1, dmgMult = this.dmgMult, parryBonus = 0;
      if (this.room.type === 'elite') { hpMult *= 1.45; dmgMult *= 1.2; parryBonus += 0.12; }
      if (this.modifier) {
        if (this.modifier.id === 'swift') speedMult *= 1.35;
        if (this.modifier.id === 'armored') hpMult *= 1.45;
        if (this.modifier.id === 'keen') parryBonus += 0.3;
        if (this.modifier.id === 'swarm') { hpMult *= 0.72; opts.scale = (opts.scale || 1) * 0.88; }
      }
      if (this.run.enraged) { hpMult *= 1.2; speedMult *= 1.15; this.run.enraged = false; }
      const e = new DV.Enemy(def, x, y, this, {
        hpMult, speedMult, dmgMult, parryBonus,
        elite: opts.elite || false, scale: opts.scale || 1
      });
      if (opts.scale) e.r = def.r * opts.scale;
      if (opts.elite) { e.maxHp = Math.round(e.maxHp * 1.0); e.hp = e.maxHp; }
      this.enemies.push(e);
      return e;
    }

    /* Orb budget. Splits, echoes and boss patterns can multiply fast — without a
       ceiling a Fork-of-the-Path build turns one rally into an exponential bloom. */
    spawnOrb(o) {
      const soft = 48, hard = 96;
      const derived = o.kind === 'echo' || o.tag === 'split';
      if (derived && this.orbs.length >= soft) return this.orbs[this.orbs.length - 1] || new DV.Orb(o);
      if (this.orbs.length >= hard) {
        /* evict the least interesting orb: oldest, lowest volley */
        let worst = -1, ws = Infinity;
        for (let i = 0; i < this.orbs.length; i++) {
          const x = this.orbs[i];
          const s = x.volley * 100 - x.age;
          if (s < ws) { ws = s; worst = i; }
        }
        if (worst >= 0) { this.orbs[worst].kill(this, true); this.orbs.splice(worst, 1); }
      }
      const orb = new DV.Orb(o);
      if (this.modifier && this.modifier.id === 'volatile') orb.volatile = true;
      this.orbs.push(orb);
      return orb;
    }

    /* ============================================================
       HOOKS
       ============================================================ */
    hook(name, ev) {
      ev = ev || {};
      for (const s of this.run.sigils) {
        if (s.hooks && s.hooks[name]) {
          try { s.hooks[name](this, ev); } catch (e) { console.warn('sigil hook', s.id, e); }
        }
      }
      return ev;
    }

    /* ============================================================
       PLAYER-FACING HELPERS (used by sigils/entities)
       ============================================================ */
    healPlayer(n) {
      const p = this.player;
      n *= (this.st.healMult != null ? this.st.healMult : 1);
      if (this.run.vessel.id === 'deadman') {
        const cap = 55;
        if (p.hp >= cap) return;
        n = Math.min(n, cap - p.hp);
      }
      if (n <= 0) return;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + n);
      const got = Math.round(p.hp - before);
      if (got > 0) {
        FX.text(p.x, p.y - 34, '+' + got, { color: '#7dff9b', size: 20 });
        FX.ring({ x: p.x, y: p.y, r: 8, rEnd: 46, life: 0.4, color: '#7dff9b', w: 2.5 });
      }
    }

    addKi(n) {
      const p = this.player;
      p.ki = U.clamp(p.ki + n, 0, this.st.kiMax);
    }

    addShards(n) {
      n = Math.round(n * (this.st.shardMult || 1));
      this.run.shards += n;
      this.run.shardsEarned += n;
    }

    addBuff(id, dur, max) { this.player.addBuff(id, dur, max); }

    nearestEnemy(x, y, exclude) {
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (!e.alive || e === exclude || e.spawnT > 0) continue;
        const d = U.dist2(x, y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    chainLightning(x, y, count, dmg) {
      let from = { x, y };
      const hit = [];
      for (let i = 0; i < count; i++) {
        const e = this.nearestEnemyExcluding(from.x, from.y, hit);
        if (!e) break;
        hit.push(e);
        FX.streak(from.x, from.y, U.angTo(from.x, from.y, e.x, e.y), U.dist(from.x, from.y, e.x, e.y), { color: '#6be6ff', w: 3, life: 0.18 });
        for (let k = 0; k < 4; k++) {
          const t = k / 4;
          FX.particle({
            x: U.lerp(from.x, e.x, t) + R.spread(10), y: U.lerp(from.y, e.y, t) + R.spread(10),
            vx: R.spread(60), vy: R.spread(60), life: 0.25, r: 2, color: '#6be6ff'
          });
        }
        this.hitEnemy(e, dmg * this.st.power, { source: 'lightning', noHooks: true });
        from = e;
      }
      if (hit.length) A.play('enemy_hit');
    }
    nearestEnemyExcluding(x, y, list) {
      let best = null, bd = 420 * 420;
      for (const e of this.enemies) {
        if (!e.alive || list.indexOf(e) >= 0 || e.spawnT > 0) continue;
        const d = U.dist2(x, y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    banner(text, color, life, delay, size) {
      this.banners.push({
        text, color: color || '#ffcf6b',
        life: life || 1.8, max: life || 1.8,
        delay: delay || 0, size: size || 32
      });
    }

    /* ============================================================
       DAMAGE
       ============================================================ */
    hitEnemy(e, dmg, opts) {
      opts = opts || {};
      if (!e.alive || e.spawnT > 0) return 0;
      if (e.isBoss && e.invuln > 0) {
        FX.text(e.x, e.y - e.r - 18, 'GUARDED', { color: '#9a95b4', size: 16 });
        return 0;
      }

      const ev = { damage: dmg, target: e, orb: opts.orb, source: opts.source };
      if (!opts.noHooks) this.hook('modifyDamage', ev);
      let d = ev.damage;

      /* crescendo */
      if (this.st.crescendo) d *= 1 + this.crescendoStacks * this.st.crescendo;
      /* elite / boss grudge */
      if ((e.elite || e.isBoss) && this.st.eliteDmg) d *= 1 + this.st.eliteDmg;

      /* crit */
      let crit = false;
      if (this.st.critChance && Math.random() < this.st.critChance) {
        crit = true; d *= this.st.critMult || 1.9;
      }

      /* Sentinel shield. An ordinary shot bounces off the front — but an orb
         carrying a long enough rally punches straight through and shatters it.
         The rally is the answer to the wall. */
      if (opts.orb && e.def.shieldArc && !e.shieldBroken) {
        const inc = Math.atan2(opts.orb.vy, opts.orb.vx);
        if (e.blocks(inc)) {
          if (opts.orb.volley >= SHIELD_BREAK_VOLLEY) {
            e.breakShield(this);           /* full damage lands */
          } else {
            d *= 0.12;
            A.play('shield_break');
            /* label the requirement so the rule teaches itself */
            FX.text(e.x, e.y - e.r - 20, `BLOCKED  ×${opts.orb.volley}/${SHIELD_BREAK_VOLLEY}`, { color: '#6be6ff', size: 16 });
            FX.ring({ x: e.x, y: e.y, r: e.r + 8, rEnd: e.r + 34, life: 0.3, color: '#6be6ff', w: 3, arc: e.def.shieldArc, angle: e.facing });
            FX.shake(3);
          }
        }
      }

      d = Math.max(1, d);
      e.hp -= d;
      e.hurtFlash = 1;
      e.hitFlashScale = 1;
      this.run.damageDealt += d;

      const big = d > 60;
      A.play('enemy_hit', big);
      FX.text(e.x + R.spread(10), e.y - e.r - 12, Math.round(d).toString(), {
        color: crit ? '#ffcf6b' : (opts.orb && opts.orb.volley >= 4 ? '#ffffff' : '#ffd9dd'),
        size: crit ? 27 : U.clamp(15 + d * 0.14, 15, 30),
        crit, shadow: crit
      });
      if (crit) FX.text(e.x, e.y - e.r - 34, 'CRIT', { color: '#ffcf6b', size: 15 });

      const c = opts.orb ? opts.orb.color : '#ffcf6b';
      FX.burst(e.x, e.y, big ? 16 : 8, { color: c, color2: '#ffffff', speedMin: 50, speedMax: big ? 380 : 220, lifeMax: 0.5, rMax: 3.6 });
      FX.ring({ x: e.x, y: e.y, r: e.r * 0.5, rEnd: e.r * (big ? 3.2 : 2), life: 0.26, color: c, w: 3 });
      FX.shake(U.clamp(2 + d * 0.055, 2, 14));
      FX.stop(U.clamp(d * 0.0007, 0.012, 0.075));

      /* lifesteal */
      if (this.st.lifesteal) this.healPlayer(d * this.st.lifesteal);

      /* chill from parried orbs */
      if (opts.orb && this.st.chill && opts.orb.owner === 'player') e.slowT = 2;

      if (!opts.noHooks) this.hook('onOrbHitEnemy', { orb: opts.orb, enemy: e, damage: d });

      if (e.hp <= 0) {
        if (e.isBoss) e.die(this); else e.die(this);
      }
      return d;
    }

    damagePlayer(amount, src) {
      const p = this.player;
      if (!p.alive || this.state === 'dead') return 0;
      if (p.iframe > 0 || p.intangible > 0) return 0;

      /* bulwark shield */
      if (p.shield > 0) {
        p.shield--;
        p.iframe = Math.max(p.iframe, 0.5);
        A.play('shield_break');
        FX.ring({ x: p.x, y: p.y, r: 12, rEnd: 90, life: 0.4, color: '#6be6ff', w: 4 });
        FX.text(p.x, p.y - 36, 'GUARD', { color: '#6be6ff', size: 19 });
        FX.shake(7); FX.stop(0.05);
        return 0;
      }

      let d = amount;
      d *= (this.st.damageTakenMult || 1);
      if (this.run.vessel.id === 'ember') d *= 1.2;
      if (this.run.vessel.id === 'bulwark' && src === 'orb') d *= 0.65;
      if (src === 'orb' && this.st.failPenalty) d += this.st.failPenalty;
      d = Math.max(1, Math.round(d));

      p.hp -= d;
      p.hurtFlash = 1;
      p.iframe = Math.max(p.iframe, 0.66);
      this.hitsTaken++;
      this.run.damageTaken += d;
      this.game.meta.totalDamageTaken = (this.game.meta.totalDamageTaken || 0) + d;

      /* overreach penalty */
      if (this.st.overreach) p.overreachPenalty = Math.min(0.5, p.overreachPenalty + 0.08);

      A.play('hurt');
      A.duck(0.42, 0.35);
      buzz([0, 30, 40, 30]);
      FX.shake(15, 3.5);
      FX.stop(0.09);
      FX.screenFlash('#ff4d5e', 0.3, 5);
      FX.vignette('#ff4d5e', 0.9);
      FX.slow(0.16, 0.4);
      FX.text(p.x, p.y - 40, '-' + d, { color: '#ff4d5e', size: 28, crit: true, shadow: true });
      FX.burst(p.x, p.y, 22, { color: '#ff4d5e', color2: '#ffffff', speedMin: 80, speedMax: 420, lifeMax: 0.7, rMax: 4 });
      FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 120, life: 0.4, color: '#ff4d5e', w: 4 });

      this.breakRally();
      this.hook('onPlayerHit', { amount: d, source: src });

      if (p.hp <= 0) this.onLethal();
      return d;
    }

    onLethal() {
      const p = this.player;
      /* Deadman's Hand — once per room */
      if (this.st.cheatDeath && !this.cheatUsed) {
        this.cheatUsed = true;
        p.hp = 1;
        p.iframe = 1.5;
        A.play('levelup');
        FX.screenFlash('#b46bff', 0.6);
        FX.shake(18); FX.slow(0.6, 0.3);
        FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 300, life: 0.7, color: '#b46bff', w: 6 });
        this.banner("DEADMAN'S HAND", '#b46bff', 2, 0, 34);
        return;
      }
      /* revives */
      if (p.revives > 0) {
        p.revives--;
        this.run.stats.revives = p.revives;
        p.hp = Math.round(p.maxHp * 0.5);
        p.iframe = 2.2;
        A.play('victory');
        FX.screenFlash('#ffcf6b', 0.8);
        FX.shake(24, 2); FX.slow(0.9, 0.25); FX.stop(0.2);
        FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 900, life: 0.9, color: '#ffcf6b', w: 8 });
        for (const o of this.orbs) if (o.owner === 'enemy') o.kill(this);
        for (const e of this.enemies) if (e.alive && !e.isBoss) this.hitEnemy(e, 120, { source: 'revive', noHooks: true });
        this.banner('NINTH LIFE', '#ffcf6b', 2.4, 0, 40);
        return;
      }
      this.playerDies();
    }

    playerDies() {
      const p = this.player;
      p.alive = false;
      this.state = 'dead';
      this.deadT = 0;
      A.play('death');
      A.setMusic('dead');
      FX.shake(26, 1.6);
      FX.stop(0.35);
      FX.slow(2.4, 0.14);
      FX.screenFlash('#ff4d5e', 0.55);
      FX.zoomTo(1.22);
      FX.burst(p.x, p.y, 70, { color: '#ff4d5e', color2: '#ffffff', speedMin: 60, speedMax: 520, lifeMax: 1.6, rMax: 6 });
      FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 500, life: 1, color: '#ff4d5e', w: 6 });
    }

    /* ============================================================
       THE PARRY PIPELINE
       ============================================================ */
    breakRally() {
      if (this.rally > 0) {
        this.rallyHold = 0.7;
      }
      this.rally = 0;
      this.crescendoStacks = 0;
      this.player.parryStreak = 0;
    }

    autoPerfectCheck(orb) {
      const p = this.player, st = this.st;
      /* explicit marks */
      if (orb.perfectMark) { orb.perfectMark = false; return true; }
      if (p.chainT > 0) return true;
      if (st.metronome) { this.metronomeFlip = !this.metronomeFlip; if (this.metronomeFlip) return true; }
      if (this.run.vessel.id === 'ronin' && (p.parryStreak + 1) % 3 === 0) return true;
      return false;
    }

    parryOrb(orb, forcedPerfect, aimOverride) {
      const p = this.player, st = this.st;
      const elapsed = p.parryWindow - p.parryT;
      let perfect = forcedPerfect || (p.parryT > 0 && elapsed <= p.perfectWindow);
      if (!forcedPerfect && this.autoPerfectCheck(orb)) perfect = true;

      p.parryCaught = true;
      p.parryStreak++;
      p.parryCount++;
      this.parriesMade++;
      this.run.parries++;

      /* aim, with a little assist toward the aimed enemy */
      let ang = aimOverride != null ? aimOverride : p.aim;
      const tgt = this.aimTarget;
      if (tgt && tgt.alive && aimOverride == null) {
        const want = U.angTo(p.x, p.y, tgt.x, tgt.y);
        const diff = U.angDiff(ang, want);
        const cone = st.touchAim ? 0.38 : 0.20;   /* Touch Assist widens the cone */
        if (Math.abs(diff) < cone) ang += diff * (st.touchAim ? 0.95 : 0.85);
      }

      /* growth */
      let vs = st.volleySpeed + (st.volleySpeedAdd || 0);
      let vd = st.volleyDamage + (st.volleyDamageAdd || 0);
      if (this.modifier && this.modifier.id === 'volatile') vs += 0.09;
      if (this.run.vessel.id === 'ember') vd += 0.09;
      let volleyGain = 1;
      if (perfect && st.perfectDouble) volleyGain = 2;

      for (let i = 0; i < volleyGain; i++) {
        orb.volley = Math.min(st.volleyCap, orb.volley + 1);
        orb.damage *= vd;
        orb.speed *= vs;
      }
      if (perfect) { orb.damage *= 1.15; orb.speed *= 1.04; }

      /* Both Hands: catching your own orb keeps it yours (so it still damages
         enemies) but makes it LIVE — it will now also kill you. That risk is
         what stops self-rallying from being free infinite scaling. */
      if (orb.owner === 'player' && !orb.live && st.selfVolley) {
        orb.live = true;
        FX.text(p.x, p.y - 30, 'LIVE', { color: '#ff4d5e', size: 16, crit: true });
      }

      orb.owner = 'player';
      orb.source = null;
      orb.judged.clear();
      orb.willParryBy = null;
      orb.color = perfect ? U.mixHex(p.color, '#ffffff', 0.4) : p.color;
      orb.grace = 0.05;
      orb.bounces = Math.max(orb.bounces, 6);
      orb.homing = st.homing || 0;
      orb.lastParryT = this.time;
      orb.parryLockUntil = this.time + 0.30;
      orb.setAngle(ang, orb.speed);
      orb.x = p.x + Math.cos(ang) * (p.r + orb.r + 2);
      orb.y = p.y + Math.sin(ang) * (p.r + orb.r + 2);
      orb.trail.length = 0;

      this.rally = Math.max(this.rally, orb.volley);
      this.rallyPeak = Math.max(this.rallyPeak, orb.volley);
      this.run.bestRally = Math.max(this.run.bestRally, orb.volley);
      this.game.meta.bestRally = Math.max(this.game.meta.bestRally || 0, orb.volley);
      this.rallyHold = 1.4;
      if (this.st.crescendo) this.crescendoStacks = orb.volley;

      /* ki */
      this.addKi(perfect ? st.kiOnPerfect : st.kiOnParry);

      /* deadman stacking */
      if (perfect && this.run.vessel.id === 'deadman') {
        p.deadmanStacks++;
        this.run.deadmanStacks = p.deadmanStacks;
        this.st.powerMult = (this.st.basePowerMult || 1) * (1 + p.deadmanStacks * 0.02);
      }

      /* splits */
      let splitCount = 0;
      if (perfect && st.perfectSplit) splitCount = 2;
      if (p.splitCharges > 0) { splitCount = Math.max(splitCount, 3); p.splitCharges--; }
      if (splitCount > 1) {
        const frac = splitCount === 3 ? 0.55 : 0.62;
        orb.damage *= frac;
        for (let i = 1; i < splitCount; i++) {
          const off = (i - (splitCount - 1) / 2) * 0.34;
          const cl = this.spawnOrb({
            x: orb.x, y: orb.y, angle: ang + off, speed: orb.speed,
            owner: 'player', damage: orb.damage, r: orb.baseR * 0.85,
            volley: orb.volley, color: orb.color, homing: orb.homing, grace: 0.05,
            tag: 'split',
          });
          if (cl) cl.trail.length = 0;
        }
      }

      /* echo chamber */
      if (st.echoEvery) {
        this.echoCounter++;
        if (this.echoCounter % st.echoEvery === 0) {
          const t2 = this.nearestEnemy(p.x, p.y);
          if (t2) {
            this.spawnOrb({
              x: p.x, y: p.y, angle: U.angTo(p.x, p.y, t2.x, t2.y), speed: orb.speed * 0.85,
              owner: 'player', damage: orb.damage * 0.7, r: 8, volley: orb.volley,
              color: '#b46bff', seek: t2, kind: 'echo', grace: 0.05, life: 3,
            });
          }
        }
      }

      /* halfheart echo */
      if (this.run.vessel.id === 'twin' && orb.volley >= 4) {
        const t2 = this.nearestEnemy(p.x, p.y);
        if (t2) {
          this.spawnOrb({
            x: p.x, y: p.y, angle: U.angTo(p.x, p.y, t2.x, t2.y), speed: 480,
            owner: 'player', damage: orb.damage * 0.3, r: 7, volley: 0,
            color: '#7dff9b', seek: t2, kind: 'echo', grace: 0.05, life: 3,
          });
        }
      }

      /* ---- feedback ---- */
      p.parryFlash = 1;
      A.play('parry', orb.volley, perfect);
      const c = orb.color;
      if (perfect) {
        this.perfects++;
        this.run.perfects++;
        FX.stop(0.075 + Math.min(0.06, orb.volley * 0.004));
        FX.slow(0.19, 0.24);
        FX.shake(9 + Math.min(12, orb.volley));
        FX.screenFlash('#ffffff', 0.2);
        FX.ring({ x: p.x, y: p.y, r: 12, rEnd: 190, life: 0.45, color: '#ffffff', w: 5 });
        FX.ring({ x: p.x, y: p.y, r: 12, rEnd: 130, life: 0.32, color: c, w: 3 });
        FX.burst(p.x, p.y, 26, { color: c, color2: '#ffffff', speedMin: 120, speedMax: 520, lifeMax: 0.7, rMax: 4.5 });
        FX.text(p.x, p.y - 48, 'PERFECT', { color: '#ffffff', size: 24, crit: true, shadow: true });
        /* destroy small enemy orbs nearby */
        for (const o of this.orbs) {
          if (o !== orb && o.alive && o.owner === 'enemy' && o.volley < 2 && U.dist(p.x, p.y, o.x, o.y) < 130) o.kill(this);
        }
        this.hook('onPerfectParry', { orb, x: p.x, y: p.y });
        buzz(18);
      } else {
        FX.stop(0.035);
        FX.shake(5 + Math.min(9, orb.volley));
        FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 120, life: 0.34, color: c, w: 3.5 });
        FX.burst(p.x, p.y, 14, { color: c, speedMin: 80, speedMax: 340, lifeMax: 0.5 });
      }

      /* directional shove burst */
      FX.burst(orb.x, orb.y, 12, { color: c, angle: ang, spread: 0.45, speedMin: 200, speedMax: 620, lifeMax: 0.4, shape: 'line', rMax: 3 });
      FX.ring({ x: p.x, y: p.y, r: 6, rEnd: 60 + orb.volley * 6, life: 0.26, color: '#ffffff', w: 2, squash: 0.35, angle: ang });

      if (orb.volley >= 5) {
        FX.text(p.x, p.y - 72, '×' + orb.volley, {
          color: orb.volley >= 10 ? '#ff4d5e' : '#ffcf6b',
          size: 20 + Math.min(18, orb.volley), crit: true, shadow: true
        });
      }
      if (orb.volley >= 8) { FX.chromatic(0.5); A.duck(0.2, 0.25); }
      if (orb.volley >= 12) FX.screenFlash(c, 0.16);

      this.hook('onParry', { orb, perfect });
      return orb;
    }

    enemyParry(e, orb) {
      if (!orb.alive) return;
      const p = this.player;
      e.parryCd = e.parry.cd;
      e.parryIntent = null;
      e.parryFlash = 1;
      orb.willParryBy = null;
      orb.judged.clear();

      let ang = U.angTo(e.x, e.y, p.x, p.y);
      ang += R.spread((1 - e.parry.skill) * 0.55);

      orb.volley = Math.min(this.st.volleyCap, orb.volley + 1);
      orb.damage *= 1.26;
      orb.speed *= 1.10;
      if (this.modifier && this.modifier.id === 'volatile') orb.speed *= 1.06;
      orb.owner = 'enemy';
      orb.live = false;          /* hostile by ownership now; the flag is redundant */
      orb.source = e;
      orb.color = e.color;
      orb.grace = 0.06;
      orb.homing = 0;
      orb.parryLockUntil = this.time + 0.06;   /* brief, so the rally still flows */
      orb.setAngle(ang, orb.speed);
      orb.x = e.x + Math.cos(ang) * (e.r + orb.r + 2);
      orb.y = e.y + Math.sin(ang) * (e.r + orb.r + 2);
      orb.trail.length = 0;

      this.rally = Math.max(this.rally, orb.volley);
      this.rallyHold = 1.4;

      A.play('parry', orb.volley, false);
      FX.stop(0.03);
      FX.shake(4 + Math.min(8, orb.volley));
      FX.ring({ x: e.x, y: e.y, r: e.r, rEnd: e.r + 60, life: 0.32, color: e.color, w: 3 });
      FX.burst(e.x, e.y, 12, { color: e.color, angle: ang, spread: 0.6, speedMin: 100, speedMax: 380, lifeMax: 0.45 });
      FX.text(e.x, e.y - e.r - 22, 'RETURN', { color: e.color, size: 16 });
    }

    /* ============================================================
       TECHNIQUES
       ============================================================ */
    useTech(slot) {
      const p = this.player;
      const id = p.techs[slot];
      if (!id) return;
      const t = C.TECH_MAP[id];
      if (!t) return;
      if (p.techCd[slot] > 0) { A.play('ui_deny'); return; }
      const cost = t.cost * (this.st.techCostMult || 1);
      if (p.ki < cost) {
        A.play('ui_deny');
        FX.text(p.x, p.y - 44, 'NO KI', { color: '#6be6ff', size: 17 });
        return;
      }
      p.ki -= cost;
      p.techCd[slot] = t.cd * (this.st.techCdMult || 1);
      A.play('tech');
      FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 90, life: 0.35, color: t.color, w: 3 });
      FX.text(p.x, p.y - 56, t.name.toUpperCase(), { color: t.color, size: 17 });
      this.execTech(t);
    }

    execTech(t) {
      const p = this.player, b = this.bounds;
      switch (t.id) {
        case 'phase_step': {
          const nx = U.clamp(p.x + Math.cos(p.aim) * 260, b.x + p.r, b.x + b.w - p.r);
          const ny = U.clamp(p.y + Math.sin(p.aim) * 260, b.y + p.r, b.y + b.h - p.r);
          for (let i = 0; i < 8; i++) {
            p.afterimages.push({ x: U.lerp(p.x, nx, i / 8), y: U.lerp(p.y, ny, i / 8), a: 0.6, ang: p.aim });
          }
          /* orbs on the path become yours */
          for (const o of this.orbs) {
            if (!o.alive) continue;
            const d = distToSeg(o.x, o.y, p.x, p.y, nx, ny);
            if (d < 60) this.parryOrb(o, true, p.aim);
          }
          p.x = nx; p.y = ny;
          p.iframe = Math.max(p.iframe, 0.3);
          FX.ring({ x: nx, y: ny, r: 6, rEnd: 90, life: 0.4, color: t.color, w: 3 });
          FX.burst(nx, ny, 20, { color: t.color, speedMin: 60, speedMax: 340, lifeMax: 0.5 });
          A.play('dash');
          break;
        }
        case 'solar_flare': {
          for (const e of this.enemies) if (e.alive) e.blindT = Math.max(e.blindT, 3.2);
          for (const o of this.orbs) if (o.alive && o.owner === 'enemy') { o.judged.clear(); o.willParryBy = null; }
          FX.screenFlash('#ffcf6b', 0.65, 2.4);
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 900, life: 0.7, color: '#ffcf6b', w: 8 });
          FX.shake(10);
          this.banner('BLINDED', '#ffcf6b', 1.4, 0, 24);
          break;
        }
        case 'afterimage': {
          if (this.decoy) this.decoy.pop(this);
          this.decoy = new DV.Decoy(p.x, p.y, 4, t.color);
          break;
        }
        case 'bastion': {
          p.bastionT = 2.6;
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 110, life: 0.5, color: '#6be6ff', w: 5 });
          break;
        }
        case 'split_palm': {
          p.splitCharges = 2;
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 80, life: 0.4, color: '#7dff9b', w: 3, sides: 3 });
          break;
        }
        case 'chain_volley': {
          p.chainT = 4;
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 140, life: 0.6, color: '#ff4d5e', w: 4 });
          this.banner('CHAIN VOLLEY', '#ff4d5e', 1.6, 0, 26);
          break;
        }
        case 'gravity_well': {
          const IN = DV.Input;
          const gx = U.clamp(IN.mouse.x, b.x, b.x + b.w);
          const gy = U.clamp(IN.mouse.y, b.y, b.y + b.h);
          this.wells.push({ x: gx, y: gy, r: 230, force: 620, life: 3, max: 3, color: t.color });
          FX.ring({ x: gx, y: gy, r: 230, rEnd: 20, life: 0.6, color: t.color, w: 4, ease: 'outQuad' });
          break;
        }
        case 'shear': {
          const ang = p.aim;
          FX.ring({ x: p.x, y: p.y, r: 20, rEnd: 200, life: 0.3, color: t.color, w: 8, arc: 1.2, angle: ang });
          FX.burst(p.x + Math.cos(ang) * 90, p.y + Math.sin(ang) * 90, 24, { color: t.color, angle: ang, spread: 0.7, speedMin: 120, speedMax: 480, lifeMax: 0.4 });
          FX.shake(8); FX.stop(0.05);
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const d = U.dist(p.x, p.y, e.x, e.y);
            if (d < 200 && Math.abs(U.angDiff(ang, U.angTo(p.x, p.y, e.x, e.y))) < 0.7) {
              this.hitEnemy(e, 45 * this.st.power, { source: 'shear' });
            }
          }
          for (const o of this.orbs) {
            if (!o.alive) continue;
            const d = U.dist(p.x, p.y, o.x, o.y);
            if (d < 210 && Math.abs(U.angDiff(ang, U.angTo(p.x, p.y, o.x, o.y))) < 0.8) {
              o.volley = Math.min(this.st.volleyCap, o.volley + 1);
              this.parryOrb(o, false, ang);
            }
          }
          break;
        }
        case 'grave_pulse': {
          FX.ring({ x: p.x, y: p.y, r: 12, rEnd: 240, life: 0.45, color: t.color, w: 6 });
          FX.shake(12); FX.stop(0.06);
          let hits = 0;
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const d = U.dist(p.x, p.y, e.x, e.y);
            if (d < 240) {
              this.hitEnemy(e, 60 * this.st.power, { source: 'pulse' });
              const ang = U.angTo(p.x, p.y, e.x, e.y);
              e.knock.x += Math.cos(ang) * 620; e.knock.y += Math.sin(ang) * 620;
              e.stunT = Math.max(e.stunT, 0.3);
              hits++;
            }
          }
          this.addKi(hits * 20);
          break;
        }
        case 'hollow_step': {
          p.intangible = 1.8;
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 100, life: 0.5, color: t.color, w: 3 });
          break;
        }
        case 'conflagrate': {
          let n = 0;
          for (const o of this.orbs.slice()) {
            if (!o.alive || o.owner !== 'enemy') continue;
            n++;
            FX.ring({ x: o.x, y: o.y, r: 8, rEnd: 130, life: 0.4, color: '#ff6b3d', w: 4 });
            FX.burst(o.x, o.y, 18, { color: '#ff6b3d', color2: '#ffffff', speedMin: 80, speedMax: 400, lifeMax: 0.6 });
            for (const e of this.enemies) {
              if (e.alive && U.dist(o.x, o.y, e.x, e.y) < 130) this.hitEnemy(e, 70 * this.st.power, { source: 'conflagrate' });
            }
            o.kill(this, true);
          }
          if (n) { FX.shake(14); FX.stop(0.08); A.play('boss_die'); }
          else FX.text(p.x, p.y - 40, 'NO ORBS', { color: '#9a95b4', size: 16 });
          break;
        }
        case 'deadhand': {
          let best = null;
          for (const o of this.orbs) if (o.alive && (!best || o.volley > best.volley)) best = o;
          if (!best) {
            const tg = this.nearestEnemy(p.x, p.y);
            best = this.spawnOrb({
              x: p.x, y: p.y, angle: p.aim, speed: 500, owner: 'player',
              damage: 30 * this.st.power, r: 12, volley: 2, color: '#ff4d5e', grace: 0.05
            });
          }
          best.volley = Math.min(this.st.volleyCap, best.volley + 4);
          best.damage *= Math.pow(this.st.volleyDamage, 4);
          best.speed *= Math.pow(this.st.volleySpeed, 2);
          best.x = p.x + Math.cos(p.aim) * 30; best.y = p.y + Math.sin(p.aim) * 30;
          best.owner = 'player'; best.color = '#ff4d5e'; best.judged.clear(); best.willParryBy = null;
          best.setAngle(p.aim, best.speed);
          best.trail.length = 0;
          this.rally = Math.max(this.rally, best.volley);
          this.rallyHold = 1.4;
          FX.ring({ x: p.x, y: p.y, r: 10, rEnd: 160, life: 0.5, color: '#ff4d5e', w: 5 });
          FX.shake(10); FX.stop(0.07);
          break;
        }
      }
    }

    /* ============================================================
       UPDATE
       ============================================================ */
    onEnemyDied(e, silent) {
      const n = e.isBoss ? 40 : (e.def.xp || 1);
      /* drops */
      const cnt = e.isBoss ? 26 : (e.elite ? 6 : Math.max(1, Math.round(n * 0.9)));
      for (let i = 0; i < cnt; i++) {
        this.pickups.push(new DV.Pickup(e.x + R.spread(16), e.y + R.spread(16), 'shard', e.isBoss ? 12 : 5));
      }
      if (!e.isBoss && Math.random() < 0.10 + (this.st.luck || 0) * 0.02) {
        this.pickups.push(new DV.Pickup(e.x, e.y, 'heart', 8));
      }
      this.run.kills++;
      this.game.meta.totalKills = (this.game.meta.totalKills || 0) + 1;
      this.hook('onEnemyKill', { enemy: e });
    }

    update(rawDt) {
      const IN = DV.Input;
      this.realTime += rawDt;

      /* hitstop freezes gameplay but not UI feel */
      if (FX.tickTimers(rawDt)) {
        FX.update(rawDt * 0.12);
        this.updateBanners(rawDt);
        return;
      }
      const scale = FX.timeScale(rawDt);
      const dt = Math.min(0.05, rawDt) * scale;
      this.time += dt;
      this.roomTime += dt;

      /* ---- states ---- */
      if (this.state === 'intro') {
        this.stateT += rawDt;
        if (this.stateT > this.introTime) this.startFight();
      } else if (this.state === 'dead') {
        this.deadT += rawDt;
        FX.update(dt);
        this.updateBanners(rawDt);
        if (this.deadT > 2.6) this.game.onRunEnd(false);
        /* still animate corpses/particles */
        for (const o of this.orbs) if (o.alive) o.update(dt, this);
        return;
      } else if (this.state === 'clear') {
        this.stateT += rawDt;
      }

      const controllable = this.state === 'fight' || this.state === 'clear';

      /* ---- rally decay ---- */
      if (this.rallyHold > 0) this.rallyHold -= rawDt;
      const anyRallyOrb = this.orbs.some(o => o.alive && o.volley > 0);
      if (!anyRallyOrb && this.rallyHold <= 0) { this.rally = 0; this.crescendoStacks = 0; }

      /* ---- aim target (for assist + homing) ---- */
      this.aimTarget = this.findAimTarget();

      /* ---- input ---- */
      if (controllable && this.player.alive) {
        if (IN.parryHit()) this.player.tryParry(this);
        if (IN.actHit('dash')) this.player.tryDash(this, IN.moveVec());
        if (IN.actHit('tech1')) this.useTech(0);
        if (IN.actHit('tech2')) this.useTech(1);
      }

      /* ---- player ---- */
      if (this.player.alive) this.player.update(dt, this, IN, controllable);

      /* ---- decoy / wells ---- */
      if (this.decoy) { this.decoy.update(dt, this); if (!this.decoy.alive) this.decoy = null; }
      for (let i = this.wells.length - 1; i >= 0; i--) {
        const g = this.wells[i];
        g.life -= dt;
        if (R.chance(0.5)) {
          const ang = R.range(0, U.TAU);
          FX.particle({
            x: g.x + Math.cos(ang) * g.r, y: g.y + Math.sin(ang) * g.r,
            vx: -Math.cos(ang) * 220, vy: -Math.sin(ang) * 220,
            life: 0.5, r: 2, color: g.color, drag: 0.98
          });
        }
        if (g.life <= 0) this.wells.splice(i, 1);
      }

      /* ---- enemies ---- */
      for (const e of this.enemies) if (e.alive) e.update(dt, this);

      /* ---- orbs, sub-stepped for fast collisions ---- */
      let maxSpeed = 0;
      for (const o of this.orbs) if (o.alive) maxSpeed = Math.max(maxSpeed, o.speed);
      const steps = U.clamp(Math.ceil(maxSpeed * dt / 9), 1, 6);
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (const o of this.orbs) if (o.alive) o.update(sdt, this);
        this.resolveOrbCollisions(sdt);
      }

      /* ---- contact damage, thorns, satellites ---- */
      this.resolveContacts(dt);

      /* ---- pickups ---- */
      for (const p of this.pickups) if (p.alive) p.update(dt, this);

      /* ---- cull ---- */
      this.orbs = this.orbs.filter(o => o.alive);
      this.enemies = this.enemies.filter(e => e.alive || e.isBoss === false && false);
      this.enemies = this.enemies.filter(e => e.alive);
      this.pickups = this.pickups.filter(p => p.alive);

      /* ---- wave / clear logic ---- */
      if (this.state === 'fight') {
        if (this.enemies.length === 0) {
          if (this.wave < this.waves.length) {
            this.waveTimer -= rawDt;
            if (this.waveTimer <= 0) { this.spawnWave(); this.waveTimer = 1.2; }
          } else {
            this.onClear();
          }
        } else {
          this.waveTimer = 1.2;
        }
      }
      if (this.state === 'clear') {
        /* let pickups fly in, then hand back to the map */
        if (this.stateT > 1.9) this.game.onRoomCleared(this);
      }

      /* ---- music intensity ---- */
      if (this.state === 'fight' && this.room.type !== 'boss') {
        const danger = U.clamp(this.enemies.length / 6 + this.rally * 0.05, 0, 1);
        A.nudgeIntensity(0.5 + danger * 0.42);
      }

      /* ---- motes ---- */
      for (const m of this.motes) {
        m.x += m.vx * dt; m.y += m.vy * dt;
        const b = this.bounds;
        if (m.x < b.x) m.x = b.x + b.w; if (m.x > b.x + b.w) m.x = b.x;
        if (m.y < b.y) m.y = b.y + b.h; if (m.y > b.y + b.h) m.y = b.y;
      }

      FX.update(dt);
      this.updateBanners(rawDt);

      /* persist */
      this.run.hp = this.player.hp;
      this.run.ki = this.player.ki;
    }

    updateBanners(dt) {
      for (let i = this.banners.length - 1; i >= 0; i--) {
        const b = this.banners[i];
        if (b.delay > 0) { b.delay -= dt; continue; }
        b.life -= dt;
        if (b.life <= 0) this.banners.splice(i, 1);
      }
    }

    findAimTarget() {
      const p = this.player;
      let best = null, bestScore = Infinity;
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        const ang = U.angTo(p.x, p.y, e.x, e.y);
        const diff = Math.abs(U.angDiff(p.aim, ang));
        if (diff > 0.5) continue;
        const d = U.dist(p.x, p.y, e.x, e.y);
        const score = diff * 420 + d * 0.35;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      return best;
    }

    /* ---------- orb collisions ---------- */
    resolveOrbCollisions(dt) {
      const p = this.player;

      for (const o of this.orbs) {
        if (!o.alive) continue;

        /* --- vs player --- */
        if (p.alive && o.grace <= 0) {
          const d = U.dist(o.x, o.y, p.x, p.y);

          /* wraith dash-phase: slow + mark */
          if (p.dashPhase > 0 && d < p.r + o.r + 12 && !o.phasedBy) {
            o.phasedBy = true;
            o.slowT = 1.2;
            o.perfectMark = true;
            FX.text(o.x, o.y - 24, 'MARKED', { color: '#7dff9b', size: 15 });
            FX.ring({ x: o.x, y: o.y, r: o.r, rEnd: o.r * 3, life: 0.3, color: '#7dff9b', w: 2 });
          }

          const reach = p.parryRadius + o.r;

          /* Only threats are parryable. Your own returned orb is inert — without
             this, firing into a wall and re-catching it scales forever for free.
             The Both Hands relic re-opens it, at the price of making the orb LIVE. */
          const eligible = o.hostile || (this.st.selfVolley && o.owner === 'player');
          /* ...and no orb may be caught twice in quick succession. Collisions run
             several substeps per frame, so without this one press re-parries the
             same orb repeatedly while it is still inside your reach. */
          const unlocked = this.time >= (o.parryLockUntil || 0);
          const canCatch = eligible && unlocked && (p.parryT > 0 || p.bastionT > 0 || p.chainT > 0);

          /* timeslip */
          if (this.st.timeslip && o.hostile && d < reach + 8 && !o.slipped) {
            o.slipped = true;
            FX.slow(0.22, 0.55);
          }

          if (canCatch && d < reach) {
            if (p.bastionT > 0 && p.parryT <= 0) { this.parryOrb(o, true); continue; }
            if (p.chainT > 0 && p.parryT <= 0) {
              const t2 = this.nearestEnemy(p.x, p.y);
              this.parryOrb(o, true, t2 ? U.angTo(p.x, p.y, t2.x, t2.y) : p.aim);
              continue;
            }
            if (p.parryT > 0) { this.parryOrb(o); continue; }
          }

          /* damaging hit — LIVE orbs are yours and still bite */
          if (o.hostile && d < p.r + o.r) {
            if (p.intangible > 0 || p.iframe > 0) { /* pass through */ }
            else {
              const dealt = this.damagePlayer(o.damage, 'orb');
              if (dealt >= 0) {
                FX.text(p.x, p.y - 62, o.volley >= 3 ? 'DROPPED IT' : 'HIT', { color: '#ff4d5e', size: 17 });
                o.kill(this);
                continue;
              }
            }
          }
        }

        /* --- vs enemies --- */
        if (o.owner === 'player' && o.hitCooldown <= 0) {
          for (const e of this.enemies) {
            if (!e.alive || e.spawnT > 0) continue;
            if (U.dist(o.x, o.y, e.x, e.y) < e.r + o.r) {
              /* the enemy might have intended to parry but failed the roll -> eat it */
              const dmg = o.damage;
              this.hitEnemy(e, dmg, { orb: o, source: 'orb' });
              o.hitCooldown = 0.08;
              if (this.st.sunOrb && !e.alive) {
                /* pierce through kills */
                o.damage *= 0.82;
              } else if (o.pierce > 0) {
                o.pierce--;
              } else {
                o.kill(this);
              }
              break;
            }
          }
        }

        /* --- decoy attracts enemy orbs --- */
        if (o.owner === 'enemy' && this.decoy && this.decoy.alive) {
          if (U.dist(o.x, o.y, this.decoy.x, this.decoy.y) < this.decoy.r + o.r + 6) {
            o.kill(this);
            FX.ring({ x: this.decoy.x, y: this.decoy.y, r: 6, rEnd: 50, life: 0.25, color: this.decoy.color, w: 2 });
          }
        }
      }
    }

    /* ---------- contacts ---------- */
    resolveContacts(dt) {
      const p = this.player;
      if (!p.alive) return;
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0) continue;
        const d = U.dist(p.x, p.y, e.x, e.y);
        if (d < p.r + e.r) {
          if (e.contact > 0 && p.iframe <= 0 && p.intangible <= 0) {
            this.damagePlayer(e.contact, 'contact');
            const ang = U.angTo(e.x, e.y, p.x, p.y);
            p.vx += Math.cos(ang) * 320; p.vy += Math.sin(ang) * 320;
            e.knock.x -= Math.cos(ang) * 180; e.knock.y -= Math.sin(ang) * 180;
            if (e.state === 'dash') { e.state = 'idle'; e.stateT = 0; }
          }
          if (this.st.thorns) {
            if (!e.thornCd || e.thornCd <= 0) {
              e.thornCd = 0.6;
              this.hitEnemy(e, this.st.thorns, { source: 'thorns' });
              const ang = U.angTo(p.x, p.y, e.x, e.y);
              e.knock.x += Math.cos(ang) * 460; e.knock.y += Math.sin(ang) * 460;
            }
          }
        }
        if (e.thornCd > 0) e.thornCd -= dt;

        /* satellites */
        for (const s of p.satellites) {
          if (s.hitCd > 0) continue;
          const sx = p.x + Math.cos(s.a) * 52, sy = p.y + Math.sin(s.a) * 52;
          if (U.dist(sx, sy, e.x, e.y) < e.r + 9) {
            s.hitCd = 0.5;
            this.hitEnemy(e, 24 * this.st.power, { source: 'satellite' });
          }
        }
      }
    }

    onClear() {
      if (this.cleared) return;
      this.cleared = true;
      this.state = 'clear';
      this.stateT = 0;
      A.play('room_clear');
      A.nudgeIntensity(0.15);
      FX.screenFlash('#ffffff', 0.12);
      this.banner(this.room.type === 'boss' ? 'SLAIN' : 'CLEAR', this.sector.color, 1.8, 0.15, 40);
      this.hook('onRoomClear', {});
      /* magnetize all pickups */
      for (const p of this.pickups) p.magnetized = true;
      this.run.hp = this.player.hp;
    }

    /* ============================================================
       DRAW
       ============================================================ */
    draw(ctx) {
      const b = this.bounds;
      const S = this.sector;

      /* ---------- background ---------- */
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, W, H);

      const g = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.5, H * 0.95);
      g.addColorStop(0, U.rgba(S.color, 0.055));
      g.addColorStop(0.5, U.rgba(S.accent, 0.028));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      /* stars */
      ctx.save();
      for (const s of this.stars) {
        ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(this.time * (s.s * 0.1) + s.ph));
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.restore();

      FX.applyCam(ctx, W, H);

      /* ---------- arena floor ---------- */
      ctx.save();
      const fg = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      fg.addColorStop(0, U.rgba(S.color, 0.045));
      fg.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = fg;
      ctx.fillRect(b.x, b.y, b.w, b.h);

      /* grid */
      ctx.strokeStyle = U.rgba(S.color, 0.055);
      ctx.lineWidth = 1;
      const cell = 48;
      ctx.beginPath();
      for (let x = b.x; x <= b.x + b.w + 1; x += cell) { ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); }
      for (let y = b.y; y <= b.y + b.h + 1; y += cell) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); }
      ctx.stroke();

      /* motes */
      ctx.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        ctx.globalAlpha = m.a;
        ctx.fillStyle = S.color;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, U.TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      /* border */
      ctx.strokeStyle = U.rgba(S.color, 0.42);
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = U.rgba(S.color, 0.12);
      ctx.lineWidth = 8;
      ctx.strokeRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);

      /* corner brackets */
      ctx.strokeStyle = U.rgba(S.color, 0.85);
      ctx.lineWidth = 3;
      const cl = 26;
      const corners = [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1], [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]];
      for (const [cx, cy, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * cl, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * cl);
        ctx.stroke();
      }
      ctx.restore();

      /* ---------- gravity wells ---------- */
      for (const w of this.wells) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const k = w.life / w.max;
        const gg = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.r);
        gg.addColorStop(0, U.rgba(w.color, 0.28 * k));
        gg.addColorStop(0.6, U.rgba(w.color, 0.08 * k));
        gg.addColorStop(1, U.rgba(w.color, 0));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, U.TAU); ctx.fill();
        ctx.strokeStyle = U.rgba(w.color, 0.5 * k);
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const rr = w.r * (((this.time * 0.5 + i / 3) % 1));
          ctx.globalAlpha = (1 - rr / w.r) * k;
          ctx.beginPath(); ctx.arc(w.x, w.y, rr, 0, U.TAU); ctx.stroke();
        }
        ctx.restore();
      }

      /* ---------- entities ---------- */
      for (const p of this.pickups) p.draw(ctx, this);
      if (this.decoy) this.decoy.draw(ctx, this);
      for (const e of this.enemies) if (!e.isBoss) e.draw(ctx, this);
      for (const e of this.enemies) if (e.isBoss) e.draw(ctx, this);
      if (this.player.alive || this.state === 'dead') {
        if (this.state !== 'dead') this.player.draw(ctx, this);
      }
      for (const o of this.orbs) o.draw(ctx, this);

      FX.drawWorld(ctx);

      /* dim modifier: darkness beyond the player's reach */
      if (this.modifier && this.modifier.id === 'dim') {
        ctx.save();
        const p = this.player;
        const dg = ctx.createRadialGradient(p.x, p.y, 120, p.x, p.y, 420);
        dg.addColorStop(0, 'rgba(0,0,0,0)');
        dg.addColorStop(1, 'rgba(2,2,6,0.88)');
        ctx.fillStyle = dg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      FX.drawText(ctx);
      FX.popCam(ctx);

      /* ---------- screen space ---------- */
      FX.drawScreen(ctx, W, H);
      this.drawHUD(ctx);
      this.drawBanners(ctx);
      if (this.state === 'intro' && this.introText) this.drawBossIntro(ctx);
      if (this.state === 'dead') this.drawDeath(ctx);
    }

    /* ============================================================
       HUD
       ============================================================ */
    drawHUD(ctx) {
      const p = this.player, st = this.st;
      ctx.save();
      ctx.textBaseline = 'middle';

      /* ---- top-left: HP ---- */
      const touch = DV.STAGE.touch, portrait = DV.STAGE.portrait;
      const hx = touch ? 88 : 30, hy = 30, hw = Math.min(300, W - (touch ? 400 : 320)), hh = 17;
      ctx.fillStyle = 'rgba(6,5,12,.8)';
      U.rr(ctx, hx - 3, hy - 3, hw + 6, hh + 6, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,77,94,.13)';
      ctx.fillRect(hx, hy, hw, hh);

      const hpF = U.clamp(p.hp / p.maxHp, 0, 1);
      /* ghost bar */
      if (this._ghostHp == null) this._ghostHp = hpF;
      this._ghostHp = U.approach(this._ghostHp, hpF, 1 / 60, 0.06);
      if (this._ghostHp > hpF) {
        ctx.fillStyle = 'rgba(255,207,107,.4)';
        ctx.fillRect(hx, hy, hw * this._ghostHp, hh);
      }
      const hg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
      hg.addColorStop(0, '#8d1f2c'); hg.addColorStop(1, '#ff4d5e');
      ctx.fillStyle = hg;
      ctx.fillRect(hx, hy, hw * hpF, hh);
      ctx.strokeStyle = 'rgba(255,77,94,.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(hx + .5, hy + .5, hw - 1, hh - 1);
      /* segments */
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      for (let i = 25; i < p.maxHp; i += 25) { const x = hx + hw * (i / p.maxHp); ctx.moveTo(x, hy); ctx.lineTo(x, hy + hh); }
      ctx.stroke();

      ctx.font = '700 15px "Rajdhani",Arial Narrow,sans-serif';
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(`${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`, hx + 8, hy + hh / 2 + 1);
      if (p.revives > 0) {
        ctx.fillStyle = '#ffcf6b'; ctx.textAlign = 'right';
        ctx.fillText('♻ ' + p.revives, hx + hw - 8, hy + hh / 2 + 1);
      }

      /* ---- Ki bar ---- */
      const ky = hy + hh + 7, kh = 9;
      ctx.fillStyle = 'rgba(6,5,12,.8)';
      U.rr(ctx, hx - 3, ky - 3, hw + 6, kh + 6, 2); ctx.fill();
      ctx.fillStyle = 'rgba(107,230,255,.12)';
      ctx.fillRect(hx, ky, hw, kh);
      const kg = ctx.createLinearGradient(hx, 0, hx + hw, 0);
      kg.addColorStop(0, '#1b6f8c'); kg.addColorStop(1, '#6be6ff');
      ctx.fillStyle = kg;
      ctx.fillRect(hx, ky, hw * U.clamp(p.ki / st.kiMax, 0, 1), kh);
      ctx.strokeStyle = 'rgba(107,230,255,.4)';
      ctx.strokeRect(hx + .5, ky + .5, hw - 1, kh - 1);

      /* ---- dash pips ---- */
      const dy = ky + kh + 9;
      for (let i = 0; i < st.dashCharges; i++) {
        const on = i < p.dashCharges;
        const dx = hx + i * 22;
        ctx.fillStyle = on ? U.rgba(p.color, 0.9) : 'rgba(255,255,255,.12)';
        U.poly(ctx, dx + 7, dy + 6, 3, 8, null, -Math.PI / 2);
        ctx.fill();
        if (!on) {
          const prog = 1 - U.clamp(p.dashCd / (st.dashCooldown * (st.dashCooldownMult || 1)), 0, 1);
          ctx.fillStyle = U.rgba(p.color, 0.4);
          ctx.save();
          ctx.beginPath(); ctx.rect(dx, dy + 12 - 12 * prog, 14, 12 * prog); ctx.clip();
          U.poly(ctx, dx + 7, dy + 6, 3, 8, null, -Math.PI / 2); ctx.fill();
          ctx.restore();
        }
      }

      /* ---- vessel chip ---- */
      ctx.textAlign = 'left';
      ctx.font = '600 11px "Rajdhani",sans-serif';
      ctx.fillStyle = 'rgba(154,149,180,.95)';
      ctx.fillText(this.run.vessel.name.toUpperCase(), hx + st.dashCharges * 22 + 12, dy + 7);

      /* ---- run info: top-right on wide stages, stacked in portrait ---- */
      const label = this.room.type === 'boss' ? 'BOSS' : this.room.type === 'elite' ? 'ELITE' : `ROOM ${this.room.depth}`;
      ctx.textAlign = 'right';
      ctx.font = '700 20px "Rajdhani",sans-serif';
      ctx.fillStyle = this.sector.color;
      ctx.fillText(`SECTOR ${U.roman(this.room.sector)}`, W - 30, 32);
      ctx.font = '600 12px "Rajdhani",sans-serif';
      ctx.fillStyle = 'rgba(154,149,180,.95)';
      ctx.fillText(label + (this.modifier ? '  ·  ' + this.modifier.name.toUpperCase() : ''), W - 30, 52);
      ctx.font = '700 17px "Rajdhani",sans-serif';
      ctx.fillStyle = '#ffcf6b';
      ctx.fillText('◈ ' + this.run.shards, W - 30, 74);

      /* ---- techniques (on touch these are real buttons — see touch.js) ---- */
      const tx = W - 30, ty = H - 44;
      for (let i = 0; !touch && i < p.techs.length; i++) {
        const t = C.TECH_MAP[p.techs[i]];
        if (!t) continue;
        const bx = tx - 56 - i * 66, by = ty - 22;
        const cd = p.techCd[i];
        const cdMax = t.cd * (st.techCdMult || 1);
        const ready = cd <= 0 && p.ki >= t.cost * (st.techCostMult || 1);
        ctx.fillStyle = 'rgba(8,7,16,.85)';
        U.rr(ctx, bx, by, 56, 44, 3); ctx.fill();
        ctx.strokeStyle = ready ? U.rgba(t.color, 0.9) : 'rgba(90,85,120,.5)';
        ctx.lineWidth = ready ? 2 : 1;
        U.rr(ctx, bx, by, 56, 44, 3); ctx.stroke();
        if (cd > 0) {
          ctx.fillStyle = 'rgba(0,0,0,.62)';
          ctx.fillRect(bx + 1, by + 1, 54, 42 * U.clamp(cd / cdMax, 0, 1));
        }
        ctx.textAlign = 'center';
        ctx.font = '700 19px "Rajdhani",sans-serif';
        ctx.fillStyle = ready ? t.color : 'rgba(140,134,170,.7)';
        ctx.fillText(t.glyph, bx + 28, by + 17);
        ctx.font = '700 10px "Rajdhani",sans-serif';
        ctx.fillStyle = ready ? 'rgba(255,255,255,.7)' : 'rgba(120,115,150,.7)';
        ctx.fillText(i === 0 ? 'Q' : 'E', bx + 10, by + 36);
        ctx.fillStyle = U.rgba('#6be6ff', ready ? 0.9 : 0.4);
        ctx.fillText(Math.round(t.cost * (st.techCostMult || 1)), bx + 38, by + 36);
      }

      /* ---- buff chips (bottom-left) ---- */
      let bxp = touch ? 34 : 30, byp = H - (touch ? (portrait ? 344 : 194) : 40);
      const chips = [];
      if (p.chainT > 0) chips.push(['CHAIN', '#ff4d5e', p.chainT / 4]);
      if (p.bastionT > 0) chips.push(['BASTION', '#6be6ff', p.bastionT / 2.6]);
      if (p.intangible > 0) chips.push(['HOLLOW', '#6be6ff', p.intangible / 1.8]);
      if (p.splitCharges > 0) chips.push(['SPLIT ×' + p.splitCharges, '#7dff9b', 1]);
      if (p.buffStacks('riposte')) chips.push(['SWIFT ×' + p.buffStacks('riposte'), '#ffcf6b', 1]);
      if (this.crescendoStacks > 0 && st.crescendo) chips.push(['CRESC ×' + this.crescendoStacks, '#b46bff', 1]);
      if (p.deadmanStacks > 0) chips.push(['TERMINAL +' + (p.deadmanStacks * 2) + '%', '#ff4d5e', 1]);
      for (const [txt, col, k] of chips) {
        ctx.font = '700 12px "Rajdhani",sans-serif';
        const w = ctx.measureText(txt).width + 18;
        ctx.fillStyle = 'rgba(8,7,16,.85)';
        U.rr(ctx, bxp, byp, w, 20, 2); ctx.fill();
        ctx.strokeStyle = U.rgba(col, 0.7); ctx.lineWidth = 1;
        U.rr(ctx, bxp, byp, w, 20, 2); ctx.stroke();
        ctx.fillStyle = U.rgba(col, 0.25);
        ctx.fillRect(bxp + 1, byp + 1, (w - 2) * U.clamp(k, 0, 1), 18);
        ctx.textAlign = 'center'; ctx.fillStyle = col;
        ctx.fillText(txt, bxp + w / 2, byp + 10);
        bxp += w + 6;
      }

      /* ---- RALLY COUNTER (centre-top, the star) ---- */
      if (this.rally > 0) this.rallyLast = this.rally;
      const shown = this.rally > 0 ? this.rally : (this.rallyLast || 0);
      if (shown > 0 && (this.rally > 0 || this.rallyHold > 0)) {
        /* solid while the rally lives; brief fade once it is dropped */
        const alpha = this.rally > 0 ? 1 : U.clamp(this.rallyHold / 0.7, 0, 1);
        const pulse = 1 + 0.06 * Math.sin(this.time * 12);
        const col = shown >= 12 ? '#ff4d5e' : shown >= 7 ? '#ffcf6b' : shown >= 4 ? '#6be6ff' : '#9a95b4';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = '700 12px "Rajdhani",sans-serif';
        ctx.fillStyle = 'rgba(154,149,180,.95)';
        ctx.fillText('RALLY', W / 2, 30);
        ctx.save();
        ctx.translate(W / 2, 60);
        ctx.scale(pulse, pulse);
        ctx.font = '700 48px "Rajdhani",sans-serif';
        ctx.shadowColor = col; ctx.shadowBlur = 26;
        ctx.fillStyle = col;
        ctx.fillText('×' + shown, 0, 0);
        ctx.restore();
        /* pips — one per volley, capped, centred under the number */
        const n = Math.min(shown, 12);
        const gap = 13;
        for (let i = 0; i < n; i++) {
          const px = W / 2 + (i - (n - 1) / 2) * gap;
          ctx.fillStyle = U.rgba(col, 0.85);
          ctx.beginPath(); ctx.arc(px, 92, 3, 0, U.TAU); ctx.fill();
        }
        if (shown > 12) {
          ctx.font = '700 12px "Rajdhani",sans-serif';
          ctx.fillStyle = U.rgba(col, 0.85);
          ctx.fillText('+' + (shown - 12), W / 2 + (n / 2) * gap + 16, 93);
        }
        ctx.restore();
      }

      /* ---- boss health bar ---- */
      const bosses = this.enemies.filter(e => e.isBoss && e.alive);
      if (bosses.length) {
        const bw = Math.min(620, W - 80), bh = 15;
        const bx = (W - bw) / 2, by = H - (touch ? (portrait ? 372 : 222) : 62);
        let total = 0, max = 0;
        for (const b of bosses) { total += Math.max(0, b.hp); max += b.maxHp; }
        const bd = C.BOSS_MAP[this.room.bossId];
        ctx.textAlign = 'center';
        ctx.font = '700 20px "Rajdhani",sans-serif';
        ctx.fillStyle = bd.color;
        ctx.shadowColor = bd.color; ctx.shadowBlur = 16;
        ctx.fillText(bd.name, W / 2, by - 16);
        ctx.shadowBlur = 0;
        ctx.font = '600 10px "Rajdhani",sans-serif';
        ctx.fillStyle = 'rgba(154,149,180,.95)';
        ctx.fillText(bd.subtitle.toUpperCase(), W / 2, by - 2);

        ctx.fillStyle = 'rgba(6,5,12,.85)';
        U.rr(ctx, bx - 3, by + 6 - 3, bw + 6, bh + 6, 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(bx, by + 6, bw, bh);
        const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        bg.addColorStop(0, U.shade(bd.color, -0.5)); bg.addColorStop(1, bd.color);
        ctx.fillStyle = bg;
        ctx.fillRect(bx, by + 6, bw * U.clamp(total / max, 0, 1), bh);
        /* phase ticks */
        const b0 = bosses[0];
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 1; i < b0.maxPhase; i++) {
          const x = bx + bw * (1 - i / b0.maxPhase);
          ctx.moveTo(x, by + 6); ctx.lineTo(x, by + 6 + bh);
        }
        ctx.stroke();
        ctx.strokeStyle = U.rgba(bd.color, 0.6); ctx.lineWidth = 1;
        ctx.strokeRect(bx + .5, by + 6.5, bw - 1, bh - 1);
      }

      /* ---- low HP warning ---- */
      if (p.hp / p.maxHp < 0.3 && p.alive) {
        const pulse = 0.12 + 0.14 * Math.abs(Math.sin(this.realTime * 4));
        const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, `rgba(255,30,50,${pulse})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }

      /* ---- clear prompt ---- */
      if (this.state === 'clear' && this.stateT > 0.9) {
        ctx.textAlign = 'center';
        ctx.globalAlpha = U.clamp((this.stateT - 0.9) * 3, 0, 1) * (0.6 + 0.4 * Math.sin(this.realTime * 4));
        ctx.font = '700 15px "Rajdhani",sans-serif';
        ctx.fillStyle = '#9a95b4';
        ctx.fillText('ADVANCING…', W / 2, H - 96);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    drawBanners(ctx) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let i = 0;
      for (const b of this.banners) {
        if (b.delay > 0) continue;
        const k = b.life / b.max;
        const inA = U.clamp((1 - k) * 6, 0, 1);
        const outA = U.clamp(k * 4, 0, 1);
        const a = Math.min(inA, outA);
        const y = H * 0.32 + i * 46;
        ctx.globalAlpha = a;
        const scale = U.lerp(1.15, 1, U.ease.outBack(U.clamp((1 - k) * 3, 0, 1)));
        ctx.save();
        ctx.translate(W / 2, y);
        ctx.scale(scale, scale);
        ctx.font = `700 ${b.size}px "Rajdhani",Arial Narrow,sans-serif`;
        ctx.lineWidth = 6; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(4,3,10,.9)';
        ctx.strokeText(b.text, 0, 0);
        ctx.shadowColor = b.color; ctx.shadowBlur = 24;
        ctx.fillStyle = b.color;
        ctx.fillText(b.text, 0, 0);
        ctx.restore();
        i++;
      }
      ctx.restore();
    }

    drawBossIntro(ctx) {
      const bd = this.introText;
      const t = this.stateT;
      const k = U.clamp(t / 0.6, 0, 1);
      const out = U.clamp((this.introTime - t) / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.min(k, out);
      ctx.fillStyle = 'rgba(4,3,10,.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      const slide = U.lerp(60, 0, U.ease.outQuint(k));
      ctx.save();
      ctx.translate(W / 2 + slide, H / 2 - 40);
      ctx.font = '700 74px "Rajdhani",Arial Narrow,sans-serif';
      ctx.shadowColor = bd.color; ctx.shadowBlur = 40;
      ctx.fillStyle = bd.color;
      ctx.fillText(bd.name, 0, 0);
      ctx.shadowBlur = 0;
      ctx.font = '600 16px "Rajdhani",sans-serif';
      ctx.fillStyle = 'rgba(233,230,242,.75)';
      ctx.fillText(bd.subtitle.toUpperCase(), 0, 44);
      ctx.restore();

      ctx.globalAlpha = Math.min(U.clamp((t - 0.6) / 0.5, 0, 1), out);
      ctx.font = 'italic 17px Inter,system-ui,sans-serif';
      ctx.fillStyle = 'rgba(154,149,180,.95)';
      ctx.fillText('“' + bd.intro + '”', W / 2, H / 2 + 60);
      ctx.restore();
    }

    drawDeath(ctx) {
      const k = U.clamp(this.deadT / 1.6, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(4,2,6,${k * 0.82})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = U.clamp((this.deadT - 0.5) / 0.8, 0, 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 66px "Rajdhani",Arial Narrow,sans-serif';
      ctx.shadowColor = '#ff4d5e'; ctx.shadowBlur = 34;
      ctx.fillStyle = '#ff4d5e';
      ctx.fillText('YOU DROPPED IT', W / 2, H / 2);
      ctx.restore();
    }
  }

  /* helper: distance from point to segment */
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return U.dist(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = U.clamp(t, 0, 1);
    return U.dist(px, py, x1 + t * dx, y1 + t * dy);
  }

  DV.Arena = Arena;
})();
