/* ============================================================
   DEADMAN VOLLEY — touch.js
   Mobile controls: pointer handling, on-screen HUD, lock-on aim.

   Self-contained. It feeds DV.Input (which delegates to it) and draws
   itself after the arena, so arena.js and entities.js need no changes.

   Scheme:
     left  ~45%  floating move stick
     right side  TAP ANYWHERE = PARRY   (the biggest possible target for
                 the most timing-critical action)
                 DRAG = aim manually    (a drag never fires a parry)
                 TAP on empty space = cycle the lock target
     buttons     FIRE (hold to charge) · DASH · TECH1 · TECH2 · PAUSE
   ============================================================ */
DV.Touch = (function () {
  const U = DV.U, FX = DV.FX;

  let Game = null;
  let enabled = false;

  /* a drag beyond this many stage px stops counting as a tap */
  const TAP_SLOP = 26;
  /* ...and a tap must be released within this long */
  const TAP_TIME = 0.42;

  const pointers = new Map();   // pointerId -> tracked pointer
  let stick = null;             // the pointer currently driving movement
  let aimPointer = null;        // the pointer currently dragging aim

  /* edge-triggered, consumed once per frame by DV.Input */
  const hit = { parry: false, dash: false, tech1: false, tech2: false, pause: false, cycle: false };
  const held = { fire: false };

  let manualAim = null;         // radians, or null while auto-locked
  let lockTarget = null;
  let lockFlash = 0;

  /* ---------------------------------------------------------------
     Layout — everything in stage units so it scales with the game.
     Rebuilt whenever the stage changes.
     --------------------------------------------------------------- */
  let L = null;

  function layout() {
    const W = DV.STAGE.w, H = DV.STAGE.h;
    const portrait = DV.STAGE.portrait;
    const s = (Game && Game.settings && Game.settings.ctrlScale) || 1;
    const lefty = !!(Game && Game.settings && Game.settings.lefty);

    /* The band must match the arena's bottom inset in arena.js/computeBounds,
       or the buttons end up drawn on top of the playfield. */
    const band = portrait ? 310 : 160;
    /* mirrored for left-handed players: `sgn` walks the cluster inward */
    const sgn = lefty ? 1 : -1;
    const ax = (d) => (lefty ? d : W - d);       // anchor x, d = inset from the edge

    /* Portrait has depth to stack into; landscape only has a thin strip, so the
       buttons lay out as a row instead. Every pair is checked for clearance. */
    const P = portrait
      ? {
        parry: { x: ax(104), y: H - 108, r: 78 },
        fire: { x: ax(250), y: H - 128, r: 54 },
        dash: { x: ax(104), y: H - 252, r: 40 },
        tech: [{ x: ax(232), y: H - 262, r: 34 }, { x: ax(350), y: H - 232, r: 34 }],
      }
      : {
        parry: { x: ax(100), y: H - 80, r: 64 },
        fire: { x: ax(222), y: H - 80, r: 46 },
        dash: { x: ax(330), y: H - 72, r: 38 },
        tech: [{ x: ax(424), y: H - 66, r: 32 }, { x: ax(506), y: H - 66, r: 32 }],
      };
    const scaleC = (c) => ({ x: c.x, y: c.y, r: c.r * s });

    L = {
      W, H, portrait, lefty, band, sgn,
      splitX: W * 0.46,                          // left of this = movement
      stickR: (portrait ? 96 : 84) * s,
      stickKnob: (portrait ? 40 : 34) * s,
      parry: scaleC(P.parry),
      fire: scaleC(P.fire),
      dash: scaleC(P.dash),
      tech: P.tech.map(scaleC),
      /* top-left, clear of the HP bar (which arena.js shifts right on touch) */
      pause: { x: lefty ? W - 44 : 44, y: 36, r: 24 },
    };
    return L;
  }
  DV.onStage(() => { if (enabled) layout(); });

  function buttons() {
    const out = [L.parry, L.fire, L.dash, L.pause];
    const n = techCount();
    for (let i = 0; i < n; i++) out.push(L.tech[i]);
    return out;
  }
  function techCount() {
    const a = Game && Game.arena;
    return a && a.player ? Math.min(2, a.player.techs.length) : 0;
  }
  function inCircle(x, y, c, pad) {
    return U.dist(x, y, c.x, c.y) <= c.r + (pad || 0);
  }

  /* ---------------------------------------------------------------
     Pointer plumbing
     --------------------------------------------------------------- */
  function toStage(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * DV.STAGE.w,
      y: ((e.clientY - r.top) / r.height) * DV.STAGE.h,
    };
  }

  function init(game) {
    Game = game;
    enabled = true;
    layout();
    const cv = game.canvas;

    cv.style.touchAction = 'none';

    cv.addEventListener('pointerdown', (e) => {
      if (!active()) return;
      /* Capture keeps events flowing if a finger slides off the canvas, but it
         throws for a pointer the UA does not consider active. It is a
         nicety — it must never be able to take the whole input path down. */
      try { cv.setPointerCapture && cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      const p = toStage(e, cv);
      const t = {
        id: e.pointerId, x: p.x, y: p.y, x0: p.x, y0: p.y,
        t0: performance.now() / 1000, moved: false, role: null,
      };

      /* explicit buttons win over everything */
      if (inCircle(p.x, p.y, L.pause, 8)) { t.role = 'pause'; hit.pause = true; }
      else if (inCircle(p.x, p.y, L.fire, 10)) { t.role = 'fire'; held.fire = true; }
      else if (inCircle(p.x, p.y, L.dash, 10)) { t.role = 'dash'; hit.dash = true; }
      else if (techCount() > 0 && inCircle(p.x, p.y, L.tech[0], 8)) { t.role = 'tech1'; hit.tech1 = true; }
      else if (techCount() > 1 && inCircle(p.x, p.y, L.tech[1], 8)) { t.role = 'tech2'; hit.tech2 = true; }
      else if (isMoveSide(p.x)) {
        /* floating stick: the base lands wherever the thumb does */
        t.role = 'stick';
        t.baseX = p.x; t.baseY = p.y;
        stick = t;
      } else {
        /* the whole action side is a parry surface until it becomes a drag */
        t.role = 'act';
      }
      pointers.set(e.pointerId, t);
      e.preventDefault();
    }, { passive: false });

    cv.addEventListener('pointermove', (e) => {
      const t = pointers.get(e.pointerId);
      if (!t) return;
      const p = toStage(e, cv);
      t.x = p.x; t.y = p.y;
      if (!t.moved && U.dist(p.x, p.y, t.x0, t.y0) > TAP_SLOP) t.moved = true;

      if (t.role === 'act' && t.moved) {
        /* became a drag -> manual aim, and it can no longer fire a parry */
        t.role = 'aim';
        aimPointer = t;
      }
      if (t.role === 'aim') updateManualAim(t);
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      try { cv.releasePointerCapture && cv.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
      const t = pointers.get(e.pointerId);
      if (!t) return;
      pointers.delete(e.pointerId);
      const dur = performance.now() / 1000 - t.t0;

      if (t.role === 'stick' && stick === t) stick = null;
      if (t.role === 'fire') held.fire = false;
      if (t.role === 'aim' && aimPointer === t) aimPointer = null;

      /* a clean tap on the action side is a PARRY */
      if (t.role === 'act' && !t.moved && dur < TAP_TIME) {
        if (nearTarget(t.x, t.y)) hit.cycle = true;   /* tapped an enemy -> lock it */
        else hit.parry = true;
      }
      e.preventDefault();
    };
    cv.addEventListener('pointerup', release, { passive: false });
    cv.addEventListener('pointercancel', release, { passive: false });

    /* never let the page itself scroll, bounce or zoom under a thumb */
    const swallow = (e) => { if (active()) e.preventDefault(); };
    document.addEventListener('gesturestart', swallow, { passive: false });
    document.addEventListener('dblclick', swallow, { passive: false });
  }

  function isMoveSide(x) {
    return L.lefty ? x > DV.STAGE.w - L.splitX : x < L.splitX;
  }

  /* only steer while actually in a fight */
  function active() {
    return enabled && Game && Game.mode === 'game' && Game.arena && !Game.paused;
  }

  function updateManualAim(t) {
    const a = Game.arena;
    if (!a || !a.player) return;
    const dx = t.x - t.x0, dy = t.y - t.y0;
    if (Math.hypot(dx, dy) < 6) return;
    manualAim = Math.atan2(dy, dx);
    /* dragging also re-picks the enemy closest to that heading */
    const e = enemyToward(manualAim);
    if (e) lockTarget = e;
  }

  /* ---------------------------------------------------------------
     Targeting
     --------------------------------------------------------------- */
  function livingEnemies() {
    const a = Game && Game.arena;
    if (!a) return [];
    return a.enemies.filter(e => e.alive && e.spawnT <= 0);
  }

  function nearTarget(x, y) {
    for (const e of livingEnemies()) if (U.dist(x, y, e.x, e.y) < e.r + 34) return (lockTarget = e, true);
    return false;
  }

  function enemyToward(ang) {
    const a = Game.arena, p = a.player;
    let best = null, bs = Infinity;
    for (const e of livingEnemies()) {
      const diff = Math.abs(U.angDiff(ang, U.angTo(p.x, p.y, e.x, e.y)));
      const sc = diff * 300 + U.dist(p.x, p.y, e.x, e.y) * 0.25;
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }

  function cycleTarget() {
    const list = livingEnemies();
    if (!list.length) { lockTarget = null; return; }
    const i = list.indexOf(lockTarget);
    lockTarget = list[(i + 1) % list.length];
    lockFlash = 1;
    manualAim = null;
    DV.Audio.play('ui_move');
  }

  /* keep the lock sane: drop dead targets, default to the nearest */
  function refreshLock() {
    const a = Game.arena, p = a.player;
    if (lockTarget && (!lockTarget.alive || lockTarget.spawnT > 0)) lockTarget = null;
    if (!lockTarget) {
      let best = null, bd = Infinity;
      for (const e of livingEnemies()) {
        const d = U.dist2(p.x, p.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      lockTarget = best;
    }
  }

  /* ---------------------------------------------------------------
     Queried by DV.Input
     --------------------------------------------------------------- */
  function moveVec() {
    if (!active() || !stick) return null;
    const dx = stick.x - stick.baseX, dy = stick.y - stick.baseY;
    const m = Math.hypot(dx, dy);
    if (m < 8) return { x: 0, y: 0, mag: 0 };
    const k = Math.min(1, m / L.stickR);
    return { x: (dx / m) * k, y: (dy / m) * k, mag: k };
  }

  function aimAngle(x, y) {
    if (!active()) return null;
    if (hit.cycle) { hit.cycle = false; cycleTarget(); }
    refreshLock();
    if (aimPointer && manualAim != null) return manualAim;
    if (lockTarget) return U.angTo(x, y, lockTarget.x, lockTarget.y);
    return manualAim;
  }

  function parryHit() { return hit.parry; }
  function fireDown() { return held.fire; }
  function actHit(name) {
    if (name === 'dash') return hit.dash;
    if (name === 'tech1') return hit.tech1;
    if (name === 'tech2') return hit.tech2;
    if (name === 'pause') return hit.pause;
    return false;
  }

  function endFrame() {
    hit.parry = hit.dash = hit.tech1 = hit.tech2 = hit.pause = false;
  }

  function clearAll() {
    pointers.clear();
    stick = null; aimPointer = null; manualAim = null;
    held.fire = false;
    endFrame();
  }

  /* ---------------------------------------------------------------
     Rendering
     --------------------------------------------------------------- */
  function ringButton(ctx, c, color, label, glyph, opts) {
    opts = opts || {};
    const a = opts.alpha == null ? 1 : opts.alpha;
    ctx.save();
    ctx.globalAlpha = a * (opts.pressed ? 1 : 0.82);

    ctx.fillStyle = 'rgba(8,7,16,.55)';
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, U.TAU); ctx.fill();

    if (opts.pressed) {
      ctx.globalCompositeOperation = 'lighter';
      FX.glow(ctx, c.x, c.y, c.r * 1.7, color, 0.55);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = U.rgba(color, opts.pressed ? 1 : 0.75);
    ctx.lineWidth = opts.pressed ? 4 : 2.5;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, U.TAU); ctx.stroke();

    /* cooldown / charge sweep */
    if (opts.fill > 0) {
      ctx.strokeStyle = U.rgba(color, 0.9);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r - 5, -Math.PI / 2, -Math.PI / 2 + U.TAU * U.clamp(opts.fill, 0, 1));
      ctx.stroke();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (glyph) {
      ctx.fillStyle = U.rgba(color, opts.dim ? 0.4 : 1);
      ctx.font = `700 ${Math.round(c.r * 0.75)}px "Rajdhani",sans-serif`;
      ctx.fillText(glyph, c.x, c.y - (label ? c.r * 0.1 : 0));
    }
    if (label) {
      ctx.fillStyle = U.rgba(color, 0.85);
      ctx.font = `700 ${Math.round(c.r * 0.3)}px "Rajdhani",sans-serif`;
      ctx.fillText(label, c.x, c.y + c.r * 0.5);
    }
    ctx.restore();
  }

  function draw(ctx, arena) {
    if (!enabled || !L || !arena || !arena.player) return;
    const p = arena.player, st = arena.st;
    const time = arena.time;
    lockFlash = Math.max(0, lockFlash - 0.03);

    /* ---- lock reticle: where a parry will send the orb ---- */
    if (lockTarget && lockTarget.alive) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + 0.3 * Math.sin(time * 6) + lockFlash * 0.5;
      ctx.strokeStyle = U.rgba('#ffcf6b', pulse);
      ctx.lineWidth = 2;
      const rr = lockTarget.r + 16 + lockFlash * 12;
      /* corner brackets read better than a full ring against busy VFX */
      for (let i = 0; i < 4; i++) {
        const a0 = i * (U.TAU / 4) + time * 0.4;
        ctx.beginPath();
        ctx.arc(lockTarget.x, lockTarget.y, rr, a0, a0 + 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.22;
      ctx.setLineDash([5, 9]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(lockTarget.x, lockTarget.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* ---- movement stick ---- */
    if (stick) {
      const dx = stick.x - stick.baseX, dy = stick.y - stick.baseY;
      const m = Math.hypot(dx, dy);
      const k = m > 0 ? Math.min(1, m / L.stickR) : 0;
      const kx = stick.baseX + (m ? dx / m : 0) * L.stickR * k;
      const ky = stick.baseY + (m ? dy / m : 0) * L.stickR * k;
      ctx.save();
      ctx.strokeStyle = 'rgba(233,230,242,.28)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(stick.baseX, stick.baseY, L.stickR, 0, U.TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      FX.glow(ctx, kx, ky, L.stickKnob * 2.2, p.color, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(10,9,18,.7)';
      ctx.beginPath(); ctx.arc(kx, ky, L.stickKnob, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = U.rgba(p.color, 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(kx, ky, L.stickKnob, 0, U.TAU); ctx.stroke();
      ctx.restore();
    } else {
      /* resting hint so the zone is discoverable */
      const hx = L.lefty ? L.W - L.splitX * 0.5 : L.splitX * 0.5;
      const hy = L.H - L.band * 0.52;
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#e9e6f2';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.arc(hx, hy, L.stickR * 0.72, 0, U.TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.font = '700 15px "Rajdhani",sans-serif';
      ctx.fillStyle = '#e9e6f2';
      ctx.fillText('MOVE', hx, hy + 4);
      ctx.restore();
    }

    /* ---- PARRY: the whole action side is live, the ring is the affordance ---- */
    const parryReady = p.parryCd <= 0 && p.whiff <= 0;
    const parryCol = p.whiff > 0 ? '#ff4d5e' : p.parryT > 0 ? '#ffffff' : parryReady ? '#ffcf6b' : '#6b6488';
    const cdFill = p.whiff > 0
      ? 1 - U.clamp(p.whiff / (st.parryWhiffLock * (st.whiffMult || 1)), 0, 1)
      : p.parryCd > 0
        ? 1 - U.clamp(p.parryCd / (st.parryCooldown * (st.parryCooldownMult || 1)), 0, 1)
        : 0;
    ringButton(ctx, L.parry, parryCol, 'PARRY', '◎', {
      pressed: p.parryT > 0, fill: cdFill, dim: !parryReady,
    });

    /* ---- FIRE, with the perfect-release beat drawn on the ring ---- */
    const chargeCol = p.charge >= 1 ? '#ffffff' : p.color;
    ringButton(ctx, L.fire, chargeCol, 'FIRE', '✦', {
      pressed: held.fire, fill: p.charge,
    });
    if (p.charge >= 1 && p.chargeFullT >= 0) {
      const since = time - p.chargeFullT;
      if (since <= 0.18) {
        const k = U.clamp(since / 0.18, 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = U.rgba('#ffffff', 0.95 - k * 0.3);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(L.fire.x, L.fire.y, L.fire.r + 16 * (1 - k), 0, U.TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* ---- DASH ---- */
    const dashReady = p.dashCharges > 0 && !st.noDash;
    ringButton(ctx, L.dash, dashReady ? '#6be6ff' : '#6b6488', 'DASH', '»', {
      dim: !dashReady,
      fill: dashReady ? 0 : 1 - U.clamp(p.dashCd / (st.dashCooldown * (st.dashCooldownMult || 1)), 0, 1),
    });
    if (st.dashCharges > 1) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '700 13px "Rajdhani",sans-serif';
      ctx.fillStyle = U.rgba('#6be6ff', 0.9);
      ctx.fillText('×' + p.dashCharges, L.dash.x, L.dash.y - L.dash.r - 9);
      ctx.restore();
    }

    /* ---- techniques ---- */
    const C = DV.Content;
    for (let i = 0; i < techCount(); i++) {
      const t = C.TECH_MAP[p.techs[i]];
      if (!t) continue;
      const cd = p.techCd[i];
      const cdMax = t.cd * (st.techCdMult || 1);
      const cost = t.cost * (st.techCostMult || 1);
      const ready = cd <= 0 && p.ki >= cost;
      ringButton(ctx, L.tech[i], ready ? t.color : '#6b6488', null, t.glyph, {
        dim: !ready, fill: cd > 0 ? 1 - U.clamp(cd / cdMax, 0, 1) : 0,
      });
    }

    /* ---- pause ---- */
    ringButton(ctx, L.pause, '#9a95b4', null, '⏸', { alpha: 0.7 });
  }

  return {
    init, draw, endFrame, clearAll, layout,
    moveVec, aimAngle, parryHit, fireDown, actHit,
    isActive: active,
    get enabled() { return enabled; },
    get lockTarget() { return lockTarget; },
    get layoutBox() { return L; },
  };
})();
