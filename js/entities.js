/* ============================================================
   DEADMAN VOLLEY — entities.js
   Orb, Player, Enemy, Boss, Decoy, Pickup, Hazard.
   Entities read resolved stats from player.st (built in game.js)
   and call back into the arena `a` for world effects.
   ============================================================ */
(function () {
  const U = DV.U, FX = DV.FX, R = U.rnd, A = DV.Audio;

  /* One colour for "this can hurt you", regardless of what threw it. */
  const DANGER = '#ff4d5e';
  /* An orb carrying this many exchanges punches through a shield. */
  const SHIELD_BREAK_VOLLEY = 3;
  /* How long after being returned an orb refuses to be parried again. */
  const PARRY_LOCKOUT = 0.30;
  /* Release window after the charge fills, for a PERFECT RELEASE. */
  const PERFECT_RELEASE = 0.18;

  /* ============================================================
     ORB — the star of the show
     ============================================================ */
  let ORB_UID = 1;
  class Orb {
    constructor(o) {
      this.id = ORB_UID++;
      this.x = o.x; this.y = o.y;
      const sp = o.speed != null ? o.speed : 420;
      this.speed = sp;
      const ang = o.angle != null ? o.angle : 0;
      this.vx = Math.cos(ang) * sp;
      this.vy = Math.sin(ang) * sp;
      this.r = o.r || 13;
      this.baseR = this.r;
      this.owner = o.owner || 'enemy';       // 'player' | 'enemy'
      this.source = o.source || null;        // enemy ref that last hit it
      this.damage = o.damage != null ? o.damage : 18;
      this.volley = o.volley || 0;
      this.color = o.color || (this.owner === 'player' ? '#ffcf6b' : '#ff4d5e');
      this.alive = true;
      this.age = 0;
      this.life = o.life || 26;
      this.trail = [];
      this.judged = new Set();               // enemy ids that already rolled
      this.willParryBy = null;
      this.homing = o.homing || 0;
      this.splitOnParry = o.splits || 0;
      this.perfectMark = false;              // wraith / auto-perfect flag
      this.chill = 0;
      this.slowT = 0;
      this.bounces = o.bounces != null ? o.bounces : 40;
      this.kind = o.kind || 'orb';           // orb | echo | shard | boss
      this.noParry = !!o.noParry;
      this.spin = R.range(-2, 2);
      this.rot = R.range(0, U.TAU);
      this.grace = o.grace != null ? o.grace : 0.06; // can't hit its firer briefly
      this.wobble = R.range(0, U.TAU);
      this.pierce = o.pierce || 0;
      this.hitCooldown = 0;
      this.lastParryT = -99;
      this.tag = o.tag || null;
      this.seek = o.seek || null;            // entity to home onto (echo orbs)
      this.scale = 0;                        // spawn pop
      /* A LIVE orb is owner:'player' (so it still damages enemies) but is also
         hostile to the player. Only produced by the Both Hands relic. */
      this.live = false;
      this.parryLockUntil = 0;               // set on parry; blocks instant re-catches
    }

    /* true for anything that can damage the player — drives the spiked silhouette */
    get hostile() { return this.owner === 'enemy' || this.live; }

    get angle() { return Math.atan2(this.vy, this.vx); }

    setAngle(ang, speed) {
      const s = speed != null ? speed : Math.hypot(this.vx, this.vy);
      this.speed = s;
      this.vx = Math.cos(ang) * s;
      this.vy = Math.sin(ang) * s;
    }

    kill(a, silent) {
      if (!this.alive) return;
      this.alive = false;
      if (!silent) {
        FX.burst(this.x, this.y, 10, {
          color: this.color, color2: '#ffffff',
          speedMin: 30, speedMax: 190, lifeMax: 0.5, rMax: 3.5
        });
        FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: this.r * 3.4, life: 0.3, color: this.color, w: 2 });
      }
    }

    update(dt, a) {
      this.age += dt;
      this.scale = U.approach(this.scale, 1, dt, 0.35);
      this.grace = Math.max(0, this.grace - dt);
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
      if (this.age > this.life) { this.kill(a); return; }

      /* chill / slow */
      let spdMul = 1;
      if (this.slowT > 0) { this.slowT -= dt; spdMul = 0.55; }

      /* homing */
      if (this.seek && this.seek.alive) {
        const want = U.angTo(this.x, this.y, this.seek.x, this.seek.y);
        const cur = this.angle;
        this.setAngle(U.angLerp(cur, want, Math.min(1, 6 * dt)));
      } else if (this.homing > 0 && this.owner === 'player') {
        const t = a.aimTarget;
        if (t && t.alive) {
          const want = U.angTo(this.x, this.y, t.x, t.y);
          this.setAngle(U.angLerp(this.angle, want, Math.min(1, 2.4 * this.homing * dt)));
        }
      } else if (this.homing > 0 && this.owner === 'enemy') {
        const want = U.angTo(this.x, this.y, a.player.x, a.player.y);
        this.setAngle(U.angLerp(this.angle, want, Math.min(1, 1.2 * this.homing * dt)));
      }

      /* gravity wells */
      for (const g of a.wells) {
        const d = U.dist(this.x, this.y, g.x, g.y);
        if (d < g.r && d > 1) {
          const pull = (1 - d / g.r) * g.force * dt;
          this.vx += (g.x - this.x) / d * pull;
          this.vy += (g.y - this.y) / d * pull;
          const s = Math.hypot(this.vx, this.vy);
          this.speed = s;
        }
      }

      /* trail */
      this.trail.push(this.x, this.y);
      const maxTrail = 22;
      while (this.trail.length > maxTrail * 2) this.trail.splice(0, 2);

      /* motion */
      const nx = this.x + this.vx * spdMul * dt;
      const ny = this.y + this.vy * spdMul * dt;
      this.x = nx; this.y = ny;
      this.rot += this.spin * dt;

      /* arena walls */
      const b = a.bounds;
      let bounced = false;
      if (this.x - this.r < b.x) { this.x = b.x + this.r; this.vx = Math.abs(this.vx); bounced = true; }
      if (this.x + this.r > b.x + b.w) { this.x = b.x + b.w - this.r; this.vx = -Math.abs(this.vx); bounced = true; }
      if (this.y - this.r < b.y) { this.y = b.y + this.r; this.vy = Math.abs(this.vy); bounced = true; }
      if (this.y + this.r > b.y + b.h) { this.y = b.y + b.h - this.r; this.vy = -Math.abs(this.vy); bounced = true; }
      if (bounced) {
        this.bounces--;
        this.judged.clear(); this.willParryBy = null;
        A.play('orb_bounce');
        FX.burst(this.x, this.y, 5, { color: this.color, speedMin: 40, speedMax: 150, lifeMax: 0.3, rMax: 2.5 });
        FX.ring({ x: this.x, y: this.y, r: 3, rEnd: 26, life: 0.22, color: this.color, w: 2 });
        if (this.bounces <= 0) this.kill(a);
      }

      /* orb-size growth with volley (Hollow Sun relic + inherent) */
      const grow = 1 + Math.min(this.volley, 20) * (a.st.sunOrb ? 0.055 : 0.018);
      this.r = this.baseR * grow;

      /* emit motes */
      if (R.chance(Math.min(0.9, 0.25 + this.volley * 0.05))) {
        const ang = this.angle + Math.PI + R.spread(0.9);
        FX.particle({
          x: this.x + R.spread(this.r * .5), y: this.y + R.spread(this.r * .5),
          vx: Math.cos(ang) * R.range(20, 90), vy: Math.sin(ang) * R.range(20, 90),
          life: R.range(0.18, 0.45), r: R.range(1, 2.6 + this.volley * 0.12),
          color: this.color, color2: '#ffffff', drag: 0.9, glow: 0.8
        });
      }
    }

    draw(ctx, a) {
      const s = U.ease.outBack(U.clamp(this.scale, 0, 1));
      const r = this.r * s;
      const v = Math.min(this.volley, 20);

      /* ---- ownership language --------------------------------------------
         hostile  -> SPIKED silhouette + unified danger core. "Parry this."
         friendly -> SMOOTH rings + forward chevron. "Ignore this."
         live     -> spiked (it can kill you) but in your own colour + white rim.
         Shape carries the signal; colour is only ever a secondary cue.        */
      const hostile = this.hostile;
      const bodyCol = hostile ? (this.live ? this.color : DANGER) : this.color;
      const hot = U.mixHex(bodyCol, '#ffffff', 0.55 + Math.min(0.4, v * 0.02));

      /* trail */
      const t = this.trail;
      if (t.length >= 4) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? hot : bodyCol;
          ctx.beginPath();
          ctx.moveTo(t[0], t[1]);
          for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
          ctx.globalAlpha = pass ? 0.5 : 0.28;
          ctx.lineWidth = pass ? r * 0.5 : r * 1.5;
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      /* outer bloom (cached sprite — see FX.glow) */
      const bloom = Math.min(r * (3.6 + v * 0.12), 190);
      FX.glow(ctx, this.x, this.y, bloom, bodyCol, 1, 'orb');

      if (hostile) {
        /* --- SPIKES: the "you must deal with this" silhouette --- */
        const spin = this.rot * 0.9;
        ctx.fillStyle = U.rgba(hot, 0.9);
        U.poly(ctx, this.x, this.y, 5, r * 1.95, r * 1.02, spin);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = this.live ? 0.55 + 0.35 * Math.sin(a.time * 11) : 0.4;
        U.poly(ctx, this.x, this.y, 5, r * 1.95, r * 1.02, spin);
        ctx.stroke();
        ctx.globalAlpha = 1;

        /* source rim — which enemy threw it (flavour, not the primary signal) */
        if (!this.live) {
          ctx.strokeStyle = U.rgba(this.color, 0.85);
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(this.x, this.y, r * 2.25, 0, U.TAU); ctx.stroke();
        }
      } else {
        /* --- FRIENDLY: smooth ring + a chevron pointing where it is going --- */
        ctx.strokeStyle = U.rgba(hot, 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(this.x, this.y, r * 1.5, 0, U.TAU); ctx.stroke();

        const ang = this.angle;
        const cx = this.x + Math.cos(ang) * r * 2.1;
        const cy = this.y + Math.sin(ang) * r * 2.1;
        ctx.fillStyle = U.rgba(hot, 0.9);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r * 0.85, cy + Math.sin(ang) * r * 0.85);
        ctx.lineTo(cx + Math.cos(ang + 2.4) * r * 0.7, cy + Math.sin(ang + 2.4) * r * 0.7);
        ctx.lineTo(cx + Math.cos(ang - 2.4) * r * 0.7, cy + Math.sin(ang - 2.4) * r * 0.7);
        ctx.closePath(); ctx.fill();
      }

      /* core */
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.56, 0, U.TAU); ctx.fill();
      ctx.fillStyle = U.rgba(hot, 0.9);
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.92, 0, U.TAU); ctx.fill();

      /* volley rings */
      if (v > 0) {
        ctx.strokeStyle = U.rgba(hot, 0.85);
        for (let i = 0; i < Math.min(v, 6); i++) {
          const rr = r * (1.25 + i * 0.34);
          const seg = U.TAU / (2 + i);
          ctx.lineWidth = Math.max(0.7, 2.2 - i * 0.28);
          ctx.globalAlpha = 0.75 - i * 0.1;
          ctx.beginPath();
          ctx.arc(this.x, this.y, rr, this.rot * (i % 2 ? -1 : 1) + i, this.rot * (i % 2 ? -1 : 1) + i + seg);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      /* incoming-parry telegraph on high volleys */
      if (v >= 6) {
        const pulse = 0.5 + 0.5 * Math.sin(a.time * (8 + v));
        ctx.strokeStyle = U.rgba('#ffffff', 0.14 + pulse * 0.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(this.x, this.y, r * (2.1 + pulse * 0.5), 0, U.TAU); ctx.stroke();
      }

      /* perfect-mark (wraith) */
      if (this.perfectMark) {
        ctx.strokeStyle = '#7dff9b'; ctx.lineWidth = 2;
        U.poly(ctx, this.x, this.y, 3, r * 2.2, null, a.time * 3);
        ctx.stroke();
      }

      /* ---- closing reticle: a ring that tightens as impact approaches ----
         This is the parry-timing tell. Blind Faith trades it away.          */
      if (hostile && a.player && a.player.alive && !a.st.noTelegraph) {
        const px = a.player.x, py = a.player.y;
        const d = U.dist(this.x, this.y, px, py);
        const closing = ((px - this.x) * this.vx + (py - this.y) * this.vy) > 0;
        if (closing && d < 240) {
          const k = U.clamp(d / 240, 0, 1);          /* 1 = far, 0 = on top of you */
          const rr = r * 1.6 + k * 34;
          ctx.strokeStyle = U.rgba('#ffffff', (1 - k) * 0.7);
          ctx.lineWidth = 1.6 + (1 - k) * 1.8;
          U.poly(ctx, this.x, this.y, 4, rr, null, this.rot * 0.5);
          ctx.stroke();
        }
      }
      ctx.restore();

      /* rally count — shown on EVERY orb past two exchanges. A high-volley
         enemy orb is the most dangerous thing on screen; it needs a number. */
      if (v >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.font = '700 12px "Rajdhani",Arial Narrow,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = U.rgba(hostile ? '#ffffff' : hot, 0.9);
        ctx.fillText('×' + this.volley, this.x, this.y - r - 13);
        ctx.restore();
      }
    }
  }

  /* ============================================================
     PLAYER
     ============================================================ */
  class Player {
    constructor(x, y, st, vessel) {
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.r = 15;
      this.st = st;
      this.vessel = vessel;
      this.color = vessel.color;
      this.alive = true;

      this.hp = st.maxHp;
      this.maxHp = st.maxHp;
      this.ki = st.kiMax * 0.5;

      this.aim = 0;
      this.facing = 0;

      this.parryT = 0;       // remaining active window
      this.parryCd = 0;
      this.whiff = 0;
      this.parryCaught = false;
      this.parryFlash = 0;
      this.parryRingT = 0;
      this.lastParryPerfect = false;

      this.charge = 0;
      this.charging = false;
      this.fireCd = 0;
      this.chargeFullT = -1;      /* arena time the charge filled; -1 = not full */
      this.lastReleasePerfect = false;

      this.dashT = 0;
      this.dashCd = 0;
      this.dashCharges = st.dashCharges;
      this.dashAng = 0;
      this.iframe = 0;

      this.buffs = {};
      this.satellites = [];
      this.stillT = 0;
      this.shield = 0;         // bulwark / bastion absorb count
      this.bastionT = 0;
      this.intangible = 0;
      this.chainT = 0;
      this.splitCharges = 0;
      this.blindT = 0;
      this.usedCheatDeath = false;
      this.revives = st.revives || 0;

      this.parryStreak = 0;    // consecutive successful parries this rally
      this.parryCount = 0;     // lifetime for metronome / echo
      this.deadmanStacks = 0;
      this.overreachPenalty = 0;

      this.techs = [];         // filled by run
      this.techCd = [0, 0];

      this.hurtFlash = 0;
      this.walkPhase = 0;
      this.trail = [];
      this.afterimages = [];

      for (let i = 0; i < (st.satellites || 0); i++) {
        this.satellites.push({ a: (i / (st.satellites || 1)) * U.TAU, hitCd: 0 });
      }
    }

    get parryRadius() {
      let r = this.st.parryRadius;
      r *= (this.st.parryRadiusMult || 1);
      r *= (1 - this.overreachPenalty);
      return r;
    }
    get parryWindow() { return this.st.parryWindow * (this.st.parryWindowMult || 1); }
    get perfectWindow() { return this.st.perfectWindow * (this.st.perfectWindowMult || 1); }

    buffStacks(id) { const b = this.buffs[id]; return b ? b.stacks : 0; }
    addBuff(id, dur, maxStacks) {
      const b = this.buffs[id] || (this.buffs[id] = { t: 0, stacks: 0 });
      b.t = Math.max(b.t, dur);
      b.stacks = Math.min(maxStacks || 1, b.stacks + 1);
    }

    /* ---------- parry attempt ---------- */
    tryParry(a) {
      if (this.parryT > 0 || this.parryCd > 0 || this.whiff > 0) {
        if (this.whiff > 0) A.play('ui_deny');
        return;
      }
      this.parryT = this.parryWindow;
      this.parryCaught = false;
      this.parryRingT = 1;
      A.play('parry_whiff');
      FX.ring({
        x: this.x, y: this.y, r: this.parryRadius * 0.35, rEnd: this.parryRadius,
        life: 0.16, color: this.color, w: 2.4, ease: 'outQuad'
      });
    }

    /* ---------- dash ---------- */
    tryDash(a, mv) {
      if (this.st.noDash) return;
      if (this.dashT > 0 || this.dashCharges <= 0) return;
      let ang;
      if (mv.mag > 0.1) ang = Math.atan2(mv.y, mv.x);
      else ang = this.aim;
      this.dashAng = ang;
      this.dashT = this.st.dashTime;
      this.iframe = Math.max(this.iframe, this.st.dashIFrames);
      this.dashCharges--;
      if (this.dashCd <= 0) this.dashCd = this.st.dashCooldown * (this.st.dashCooldownMult || 1);
      A.play('dash');
      FX.ring({ x: this.x, y: this.y, r: 8, rEnd: 46, life: 0.28, color: this.color, w: 3 });
      FX.burst(this.x, this.y, 12, {
        color: this.color, angle: ang + Math.PI, spread: 0.7,
        speedMin: 90, speedMax: 300, lifeMax: 0.4, rMax: 3
      });
      a.hook('onDash', {});
      /* wraith: dash through orbs */
      if (this.vessel.id === 'wraith') this.dashPhase = 0.2;
    }

    hurt(a, amount, src) {
      return a.damagePlayer(amount, src);
    }

    update(dt, a, IN, controllable) {
      const st = this.st;
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3.5);
      this.parryFlash = Math.max(0, this.parryFlash - dt * 4);
      this.parryRingT = Math.max(0, this.parryRingT - dt * 6);
      this.iframe = Math.max(0, this.iframe - dt);
      this.intangible = Math.max(0, this.intangible - dt);
      this.chainT = Math.max(0, this.chainT - dt);
      this.bastionT = Math.max(0, this.bastionT - dt);
      this.blindT = Math.max(0, this.blindT - dt);
      if (this.dashPhase) this.dashPhase = Math.max(0, this.dashPhase - dt);

      for (const k in this.buffs) {
        const b = this.buffs[k];
        b.t -= dt;
        if (b.t <= 0) delete this.buffs[k];
      }

      /* ki */
      this.ki = Math.min(st.kiMax, this.ki + st.kiRegen * (st.kiRegenMult || 1) * dt);
      for (let i = 0; i < this.techCd.length; i++) this.techCd[i] = Math.max(0, this.techCd[i] - dt);

      /* aim */
      this.aim = IN.aimAngle(this.x, this.y);

      /* ---- movement ---- */
      const mv = controllable ? IN.moveVec() : { x: 0, y: 0, mag: 0 };
      let spd = st.speed * (st.speedMult || 1);
      spd *= 1 + this.buffStacks('riposte') * 0.12;
      if (this.charging) spd *= 0.58;
      if (this.parryT > 0) spd *= 0.72;
      if (this.whiff > 0) spd *= 0.45;

      if (this.dashT > 0) {
        this.dashT -= dt;
        const ds = st.dashSpeed * U.map(this.dashT, st.dashTime, 0, 1, 0.35);
        this.vx = Math.cos(this.dashAng) * ds;
        this.vy = Math.sin(this.dashAng) * ds;
        if (R.chance(0.9)) this.afterimages.push({ x: this.x, y: this.y, a: 0.55, ang: this.facing });
      } else {
        const tx = mv.x * spd, ty = mv.y * spd;
        this.vx = U.approach(this.vx, tx, dt, st.accel);
        this.vy = U.approach(this.vy, ty, dt, st.accel);
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      const b = a.bounds;
      this.x = U.clamp(this.x, b.x + this.r, b.x + b.w - this.r);
      this.y = U.clamp(this.y, b.y + this.r, b.y + b.h - this.r);

      if (mv.mag > 0.1) this.facing = U.angLerp(this.facing, Math.atan2(mv.y, mv.x), Math.min(1, 12 * dt));
      this.walkPhase += Math.hypot(this.vx, this.vy) * dt * 0.045;

      /* afterimage fade */
      for (let i = this.afterimages.length - 1; i >= 0; i--) {
        const ai = this.afterimages[i];
        ai.a -= dt * 2.4;
        if (ai.a <= 0) this.afterimages.splice(i, 1);
      }

      /* bulwark stand-still shield */
      if (this.vessel.id === 'bulwark') {
        if (mv.mag < 0.05 && this.dashT <= 0) {
          this.stillT += dt;
          if (this.stillT > 1 && this.shield < 1) {
            this.shield = 1; this.stillT = 0;
            A.play('pickup');
            FX.ring({ x: this.x, y: this.y, r: 10, rEnd: 44, life: 0.4, color: '#6be6ff', w: 3 });
            FX.text(this.x, this.y - 30, 'GUARD', { color: '#6be6ff', size: 15 });
          }
        } else this.stillT = 0;
      }

      /* dash charge regen */
      if (this.dashCharges < st.dashCharges) {
        this.dashCd -= dt;
        if (this.dashCd <= 0) {
          this.dashCharges++;
          if (this.dashCharges < st.dashCharges) this.dashCd = st.dashCooldown * (st.dashCooldownMult || 1);
        }
      }

      /* ---- parry timers ---- */
      if (this.parryT > 0) {
        this.parryT -= dt;
        if (this.parryT <= 0) {
          this.parryT = 0;
          if (this.parryCaught) {
            this.parryCd = st.parryCooldown * (st.parryCooldownMult || 1);
          } else {
            this.whiff = st.parryWhiffLock * (st.whiffMult || 1);
            this.parryStreak = 0;
          }
        }
      }
      if (this.parryCd > 0) this.parryCd -= dt;
      if (this.whiff > 0) this.whiff -= dt;

      /* ---- charge / fire ---- */
      this.fireCd = Math.max(0, this.fireCd - dt);
      if (controllable && IN.fireDown() && this.whiff <= 0 && this.fireCd <= 0) {
        if (!this.charging) { this.charging = true; this.chargeFullT = -1; A.play('charge_start'); }
        const ct = st.chargeTime * (st.chargeTimeMult || 1);
        const prev = this.charge;
        this.charge = Math.min(1, this.charge + dt / ct);
        if (prev < 1 && this.charge >= 1) {
          /* the beat opens here — release inside PERFECT_RELEASE for the bonus */
          this.chargeFullT = a.time;
          A.play('charge_full');
          FX.ring({ x: this.x, y: this.y, r: 34, rEnd: 16, life: 0.18, color: '#ffffff', w: 3, ease: 'outQuad' });
        }
        if (R.chance(0.55)) {
          const ang = R.range(0, U.TAU);
          const d = 46 - this.charge * 26;
          FX.particle({
            x: this.x + Math.cos(ang) * d, y: this.y + Math.sin(ang) * d,
            vx: -Math.cos(ang) * 70 * this.charge, vy: -Math.sin(ang) * 70 * this.charge,
            life: 0.3, r: R.range(1, 2.6), color: this.color, color2: '#ffffff', drag: 0.92
          });
        }
      } else if (this.charging) {
        this.charging = false;
        this.fire(a);
      }

      /* satellites */
      for (const s of this.satellites) {
        s.a += dt * 2.2;
        s.hitCd = Math.max(0, s.hitCd - dt);
      }

      /* ki-less clamp */
      this.hp = Math.min(this.hp, this.maxHp);
    }

    fire(a) {
      const st = this.st;
      const c = this.charge;
      /* PERFECT RELEASE: let go inside the window that opens when the charge fills.
         Missing it is not punished — you just get an ordinary full-charge shot. */
      const perfect = c >= 0.99 && this.chargeFullT >= 0 && (a.time - this.chargeFullT) <= PERFECT_RELEASE;
      this.lastReleasePerfect = perfect;
      this.charge = 0;
      this.chargeFullT = -1;
      this.fireCd = 0.16;

      let dmg = (13 + 27 * c) * st.power * (st.powerMult || 1);
      let sp = st.orbSpeed * (st.orbSpeedMult || 1) * (0.78 + 0.34 * c);
      let rad = 9 + 7 * c;
      let volley = c >= 0.99 ? 1 : 0;
      let col = this.color;
      if (perfect) {
        dmg *= 1.6;
        sp *= 1.35;
        rad += 3;
        volley = 2;                       /* starts the rally two exchanges in */
        col = U.mixHex(this.color, '#ffffff', 0.45);
        a.addKi(12);
      }

      const orb = a.spawnOrb({
        x: this.x + Math.cos(this.aim) * 24,
        y: this.y + Math.sin(this.aim) * 24,
        angle: this.aim, speed: sp,
        owner: 'player', damage: dmg,
        r: rad, volley,
        color: col, homing: st.homing || 0,
        grace: 0.02,
      });
      A.play('fire', c);
      if (perfect) {
        A.play('charge_perfect');
        FX.stop(0.05);
        FX.chromatic(0.6);
        FX.shake(9);
        FX.screenFlash('#ffffff', 0.14);
        FX.text(this.x, this.y - 52, 'PERFECT RELEASE', { color: '#ffffff', size: 19, crit: true, shadow: true });
        FX.ring({ x: this.x, y: this.y, r: 10, rEnd: 130, life: 0.4, color: '#ffffff', w: 4 });
        FX.ring({ x: this.x, y: this.y, r: 6, rEnd: 90, life: 0.3, color: col, w: 3, squash: 0.4, angle: this.aim });
      }
      FX.shake(3 + c * 5);
      FX.ring({
        x: this.x + Math.cos(this.aim) * 20, y: this.y + Math.sin(this.aim) * 20,
        r: 4, rEnd: 30 + c * 40, life: 0.24, color: this.color, w: 2 + c * 2,
        squash: 0.45, angle: this.aim
      });
      FX.burst(this.x + Math.cos(this.aim) * 22, this.y + Math.sin(this.aim) * 22, 6 + c * 10, {
        color: this.color, angle: this.aim, spread: 0.5, speedMin: 100, speedMax: 340 + c * 200, lifeMax: 0.4
      });
      this.vx -= Math.cos(this.aim) * (60 + c * 120);
      this.vy -= Math.sin(this.aim) * (60 + c * 120);
      a.hook('onFire', { orb });
      return orb;
    }

    draw(ctx, a) {
      const st = this.st;

      /* afterimages */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const ai of this.afterimages) {
        ctx.globalAlpha = ai.a * 0.5;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(ai.x, ai.y, this.r * ai.a * 1.4, 0, U.TAU); ctx.fill();
      }
      ctx.restore();

      /* parry reach indicator (soft, always present) */
      const pr = this.parryRadius;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const idle = 0.045 + 0.02 * Math.sin(a.time * 2.4);
      ctx.strokeStyle = U.rgba(this.color, this.parryT > 0 ? 0.7 : idle);
      ctx.lineWidth = this.parryT > 0 ? 3 : 1;
      ctx.setLineDash(this.parryT > 0 ? [] : [4, 9]);
      ctx.beginPath(); ctx.arc(this.x, this.y, pr, 0, U.TAU); ctx.stroke();
      ctx.setLineDash([]);

      /* active parry window: bright, with the perfect sub-window shown as an arc */
      if (this.parryT > 0) {
        const el = this.parryWindow - this.parryT;
        const isPerf = el <= this.perfectWindow;
        const c = isPerf ? '#ffffff' : this.color;
        ctx.strokeStyle = U.rgba(c, 0.9);
        ctx.lineWidth = isPerf ? 5 : 2.5;
        ctx.beginPath(); ctx.arc(this.x, this.y, pr * (0.9 + 0.1 * (this.parryT / this.parryWindow)), 0, U.TAU); ctx.stroke();
        const g = ctx.createRadialGradient(this.x, this.y, pr * 0.5, this.x, this.y, pr * 1.1);
        g.addColorStop(0, U.rgba(c, 0));
        g.addColorStop(1, U.rgba(c, isPerf ? 0.22 : 0.1));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(this.x, this.y, pr * 1.1, 0, U.TAU); ctx.fill();
      }
      /* whiff = red flicker */
      if (this.whiff > 0) {
        ctx.strokeStyle = U.rgba('#ff4d5e', 0.35 * (this.whiff / (st.parryWhiffLock || 1)));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.x, this.y, pr * 0.8, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();

      /* bastion barrier */
      if (this.bastionT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const p = 0.5 + 0.5 * Math.sin(a.time * 9);
        ctx.strokeStyle = U.rgba('#6be6ff', 0.5 + p * 0.35);
        ctx.lineWidth = 4;
        U.poly(ctx, this.x, this.y, 6, pr * 1.35, null, a.time * 0.9);
        ctx.stroke();
        ctx.fillStyle = U.rgba('#6be6ff', 0.08);
        ctx.fill();
        ctx.restore();
      }

      /* charge ring */
      if (this.charge > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const cr = 30 - this.charge * 12;
        ctx.strokeStyle = U.rgba(this.charge >= 1 ? '#ffffff' : this.color, 0.85);
        ctx.lineWidth = 2 + this.charge * 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, cr, -Math.PI / 2, -Math.PI / 2 + U.TAU * this.charge);
        ctx.stroke();
        if (this.charge >= 1) {
          const since = this.chargeFullT >= 0 ? a.time - this.chargeFullT : 99;
          const inBeat = since <= PERFECT_RELEASE;
          if (inBeat) {
            /* the beat: a white ring closing onto the charge ring. Release now. */
            const k = U.clamp(since / PERFECT_RELEASE, 0, 1);
            ctx.strokeStyle = U.rgba('#ffffff', 0.95 - k * 0.25);
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(this.x, this.y, cr + 14 * (1 - k), 0, U.TAU); ctx.stroke();
            ctx.strokeStyle = U.rgba('#ffffff', 0.9);
            ctx.lineWidth = 2;
            U.poly(ctx, this.x, this.y, 3, cr + 7, null, a.time * 6);
            ctx.stroke();
          } else {
            /* beat missed — settle to plain gold so the miss is legible */
            ctx.strokeStyle = U.rgba(this.color, 0.35 + 0.15 * Math.sin(a.time * 6));
            ctx.lineWidth = 1.5;
            U.poly(ctx, this.x, this.y, 3, cr + 7, null, a.time * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      /* body */
      const bob = Math.sin(this.walkPhase) * 1.6;
      const px = this.x, py = this.y + bob;
      ctx.save();

      /* shadow */
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + this.r * 0.95, this.r * 0.85, this.r * 0.34, 0, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 1;

      const inv = this.iframe > 0 || this.intangible > 0;
      if (inv) ctx.globalAlpha = 0.42 + 0.28 * Math.sin(a.time * 34);

      /* glow */
      ctx.globalCompositeOperation = 'lighter';
      const bodyC = this.hurtFlash > 0 ? U.mixHex(this.color, '#ff4d5e', this.hurtFlash) : this.color;
      FX.glow(ctx, px, py, this.r * 3.4, bodyC, 0.9);
      ctx.globalCompositeOperation = 'source-over';

      /* core diamond */
      ctx.translate(px, py);
      ctx.rotate(this.facing + Math.PI / 4);
      const rr = this.r * (1 + this.parryFlash * 0.25);
      ctx.fillStyle = '#0b0a14';
      ctx.strokeStyle = bodyC;
      ctx.lineWidth = 3;
      U.rr(ctx, -rr * 0.78, -rr * 0.78, rr * 1.56, rr * 1.56, 3);
      ctx.fill(); ctx.stroke();
      ctx.rotate(-(this.facing + Math.PI / 4));

      /* glyph */
      ctx.fillStyle = bodyC;
      ctx.font = '700 15px "Rajdhani",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.vessel.glyph, 0, 1);
      ctx.restore();

      /* aim reticle line */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(this.aim) * (this.r + 8), this.y + Math.sin(this.aim) * (this.r + 8));
      ctx.lineTo(this.x + Math.cos(this.aim) * (this.r + 74), this.y + Math.sin(this.aim) * (this.r + 74));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      /* shield pip */
      if (this.shield > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#6be6ff', 0.75);
        ctx.lineWidth = 2.5;
        U.poly(ctx, this.x, this.y, 6, this.r + 9, null, a.time * 1.5);
        ctx.stroke();
        ctx.restore();
      }

      /* satellites */
      for (const s of this.satellites) {
        const sx = this.x + Math.cos(s.a) * 52, sy = this.y + Math.sin(s.a) * 52;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        FX.glow(ctx, sx, sy, 18, '#b46bff', 1);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, U.TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ============================================================
     ENEMY
     ============================================================ */
  let EN_UID = 1;
  class Enemy {
    constructor(def, x, y, a, opts) {
      opts = opts || {};
      this.uid = EN_UID++;
      this.def = def;
      this.id = def.id;
      this.name = def.name;
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.r = def.r * (opts.scale || 1);
      this.color = def.color;
      this.glyph = def.glyph;
      this.ai = def.ai;
      this.maxHp = Math.round(def.hp * (opts.hpMult || 1));
      this.hp = this.maxHp;
      this.speed = def.speed * (opts.speedMult || 1);
      this.contact = (def.contact || 0) * (opts.dmgMult || 1);
      this.alive = true;
      this.elite = !!opts.elite;
      this.isBoss = false;

      this.parry = def.parry ? Object.assign({}, def.parry) : null;
      if (this.parry && opts.parryBonus) this.parry.skill = Math.min(1, this.parry.skill + opts.parryBonus);
      this.parryCd = R.range(0, 0.6);
      this.parryIntent = null;
      this.parryFlash = 0;

      this.fireCd = def.fireCd ? R.range(def.fireCd * 0.4, def.fireCd) : 0;
      this.orbPower = (def.orbPower || 16) * (opts.dmgMult || 1);
      this.orbSpeed = def.orbSpeed || 340;

      this.state = 'idle';
      this.stateT = 0;
      this.facing = R.range(0, U.TAU);
      this.aimAngle = 0;
      this.orbitDir = R.sign();
      this.orbitR = R.range(180, 260);
      this.wander = R.range(0, U.TAU);

      this.hurtFlash = 0;
      this.spawnT = 0.55;
      this.slowT = 0;
      this.blindT = 0;
      this.stunT = 0;
      this.knock = { x: 0, y: 0 };
      this.shieldedBy = null;
      this.shieldBroken = false;   /* shattered permanently by a 3+ rally */
      this.summoned = [];
      this.fuse = 0;
      this.bobPhase = R.range(0, U.TAU);
      this.deathAngle = 0;
      this.hitFlashScale = 0;
      this.xp = def.xp || 1;
    }

    get shieldFacing() { return this.facing; }

    /* returns true if incoming angle is blocked by the shield arc */
    blocks(fromAngle) {
      if (!this.def.shieldArc || this.shieldBroken) return false;
      const d = Math.abs(U.angDiff(this.facing, fromAngle + Math.PI));
      return d < this.def.shieldArc / 2;
    }

    /* Shatter the front shield for the rest of the room. */
    breakShield(a) {
      if (this.shieldBroken) return;
      this.shieldBroken = true;
      const arc = this.def.shieldArc;
      A.play('shield_break');
      A.duck(0.3, 0.4);
      FX.stop(0.08);
      FX.shake(14);
      FX.slow(0.14, 0.4);
      FX.ring({ x: this.x, y: this.y, r: this.r + 9, rEnd: this.r + 90, life: 0.45, color: '#6be6ff', w: 6, arc, angle: this.facing });
      FX.ring({ x: this.x, y: this.y, r: this.r + 9, rEnd: this.r + 55, life: 0.3, color: '#ffffff', w: 3, arc, angle: this.facing });
      for (let i = 0; i < 22; i++) {
        const ang = this.facing + R.spread(arc / 2);
        FX.particle({
          x: this.x + Math.cos(ang) * (this.r + 9), y: this.y + Math.sin(ang) * (this.r + 9),
          vx: Math.cos(ang) * R.range(120, 420), vy: Math.sin(ang) * R.range(120, 420),
          life: R.range(0.4, 0.9), r: R.range(2, 5), color: '#6be6ff', color2: '#ffffff',
          shape: 'shard', spin: 9, drag: 0.94
        });
      }
      FX.text(this.x, this.y - this.r - 26, 'SHIELD BROKEN', { color: '#6be6ff', size: 20, crit: true, shadow: true });
    }

    canParryNow() {
      return this.parry && this.parryCd <= 0 && this.blindT <= 0 && this.stunT <= 0 && this.spawnT <= 0;
    }

    hurt(a, dmg, opts) {
      return a.hitEnemy(this, dmg, opts);
    }

    die(a, opts) {
      if (!this.alive) return;
      this.alive = false;
      A.play('enemy_die');
      FX.burst(this.x, this.y, 22, {
        color: this.color, color2: '#ffffff',
        speedMin: 60, speedMax: 380, lifeMax: 0.8, rMax: 4.5, shape: 'shard', spin: 8
      });
      FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: this.r * 5.5, life: 0.45, color: this.color, w: 3.5 });
      FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: this.r * 3, life: 0.28, color: '#ffffff', w: 2 });
      FX.shake(6);

      /* splitter */
      if (this.def.splits && !this.isSpawn) {
        for (let i = 0; i < this.def.splits; i++) {
          const ang = (i / this.def.splits) * U.TAU + R.range(0, 1);
          const child = a.spawnEnemy('husk', this.x + Math.cos(ang) * 26, this.y + Math.sin(ang) * 26, { scale: 0.82 });
          if (child) { child.isSpawn = true; child.maxHp = child.hp = Math.round(child.maxHp * 0.6); }
        }
      }
      a.onEnemyDied(this);
    }

    update(dt, a) {
      if (this.spawnT > 0) { this.spawnT -= dt; }
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
      this.hitFlashScale = Math.max(0, this.hitFlashScale - dt * 6);
      this.parryFlash = Math.max(0, this.parryFlash - dt * 3);
      this.parryCd = Math.max(0, this.parryCd - dt);
      this.blindT = Math.max(0, this.blindT - dt);
      this.stunT = Math.max(0, this.stunT - dt);
      this.slowT = Math.max(0, this.slowT - dt);
      this.stateT += dt;
      this.bobPhase += dt * 3;

      const P = a.decoy && a.decoy.alive ? a.decoy : a.player;
      this.target = P;
      const toP = U.angTo(this.x, this.y, P.x, P.y);
      const dP = U.dist(this.x, this.y, P.x, P.y);
      this.aimAngle = toP;

      let spd = this.speed * (this.slowT > 0 ? 0.55 : 1);
      if (this.stunT > 0 || this.spawnT > 0) spd = 0;
      if (this.blindT > 0) spd *= 0.6;

      let mvx = 0, mvy = 0;

      switch (this.ai) {
        case 'chaser': {
          mvx = Math.cos(toP); mvy = Math.sin(toP);
          break;
        }
        case 'caster': {
          /* keep mid distance */
          const want = 250;
          const k = dP < want - 40 ? -1 : dP > want + 60 ? 1 : 0;
          mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
          mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.55;
          mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.55;
          this.tryFire(a, dt, toP);
          break;
        }
        case 'duelist': {
          const want = 300;
          const k = dP < want - 60 ? -1 : dP > want + 70 ? 1 : 0;
          mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
          mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.7;
          mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.7;
          if (R.chance(dt * 0.35)) this.orbitDir *= -1;
          /* only fire when no player-owned orb is in play (keeps the rally sacred) */
          if (!a.orbs.some(o => o.alive && o.owner === 'player' && o.volley > 0)) this.tryFire(a, dt, toP);
          break;
        }
        case 'orbiter': {
          this.wander += dt * this.orbitDir * 1.5;
          const tx = P.x + Math.cos(this.wander) * this.orbitR;
          const ty = P.y + Math.sin(this.wander) * this.orbitR;
          const ang = U.angTo(this.x, this.y, tx, ty);
          mvx = Math.cos(ang); mvy = Math.sin(ang);
          this.tryFire(a, dt, toP);
          break;
        }
        case 'mirror': {
          const want = 340;
          const k = dP < want - 50 ? -1 : dP > want + 60 ? 1 : 0;
          mvx = Math.cos(toP) * k * 0.9; mvy = Math.sin(toP) * k * 0.9;
          mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.8;
          mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.8;
          if (R.chance(dt * 0.5)) this.orbitDir *= -1;
          break;
        }
        case 'sentinel': {
          const want = 280;
          const k = dP > want + 70 ? 1 : dP < want - 90 ? -0.6 : 0;
          mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
          this.tryFire(a, dt, toP);
          break;
        }
        case 'splitter': {
          const want = 260;
          const k = dP > want ? 1 : -0.5;
          mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
          mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.4;
          mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.4;
          this.tryFire(a, dt, toP);
          break;
        }
        case 'bomber': {
          mvx = Math.cos(toP); mvy = Math.sin(toP);
          spd *= 1.15;
          if (dP < 105 || this.fuse > 0) {
            this.fuse += dt;
            if (this.fuse > (this.def.fuse || 1.5)) { this.detonate(a); return; }
            if (R.chance(0.45)) A.play('telegraph');
            spd *= 0.35;
          }
          break;
        }
        case 'summoner': {
          const want = 340;
          const k = dP < want ? -1 : 0.6;
          mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
          mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.6;
          mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.6;
          this.fireCd -= dt;
          if (this.fireCd <= 0 && this.spawnT <= 0) {
            this.fireCd = this.def.summonCd || 5;
            this.summoned = this.summoned.filter(e => e.alive);
            if (this.summoned.length < (this.def.summonMax || 3) && a.enemies.length < 22) {
              const ang = R.range(0, U.TAU);
              const c = a.spawnEnemy(this.def.summonId || 'husk', this.x + Math.cos(ang) * 46, this.y + Math.sin(ang) * 46, { scale: 0.85 });
              if (c) { c.isSpawn = true; this.summoned.push(c); }
              A.play('orb_spawn');
              FX.ring({ x: this.x, y: this.y, r: 10, rEnd: 80, life: 0.5, color: this.color, w: 3 });
            }
          }
          break;
        }
        case 'lancer': {
          if (this.state === 'idle') {
            const want = 300;
            const k = dP > want ? 1 : -0.4;
            mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
            mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.5;
            mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.5;
            if (this.stateT > R.range(1.8, 3.2) && dP < 460 && this.spawnT <= 0) {
              this.state = 'wind'; this.stateT = 0; this.lockAngle = toP;
              A.play('telegraph');
            }
          } else if (this.state === 'wind') {
            spd = 0;
            this.lockAngle = U.angLerp(this.lockAngle, toP, Math.min(1, 3 * dt));
            if (this.stateT > 0.62) {
              this.state = 'dash'; this.stateT = 0;
              this.vx = Math.cos(this.lockAngle) * (this.def.dashSpeed || 780);
              this.vy = Math.sin(this.lockAngle) * (this.def.dashSpeed || 780);
              A.play('dash');
            }
            /* telegraph line */
            if (R.chance(0.6)) {
              FX.particle({
                x: this.x + Math.cos(this.lockAngle) * R.range(30, 400),
                y: this.y + Math.sin(this.lockAngle) * R.range(30, 400),
                vx: 0, vy: 0, life: 0.14, r: 2.2, color: this.color, glow: 0.8
              });
            }
          } else if (this.state === 'dash') {
            this.vx *= Math.pow(0.965, dt * 60);
            this.vy *= Math.pow(0.965, dt * 60);
            if (R.chance(0.85)) {
              FX.particle({
                x: this.x, y: this.y, vx: R.spread(40), vy: R.spread(40),
                life: 0.3, r: R.range(2, 5), color: this.color, drag: 0.9
              });
            }
            if (this.stateT > 0.55 || Math.hypot(this.vx, this.vy) < 120) { this.state = 'idle'; this.stateT = 0; }
            this.x += this.vx * dt; this.y += this.vy * dt;
            this.clampBounds(a);
            this.facing = U.angLerp(this.facing, Math.atan2(this.vy, this.vx), Math.min(1, 10 * dt));
            this.parryScan(a, dt);
            return;
          }
          break;
        }
      }

      /* separation from other enemies */
      let sx = 0, sy = 0;
      for (const e of a.enemies) {
        if (e === this || !e.alive) continue;
        const dd = U.dist2(this.x, this.y, e.x, e.y);
        const rad = (this.r + e.r) * 1.15;
        if (dd < rad * rad && dd > 0.01) {
          const d = Math.sqrt(dd);
          sx += (this.x - e.x) / d * (1 - d / rad);
          sy += (this.y - e.y) / d * (1 - d / rad);
        }
      }
      mvx += sx * 1.9; mvy += sy * 1.9;

      /* gravity well pull */
      for (const g of a.wells) {
        const d = U.dist(this.x, this.y, g.x, g.y);
        if (d < g.r && d > 1) {
          const pull = (1 - d / g.r) * 1.7;
          mvx += (g.x - this.x) / d * pull;
          mvy += (g.y - this.y) / d * pull;
        }
      }

      const m = Math.hypot(mvx, mvy);
      if (m > 0.001) { mvx /= m; mvy /= m; }
      this.vx = U.approach(this.vx, mvx * spd, dt, 0.18);
      this.vy = U.approach(this.vy, mvy * spd, dt, 0.18);

      /* knockback */
      this.x += (this.vx + this.knock.x) * dt;
      this.y += (this.vy + this.knock.y) * dt;
      this.knock.x *= Math.pow(0.86, dt * 60);
      this.knock.y *= Math.pow(0.86, dt * 60);

      this.clampBounds(a);

      /* facing: sentinels face the player (shield), others face movement */
      if (this.def.shieldArc) this.facing = U.angLerp(this.facing, toP, Math.min(1, 3.2 * dt));
      else if (m > 0.01) this.facing = U.angLerp(this.facing, Math.atan2(mvy, mvx), Math.min(1, 8 * dt));

      this.parryScan(a, dt);
    }

    clampBounds(a) {
      const b = a.bounds;
      this.x = U.clamp(this.x, b.x + this.r, b.x + b.w - this.r);
      this.y = U.clamp(this.y, b.y + this.r, b.y + b.h - this.r);
    }

    tryFire(a, dt, toP) {
      if (this.spawnT > 0 || this.stunT > 0) return;
      this.fireCd -= dt;
      if (this.fireCd > 0) return;
      this.fireCd = (this.def.fireCd || 3) * R.range(0.82, 1.2);
      const n = this.def.orbCount || 1;
      let aim = toP;
      if (this.blindT > 0) aim += R.spread(1.4);
      /* lead the player slightly */
      const pd = U.dist(this.x, this.y, a.player.x, a.player.y);
      const lead = pd / (this.orbSpeed || 340);
      aim = U.angTo(this.x, this.y, a.player.x + a.player.vx * lead * 0.45, a.player.y + a.player.vy * lead * 0.45);
      if (this.blindT > 0) aim += R.spread(1.4);

      A.play('orb_spawn');
      FX.ring({ x: this.x, y: this.y, r: 6, rEnd: 40, life: 0.3, color: this.color, w: 2.5 });
      for (let i = 0; i < n; i++) {
        const off = n > 1 ? (i - (n - 1) / 2) * 0.22 : 0;
        a.spawnOrb({
          x: this.x + Math.cos(aim + off) * (this.r + 8),
          y: this.y + Math.sin(aim + off) * (this.r + 8),
          angle: aim + off, speed: this.orbSpeed,
          owner: 'enemy', damage: this.orbPower,
          r: 11, color: this.color, source: this,
          splits: this.def.splits ? 2 : 0,
          grace: 0.1,
        });
      }
    }

    detonate(a) {
      const d = this.def;
      A.play('enemy_die');
      A.duck(0.3, 0.3);
      FX.ring({ x: this.x, y: this.y, r: 10, rEnd: d.blastR || 130, life: 0.42, color: this.color, w: 6 });
      FX.ring({ x: this.x, y: this.y, r: 10, rEnd: (d.blastR || 130) * 0.7, life: 0.3, color: '#ffffff', w: 3 });
      FX.burst(this.x, this.y, 40, { color: this.color, color2: '#ffffff', speedMin: 100, speedMax: 620, lifeMax: 0.8, rMax: 5 });
      FX.shake(13); FX.stop(0.05);
      const dp = U.dist(this.x, this.y, a.player.x, a.player.y);
      if (dp < (d.blastR || 130) + a.player.r) a.damagePlayer((d.blastDmg || 32) * a.dmgMult, 'blast');
      for (const e of a.enemies) {
        if (e === this || !e.alive) continue;
        if (U.dist(this.x, this.y, e.x, e.y) < (d.blastR || 130)) a.hitEnemy(e, 24, { source: 'blast', noHooks: true });
      }
      this.alive = false;
      a.onEnemyDied(this, true);
    }

    /* decide whether this enemy will return incoming player orbs */
    parryScan(a, dt) {
      if (!this.parry) return;
      const react = this.parry.react;
      for (const o of a.orbs) {
        if (!o.alive || o.owner !== 'player' || o.noParry) continue;
        const d = U.dist(this.x, this.y, o.x, o.y);
        const detect = this.r + 60 + o.speed * react * 0.55;
        if (d > detect) continue;
        if (!o.judged.has(this.uid)) {
          o.judged.add(this.uid);
          let skill = this.parry.skill;
          if (this.blindT > 0 || this.stunT > 0) skill = 0;
          if (this.parryCd > 0) skill *= 0.25;
          /* very fast orbs are harder for them too */
          skill *= U.clamp(1.25 - o.volley * 0.035, 0.35, 1.1);
          if (Math.random() < skill) { o.willParryBy = this.uid; this.parryIntent = o.id; this.parryFlash = 1; }
        }
        if (o.willParryBy === this.uid && d < this.r + 46) {
          a.enemyParry(this, o);
        }
      }
    }

    draw(ctx, a) {
      const spawn = this.spawnT > 0 ? 1 - this.spawnT / 0.55 : 1;
      const s = U.ease.outBack(U.clamp(spawn, 0, 1)) * (1 + this.hitFlashScale * 0.18);
      if (s <= 0.02) return;
      const bob = Math.sin(this.bobPhase) * 1.8;
      const x = this.x, y = this.y + bob;
      const col = this.hurtFlash > 0.02 ? U.mixHex(this.color, '#ffffff', this.hurtFlash) : this.color;

      /* shadow */
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + this.r * 0.9, this.r * 0.9 * s, this.r * 0.32 * s, 0, 0, U.TAU); ctx.fill();
      ctx.restore();

      /* spawn telegraph */
      if (this.spawnT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba(this.color, 0.7);
        ctx.lineWidth = 2;
        U.poly(ctx, x, y, 6, this.r * (2.6 - spawn * 1.4), null, a.time * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);

      /* glow */
      ctx.globalCompositeOperation = 'lighter';
      FX.glow(ctx, 0, 0, this.r * 3, col, this.elite ? 0.95 : 0.66);
      ctx.globalCompositeOperation = 'source-over';

      /* body */
      ctx.fillStyle = '#0b0a14';
      ctx.strokeStyle = col;
      ctx.lineWidth = this.elite ? 3.4 : 2.4;
      const sides = this.ai === 'mirror' ? 4 : this.ai === 'sentinel' ? 6 : this.ai === 'duelist' ? 3 : this.ai === 'bomber' ? 8 : 5;
      U.poly(ctx, 0, 0, sides, this.r, null, this.facing + (this.ai === 'mirror' ? Math.PI / 4 : 0));
      ctx.fill(); ctx.stroke();

      /* elite crown */
      if (this.elite) {
        ctx.strokeStyle = U.rgba('#ffcf6b', 0.85);
        ctx.lineWidth = 1.6;
        U.poly(ctx, 0, 0, sides, this.r + 7, null, this.facing + a.time * 0.6);
        ctx.stroke();
      }

      /* glyph */
      ctx.fillStyle = col;
      ctx.font = `700 ${Math.round(this.r * 0.95)}px "Rajdhani",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.glyph, 0, 1);

      ctx.restore();

      /* shield arc — gone entirely once shattered */
      if (this.def.shieldArc && !this.shieldBroken) {
        const arc = this.def.shieldArc;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#6be6ff', 0.6);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, this.r + 9, this.facing - arc / 2, this.facing + arc / 2);
        ctx.stroke();
        ctx.strokeStyle = U.rgba('#ffffff', 0.25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, this.r + 13, this.facing - arc / 2, this.facing + arc / 2);
        ctx.stroke();
        /* three pips = the rally needed to punch through */
        for (let i = 0; i < SHIELD_BREAK_VOLLEY; i++) {
          const ang = this.facing + (i - 1) * (arc / 4);
          ctx.fillStyle = U.rgba('#6be6ff', 0.9);
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * (this.r + 9), y + Math.sin(ang) * (this.r + 9), 2.2, 0, U.TAU);
          ctx.fill();
        }
        ctx.restore();
      }

      /* PARRY INTENT — the key readability tell */
      if (this.parryFlash > 0.02 && !a.st.noTelegraph) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const p = this.parryFlash;
        ctx.strokeStyle = U.rgba('#ffffff', p * 0.9);
        ctx.lineWidth = 2 + p * 2;
        ctx.beginPath(); ctx.arc(x, y, this.r + 16 + (1 - p) * 12, 0, U.TAU); ctx.stroke();
        ctx.restore();
      }

      /* blinded */
      if (this.blindT > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = U.rgba('#ffcf6b', 0.5);
        ctx.font = '700 14px "Rajdhani",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', x + R.spread(3), y - this.r - 12);
        ctx.restore();
      }

      /* lancer wind-up line */
      if (this.state === 'wind') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const k = U.clamp(this.stateT / 0.62, 0, 1);
        ctx.strokeStyle = U.rgba(this.color, 0.25 + k * 0.5);
        ctx.lineWidth = 2 + k * 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(this.lockAngle) * 520, y + Math.sin(this.lockAngle) * 520);
        ctx.stroke();
        ctx.restore();
      }

      /* bomber fuse */
      if (this.fuse > 0) {
        const k = U.clamp(this.fuse / (this.def.fuse || 1.5), 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#ff4d5e', 0.35 + 0.5 * Math.abs(Math.sin(this.fuse * 22)));
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, (this.def.blastR || 130) * (0.35 + k * 0.65), 0, U.TAU); ctx.stroke();
        ctx.restore();
      }

      /* health bar for tough enemies */
      if (this.hp < this.maxHp && (this.maxHp > 60 || this.elite)) {
        const w = this.r * 2.3, hgt = 3;
        const bx = x - w / 2, by = y - this.r - 14;
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(bx - 1, by - 1, w + 2, hgt + 2);
        ctx.fillStyle = this.elite ? '#ffcf6b' : '#ff4d5e';
        ctx.fillRect(bx, by, w * U.clamp(this.hp / this.maxHp, 0, 1), hgt);
      }
    }
  }

  /* ============================================================
     BOSS — Enemy with phases and scripted attacks
     ============================================================ */
  class Boss extends Enemy {
    constructor(def, x, y, a, opts) {
      const fake = {
        id: def.id, name: def.name, glyph: def.glyph, color: def.color,
        ai: 'boss', hp: def.hp, r: def.r, speed: def.speed, contact: 18,
        parry: { skill: 0.8, react: 0.24, cd: 0.6 }, xp: 40,
      };
      super(fake, x, y, a, opts);
      this.bdef = def;
      this.isBoss = true;
      this.phase = 1;
      this.maxPhase = def.phases;
      this.actionT = 2.2;
      this.action = null;
      this.actionStep = 0;
      this.spawnT = 1.4;
      this.invuln = 0;
      this.subs = [];
      this.rageT = 0;
      this.pattern = [];
      this.patIdx = 0;
      this.enrage = 0;
      this.tell = 0;
      this.tellName = '';
      this.homeX = x; this.homeY = y;
      this.parry.skill = def.id === 'deadman' ? 0.95 : 0.75;
    }

    phaseThresholds() {
      const n = this.maxPhase;
      const out = [];
      for (let i = 1; i < n; i++) out.push(1 - i / n);
      return out;
    }

    checkPhase(a) {
      const frac = this.hp / this.maxHp;
      const th = this.phaseThresholds();
      const want = 1 + th.filter(t => frac < t).length;
      if (want > this.phase) {
        this.phase = want;
        this.onPhase(a);
      }
    }

    onPhase(a) {
      this.invuln = 1.2;
      this.actionT = 1.4;
      this.action = null;
      A.play('boss_intro');
      A.duck(0.5, 0.8);
      FX.screenFlash(this.color, 0.5);
      FX.shake(20, 3);
      FX.stop(0.16);
      FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: 900, life: 0.8, color: this.color, w: 8 });
      FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: 620, life: 0.6, color: '#ffffff', w: 4 });
      FX.burst(this.x, this.y, 60, { color: this.color, color2: '#ffffff', speedMin: 150, speedMax: 700, lifeMax: 1.1, rMax: 6 });
      a.banner(`PHASE ${U.roman(this.phase)}`, this.color);
      /* clear enemy orbs on phase change so it reads clean */
      for (const o of a.orbs) if (o.owner === 'enemy') o.kill(a);
      this.speed = this.bdef.speed * (1 + (this.phase - 1) * 0.18);
      this.parry.skill = Math.min(0.98, this.parry.skill + 0.06);
    }

    die(a) {
      if (!this.alive) return;
      this.alive = false;
      A.play('boss_die');
      A.duck(0.7, 1.6);
      FX.shake(26, 2);
      FX.stop(0.28);
      FX.slow(1.1, 0.22);
      FX.screenFlash('#ffffff', 0.75);
      for (let i = 0; i < 10; i++) {
        setTimeout(() => {
          FX.ring({ x: this.x + R.spread(70), y: this.y + R.spread(70), r: 6, rEnd: 220, life: 0.6, color: i % 2 ? '#ffffff' : this.color, w: 4 });
          FX.burst(this.x + R.spread(70), this.y + R.spread(70), 24, { color: this.color, color2: '#ffffff', speedMin: 80, speedMax: 460, lifeMax: 1 });
        }, i * 90);
      }
      for (const s of this.subs) if (s.alive) s.die(a);
      a.onEnemyDied(this);
    }

    update(dt, a) {
      if (this.spawnT > 0) { this.spawnT -= dt; this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4); return; }
      this.invuln = Math.max(0, this.invuln - dt);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
      this.hitFlashScale = Math.max(0, this.hitFlashScale - dt * 6);
      this.parryFlash = Math.max(0, this.parryFlash - dt * 3);
      this.parryCd = Math.max(0, this.parryCd - dt);
      this.blindT = Math.max(0, this.blindT - dt);
      this.stunT = Math.max(0, this.stunT - dt);
      this.slowT = Math.max(0, this.slowT - dt);
      this.tell = Math.max(0, this.tell - dt);
      this.bobPhase += dt * 2;
      this.stateT += dt;

      this.checkPhase(a);
      const P = a.player;
      const toP = U.angTo(this.x, this.y, P.x, P.y);
      const dP = U.dist(this.x, this.y, P.x, P.y);

      /* --- action scheduler --- */
      this.actionT -= dt;
      if (!this.action && this.actionT <= 0) this.pickAction(a, dP);
      if (this.action) this.runAction(dt, a, toP, dP);

      /* --- movement --- */
      let mvx = 0, mvy = 0, spd = this.speed;
      if (this.moveMode === 'hold') { spd = 0; }
      else if (this.moveMode === 'charge') { /* handled in action */ }
      else {
        const want = this.bdef.id === 'hollowsun' ? 260 : 330;
        const k = dP < want - 70 ? -1 : dP > want + 90 ? 1 : 0;
        mvx = Math.cos(toP) * k; mvy = Math.sin(toP) * k;
        mvx += Math.cos(toP + Math.PI / 2) * this.orbitDir * 0.75;
        mvy += Math.sin(toP + Math.PI / 2) * this.orbitDir * 0.75;
        if (R.chance(dt * 0.3)) this.orbitDir *= -1;
      }
      if (this.slowT > 0) spd *= 0.6;
      if (this.stunT > 0) spd = 0;

      const m = Math.hypot(mvx, mvy);
      if (m > 0.001) { mvx /= m; mvy /= m; }
      if (this.moveMode !== 'charge') {
        this.vx = U.approach(this.vx, mvx * spd, dt, 0.1);
        this.vy = U.approach(this.vy, mvy * spd, dt, 0.1);
      }
      this.x += (this.vx + this.knock.x) * dt;
      this.y += (this.vy + this.knock.y) * dt;
      this.knock.x *= Math.pow(0.9, dt * 60);
      this.knock.y *= Math.pow(0.9, dt * 60);
      this.clampBounds(a);
      this.facing = U.angLerp(this.facing, toP, Math.min(1, 3 * dt));

      this.parryScan(a, dt);

      /* ambient */
      if (R.chance(0.5)) {
        const ang = R.range(0, U.TAU);
        FX.particle({
          x: this.x + Math.cos(ang) * this.r, y: this.y + Math.sin(ang) * this.r,
          vx: Math.cos(ang) * 30, vy: Math.sin(ang) * 30 - 20,
          life: R.range(0.4, 1), r: R.range(1, 3), color: this.color, drag: 0.94, glow: 0.6
        });
      }
    }

    pickAction(a, dP) {
      const id = this.bdef.id;
      const ph = this.phase;
      let pool;
      if (id === 'gravekeeper') {
        pool = ['volley', 'rain', 'summon'];
        if (ph >= 2) pool.push('sweep', 'volley');
        if (ph >= 3) pool.push('multivolley', 'rain');
      } else if (id === 'twinfang') {
        pool = ['volley', 'charge', 'crossfire'];
        if (ph >= 2) pool.push('multivolley', 'charge');
      } else if (id === 'hollowsun') {
        pool = ['rain', 'spiral', 'volley'];
        if (ph >= 2) pool.push('nova', 'spiral');
        if (ph >= 3) pool.push('multivolley', 'nova');
      } else {
        pool = ['volley', 'mirrorstep', 'multivolley'];
        if (ph >= 2) pool.push('sweep', 'charge');
        if (ph >= 3) pool.push('nova', 'crossfire');
        if (ph >= 4) pool.push('multivolley', 'spiral', 'mirrorstep');
      }
      this.action = R.pick(pool);
      this.actionStep = 0;
      this.stateT = 0;
      this.moveMode = 'normal';
      this.tell = 0.55;
      this.tellName = this.action;
      A.play('telegraph');
    }

    endAction(gap) {
      this.action = null;
      this.moveMode = 'normal';
      this.actionT = (gap != null ? gap : 1.5) * U.map(this.phase, 1, 4, 1.15, 0.68);
    }

    runAction(dt, a, toP, dP) {
      const t = this.stateT;
      const dm = a.dmgMult;
      switch (this.action) {
        case 'volley': {
          if (t > 0.55 && this.actionStep === 0) {
            this.actionStep = 1;
            this.moveMode = 'hold';
            const n = 1 + Math.floor(this.phase / 2);
            for (let i = 0; i < n; i++) {
              const off = (i - (n - 1) / 2) * 0.26;
              a.spawnOrb({
                x: this.x + Math.cos(toP + off) * (this.r + 12),
                y: this.y + Math.sin(toP + off) * (this.r + 12),
                angle: toP + off, speed: 400 + this.phase * 40,
                owner: 'enemy', damage: 26 * dm, r: 15, color: this.color, source: this, grace: 0.12,
              });
            }
            A.play('orb_spawn');
            FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: this.r * 2.6, life: 0.35, color: this.color, w: 4 });
            FX.shake(6);
          }
          if (t > 1.1) this.endAction(1.3);
          break;
        }
        case 'multivolley': {
          this.moveMode = 'hold';
          const times = 3 + this.phase;
          const step = Math.floor((t - 0.5) / 0.28);
          if (t > 0.5 && step > this.actionStep - 1 && this.actionStep < times) {
            this.actionStep++;
            const ang = toP + R.spread(0.22);
            a.spawnOrb({
              x: this.x + Math.cos(ang) * (this.r + 10), y: this.y + Math.sin(ang) * (this.r + 10),
              angle: ang, speed: 460 + this.phase * 40, owner: 'enemy',
              damage: 20 * dm, r: 12, color: this.color, source: this, grace: 0.1,
            });
            A.play('telegraph');
            FX.ring({ x: this.x, y: this.y, r: this.r * 0.8, rEnd: this.r * 1.8, life: 0.22, color: this.color, w: 2 });
          }
          if (this.actionStep >= times && t > 0.5 + times * 0.28 + 0.3) this.endAction(1.5);
          break;
        }
        case 'rain': {
          this.moveMode = 'hold';
          const times = 6 + this.phase * 3;
          const step = Math.floor((t - 0.6) / 0.13);
          if (t > 0.6 && step > this.actionStep - 1 && this.actionStep < times) {
            this.actionStep++;
            const ang = R.range(0, U.TAU);
            a.spawnOrb({
              x: this.x + Math.cos(ang) * (this.r + 6), y: this.y + Math.sin(ang) * (this.r + 6),
              angle: ang, speed: 300 + R.range(0, 160), owner: 'enemy',
              damage: 14 * dm, r: 10, color: this.color, source: this, grace: 0.1, bounces: 3,
            });
          }
          if (this.actionStep >= times && t > 0.6 + times * 0.13 + 0.4) this.endAction(1.6);
          break;
        }
        case 'spiral': {
          this.moveMode = 'hold';
          const times = 22 + this.phase * 8;
          const step = Math.floor((t - 0.5) / 0.055);
          if (t > 0.5 && step > this.actionStep - 1 && this.actionStep < times) {
            this.actionStep++;
            const arms = 2 + Math.floor(this.phase / 2);
            for (let k = 0; k < arms; k++) {
              const ang = this.actionStep * 0.42 + (k / arms) * U.TAU;
              a.spawnOrb({
                x: this.x + Math.cos(ang) * (this.r + 6), y: this.y + Math.sin(ang) * (this.r + 6),
                angle: ang, speed: 250, owner: 'enemy',
                damage: 12 * dm, r: 9, color: this.color, source: this, grace: 0.1, bounces: 2, life: 6,
              });
            }
            if (this.actionStep % 4 === 0) A.play('telegraph');
          }
          if (this.actionStep >= times) this.endAction(1.8);
          break;
        }
        case 'nova': {
          this.moveMode = 'hold';
          if (t < 1.0) {
            if (R.chance(0.7)) {
              const ang = R.range(0, U.TAU);
              const d = 260 * (1 - t);
              FX.particle({
                x: this.x + Math.cos(ang) * d, y: this.y + Math.sin(ang) * d,
                vx: -Math.cos(ang) * 260, vy: -Math.sin(ang) * 260,
                life: 0.4, r: 3, color: '#ffffff', color2: this.color
              });
            }
          } else if (this.actionStep === 0) {
            this.actionStep = 1;
            const n = 14 + this.phase * 4;
            for (let i = 0; i < n; i++) {
              const ang = (i / n) * U.TAU;
              a.spawnOrb({
                x: this.x + Math.cos(ang) * (this.r + 8), y: this.y + Math.sin(ang) * (this.r + 8),
                angle: ang, speed: 330, owner: 'enemy',
                damage: 18 * dm, r: 11, color: this.color, source: this, grace: 0.1, bounces: 2,
              });
            }
            A.play('boss_intro');
            FX.shake(16); FX.stop(0.06);
            FX.ring({ x: this.x, y: this.y, r: 10, rEnd: 420, life: 0.5, color: this.color, w: 6 });
            FX.screenFlash(this.color, 0.28);
          }
          if (t > 1.7) this.endAction(1.7);
          break;
        }
        case 'sweep': {
          this.moveMode = 'hold';
          const times = 26;
          const step = Math.floor((t - 0.6) / 0.05);
          if (t > 0.6 && step > this.actionStep - 1 && this.actionStep < times) {
            this.actionStep++;
            const spread = 1.5;
            const ang = toP - spread / 2 + (this.actionStep / times) * spread;
            a.spawnOrb({
              x: this.x + Math.cos(ang) * (this.r + 6), y: this.y + Math.sin(ang) * (this.r + 6),
              angle: ang, speed: 420, owner: 'enemy',
              damage: 15 * dm, r: 9, color: this.color, source: this, grace: 0.1, bounces: 1,
            });
          }
          if (this.actionStep >= times) this.endAction(1.5);
          break;
        }
        case 'crossfire': {
          this.moveMode = 'hold';
          if (t > 0.7 && this.actionStep === 0) {
            this.actionStep = 1;
            const b = a.bounds;
            for (let i = 0; i < 8; i++) {
              const fromTop = i % 2 === 0;
              const px = fromTop ? b.x + (i / 8) * b.w + R.spread(40) : b.x + 6;
              const py = fromTop ? b.y + 6 : b.y + (i / 8) * b.h;
              const ang = U.angTo(px, py, a.player.x + R.spread(80), a.player.y + R.spread(80));
              a.spawnOrb({
                x: px, y: py, angle: ang, speed: 380, owner: 'enemy',
                damage: 16 * dm, r: 10, color: this.color, source: this, grace: 0.2, bounces: 2,
              });
            }
            A.play('orb_spawn');
            FX.screenFlash(this.color, 0.2);
          }
          if (t > 1.6) this.endAction(1.6);
          break;
        }
        case 'charge': {
          if (t < 0.7) {
            this.moveMode = 'hold';
            this.lockAngle = t < 0.5 ? toP : this.lockAngle;
            if (R.chance(0.8)) {
              FX.particle({
                x: this.x + Math.cos(this.lockAngle) * R.range(40, 560),
                y: this.y + Math.sin(this.lockAngle) * R.range(40, 560),
                vx: 0, vy: 0, life: 0.13, r: 3, color: this.color
              });
            }
          } else if (this.actionStep === 0) {
            this.actionStep = 1;
            this.moveMode = 'charge';
            this.vx = Math.cos(this.lockAngle) * 980;
            this.vy = Math.sin(this.lockAngle) * 980;
            A.play('dash'); FX.shake(10);
          } else {
            this.moveMode = 'charge';
            this.vx *= Math.pow(0.958, dt * 60);
            this.vy *= Math.pow(0.958, dt * 60);
            if (R.chance(0.9)) FX.particle({ x: this.x, y: this.y, vx: R.spread(60), vy: R.spread(60), life: 0.35, r: R.range(3, 7), color: this.color, drag: 0.9 });
            if (t > 1.5) this.endAction(1.4);
          }
          break;
        }
        case 'summon': {
          this.moveMode = 'hold';
          if (t > 0.7 && this.actionStep === 0) {
            this.actionStep = 1;
            const n = 2 + this.phase;
            for (let i = 0; i < n; i++) {
              const ang = (i / n) * U.TAU + R.range(0, 1);
              const d = 130;
              const c = a.spawnEnemy(R.chance(0.5) ? 'husk' : 'caster', this.x + Math.cos(ang) * d, this.y + Math.sin(ang) * d, { scale: 0.9 });
              if (c) c.isSpawn = true;
            }
            A.play('orb_spawn');
            FX.ring({ x: this.x, y: this.y, r: 20, rEnd: 200, life: 0.5, color: this.color, w: 4 });
          }
          if (t > 1.5) this.endAction(1.7);
          break;
        }
        case 'mirrorstep': {
          this.moveMode = 'hold';
          if (t > 0.45 && this.actionStep === 0) {
            this.actionStep = 1;
            const b = a.bounds;
            const ang = U.angTo(a.player.x, a.player.y, this.x, this.y) + Math.PI + R.spread(0.6);
            const nx = U.clamp(a.player.x + Math.cos(ang) * 240, b.x + this.r, b.x + b.w - this.r);
            const ny = U.clamp(a.player.y + Math.sin(ang) * 240, b.y + this.r, b.y + b.h - this.r);
            FX.burst(this.x, this.y, 26, { color: this.color, speedMin: 60, speedMax: 340, lifeMax: 0.6 });
            FX.ring({ x: this.x, y: this.y, r: this.r, rEnd: 10, life: 0.3, color: this.color, w: 4, ease: 'outQuad' });
            this.x = nx; this.y = ny;
            FX.ring({ x: nx, y: ny, r: 8, rEnd: this.r * 3, life: 0.35, color: '#ffffff', w: 3 });
            FX.burst(nx, ny, 26, { color: this.color, speedMin: 60, speedMax: 340, lifeMax: 0.6 });
            A.play('dash');
            const ang2 = U.angTo(nx, ny, a.player.x, a.player.y);
            a.spawnOrb({
              x: nx + Math.cos(ang2) * (this.r + 10), y: ny + Math.sin(ang2) * (this.r + 10),
              angle: ang2, speed: 620, owner: 'enemy', damage: 30 * dm, r: 14,
              color: this.color, source: this, grace: 0.1,
            });
          }
          if (t > 1.1) this.endAction(1.2);
          break;
        }
        default: this.endAction(1.2);
      }
    }

    draw(ctx, a) {
      const spawn = this.spawnT > 0 ? 1 - this.spawnT / 1.4 : 1;
      const s = U.ease.outBack(U.clamp(spawn, 0, 1)) * (1 + this.hitFlashScale * 0.1);
      const bob = Math.sin(this.bobPhase) * 3;
      const x = this.x, y = this.y + bob;
      const col = this.hurtFlash > 0.02 ? U.mixHex(this.color, '#ffffff', this.hurtFlash) : this.color;

      /* ground shadow */
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(this.x, this.y + this.r * 0.85, this.r * s, this.r * 0.32 * s, 0, 0, U.TAU); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.globalCompositeOperation = 'lighter';
      FX.glow(ctx, 0, 0, this.r * 4, col, 0.9);
      ctx.globalCompositeOperation = 'source-over';

      /* rotating outer rings */
      ctx.strokeStyle = U.rgba(col, 0.55);
      ctx.lineWidth = 2;
      U.poly(ctx, 0, 0, 6, this.r * 1.5, null, a.time * 0.45);
      ctx.stroke();
      ctx.strokeStyle = U.rgba(col, 0.3);
      U.poly(ctx, 0, 0, 3, this.r * 1.9, null, -a.time * 0.3);
      ctx.stroke();
      for (let i = 0; i < this.phase; i++) {
        ctx.strokeStyle = U.rgba('#ffffff', 0.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, this.r * (1.2 + i * 0.22), a.time * (i % 2 ? 1 : -1), a.time * (i % 2 ? 1 : -1) + 2.2); ctx.stroke();
      }

      /* body */
      ctx.fillStyle = '#0a0912';
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      U.poly(ctx, 0, 0, 8, this.r, this.r * 0.72, this.facing + a.time * 0.12);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = col;
      ctx.font = `700 ${Math.round(this.r * 0.95)}px "Rajdhani",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.glyph, 0, 2);

      if (this.invuln > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#ffffff', 0.5 + 0.4 * Math.sin(a.time * 26));
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, this.r * 1.25, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();

      /* parry intent */
      if (this.parryFlash > 0.02 && !a.st.noTelegraph) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#ffffff', this.parryFlash * 0.9);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, this.r + 22 + (1 - this.parryFlash) * 14, 0, U.TAU); ctx.stroke();
        ctx.restore();
      }

      /* charge telegraph */
      if (this.action === 'charge' && this.actionStep === 0 && this.stateT > 0.1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const k = U.clamp(this.stateT / 0.7, 0, 1);
        ctx.strokeStyle = U.rgba(this.color, 0.2 + k * 0.45);
        ctx.lineWidth = 4 + k * 10;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(this.lockAngle || 0) * 900, y + Math.sin(this.lockAngle || 0) * 900);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ============================================================
     DECOY (Afterimage technique)
     ============================================================ */
  class Decoy {
    constructor(x, y, life, color) {
      this.x = x; this.y = y; this.r = 15; this.alive = true;
      this.life = life; this.max = life; this.color = color;
    }
    update(dt, a) {
      this.life -= dt;
      if (R.chance(0.4)) FX.particle({ x: this.x + R.spread(12), y: this.y + R.spread(12), vx: 0, vy: -30, life: 0.4, r: 2, color: this.color });
      if (this.life <= 0) this.pop(a);
    }
    pop(a) {
      if (!this.alive) return;
      this.alive = false;
      FX.ring({ x: this.x, y: this.y, r: 8, rEnd: 170, life: 0.4, color: this.color, w: 4 });
      FX.burst(this.x, this.y, 26, { color: this.color, speedMin: 80, speedMax: 400, lifeMax: 0.6 });
      A.play('enemy_hit', true); FX.shake(7);
      for (const e of a.enemies) {
        if (e.alive && U.dist(this.x, this.y, e.x, e.y) < 170) a.hitEnemy(e, 40 * a.st.power, { source: 'decoy' });
      }
      for (const o of a.orbs) {
        if (o.alive && o.owner === 'enemy' && U.dist(this.x, this.y, o.x, o.y) < 170) o.kill(a);
      }
    }
    draw(ctx, a) {
      const k = this.life / this.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(a.time * 10);
      FX.glow(ctx, this.x, this.y, 44, this.color, 1);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = this.color; ctx.lineWidth = 2;
      U.rr(ctx, this.x - 11, this.y - 11, 22, 22, 3); ctx.stroke();
      ctx.beginPath(); ctx.arc(this.x, this.y, 26 * (1 - k) + 14, 0, U.TAU); ctx.stroke();
      ctx.restore();
    }
  }

  /* ============================================================
     PICKUP (shards / hearts)
     ============================================================ */
  class Pickup {
    constructor(x, y, kind, value) {
      this.x = x; this.y = y;
      this.vx = R.spread(150); this.vy = R.spread(150);
      this.kind = kind; this.value = value;
      this.alive = true; this.age = 0; this.r = kind === 'heart' ? 9 : 6;
      this.color = kind === 'heart' ? '#ff4d5e' : '#ffcf6b';
      this.magnetized = false;
    }
    update(dt, a) {
      this.age += dt;
      const p = a.player;
      const d = U.dist(this.x, this.y, p.x, p.y);
      const mag = a.st.magnet * (a.st.magnetMult || 1);
      if (d < mag || this.magnetized) {
        this.magnetized = true;
        const ang = U.angTo(this.x, this.y, p.x, p.y);
        const pull = 900 * dt;
        this.vx += Math.cos(ang) * pull;
        this.vy += Math.sin(ang) * pull;
      }
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.vx *= Math.pow(0.9, dt * 60); this.vy *= Math.pow(0.9, dt * 60);
      const b = a.bounds;
      this.x = U.clamp(this.x, b.x + 4, b.x + b.w - 4);
      this.y = U.clamp(this.y, b.y + 4, b.y + b.h - 4);
      if (d < p.r + this.r + 4) this.collect(a);
      if (this.age > 30) this.alive = false;
    }
    collect(a) {
      this.alive = false;
      if (this.kind === 'heart') { a.healPlayer(this.value); A.play('heal'); }
      else { a.addShards(this.value); A.play('shards'); }
      FX.burst(this.x, this.y, 8, { color: this.color, speedMin: 30, speedMax: 140, lifeMax: 0.4, rMax: 2.5 });
    }
    draw(ctx, a) {
      const bob = Math.sin(a.time * 5 + this.x * 0.05) * 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      FX.glow(ctx, this.x, this.y + bob, this.r * 3.5, this.color, 1);
      ctx.fillStyle = '#fff';
      if (this.kind === 'heart') {
        ctx.beginPath(); ctx.arc(this.x, this.y + bob, this.r * 0.55, 0, U.TAU); ctx.fill();
      } else {
        U.poly(ctx, this.x, this.y + bob, 4, this.r * 0.9, this.r * 0.4, a.time * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  DV.Orb = Orb;
  DV.Player = Player;
  DV.Enemy = Enemy;
  DV.Boss = Boss;
  DV.Decoy = Decoy;
  DV.Pickup = Pickup;
})();
