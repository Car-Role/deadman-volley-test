/* ============================================================
   DEADMAN VOLLEY — fx.js
   Particles, shockwaves, floating text, screen shake, hitstop,
   slow-motion, flashes, camera. All pooled where it matters.
   ============================================================ */
DV.FX = (function () {
  const U = DV.U, R = U.rnd;

  /* ---------------- camera / screen state ---------------- */
  const cam = { x: 0, y: 0, shake: 0, shakeDecay: 5.5, rot: 0, zoom: 1, zoomTarget: 1, ox: 0, oy: 0 };
  let hitstop = 0;
  let slowmo = 0, slowmoScale = 0.32;
  let flash = { a: 0, color: '#ffffff', decay: 4 };
  let vignettePulse = 0, vignetteColor = '#ff4d5e';
  let chroma = 0;

  let settings = { shake: 1, particles: 1, flashes: 1 };
  function setSettings(s) { settings = s; }

  /* ---------------- pools ---------------- */
  const parts = [];
  const rings = [];
  const texts = [];
  const streaks = [];
  const MAX_PARTS = 1400;

  function reset() {
    parts.length = 0; rings.length = 0; texts.length = 0; streaks.length = 0;
    cam.shake = 0; cam.rot = 0; cam.zoom = cam.zoomTarget = 1; cam.ox = cam.oy = 0;
    hitstop = 0; slowmo = 0; flash.a = 0; vignettePulse = 0; chroma = 0;
  }

  /* ---------------- emitters ---------------- */
  function particle(o) {
    if (settings.particles <= 0) return;
    if (parts.length >= MAX_PARTS) parts.splice(0, 64);
    parts.push({
      x: o.x, y: o.y,
      vx: o.vx || 0, vy: o.vy || 0,
      life: o.life || 0.5, max: o.life || 0.5,
      r: o.r || 3, r2: o.r2 != null ? o.r2 : 0,
      color: o.color || '#fff',
      color2: o.color2 || null,
      drag: o.drag != null ? o.drag : 0.9,
      grav: o.grav || 0,
      glow: o.glow != null ? o.glow : 1,
      spin: o.spin || 0, rot: o.rot || 0,
      shape: o.shape || 'circle',
      add: o.add !== false,
      trail: o.trail || 0,
      px: o.x, py: o.y,
    });
  }

  function burst(x, y, n, opt) {
    opt = opt || {};
    n = Math.round(n * (settings.particles || 1));
    for (let i = 0; i < n; i++) {
      const a = opt.angle != null ? opt.angle + R.spread(opt.spread != null ? opt.spread : Math.PI) : R.range(0, U.TAU);
      const sp = R.range(opt.speedMin != null ? opt.speedMin : 40, opt.speedMax != null ? opt.speedMax : 260);
      particle({
        x: x + R.spread(opt.jitter || 0), y: y + R.spread(opt.jitter || 0),
        vx: Math.cos(a) * sp + (opt.vx || 0), vy: Math.sin(a) * sp + (opt.vy || 0),
        life: R.range(opt.lifeMin || 0.25, opt.lifeMax || 0.7),
        r: R.range(opt.rMin || 1.5, opt.rMax || 4.5),
        r2: opt.r2,
        color: opt.color || '#ffcf6b',
        color2: opt.color2,
        drag: opt.drag, grav: opt.grav, glow: opt.glow,
        shape: opt.shape, add: opt.add,
        spin: opt.spin != null ? R.spread(opt.spin) : 0,
        rot: R.range(0, U.TAU),
        trail: opt.trail,
      });
    }
  }

  const MAX_RINGS = 220, MAX_TEXTS = 90, MAX_STREAKS = 120;

  function ring(o) {
    if (rings.length >= MAX_RINGS) rings.splice(0, 12);
    rings.push({
      x: o.x, y: o.y,
      r: o.r || 4, rEnd: o.rEnd || 90,
      life: o.life || 0.42, max: o.life || 0.42,
      color: o.color || '#ffcf6b',
      w: o.w || 3, wEnd: o.wEnd != null ? o.wEnd : 0.5,
      ease: o.ease || 'outQuart',
      add: o.add !== false,
      sides: o.sides || 0,
      rot: o.rot || 0,
      squash: o.squash || 1,
      angle: o.angle || 0,
      arc: o.arc || 0,
    });
  }

  function text(x, y, str, o) {
    o = o || {};
    if (texts.length >= MAX_TEXTS) texts.splice(0, 8);
    texts.push({
      x, y, str,
      vx: o.vx != null ? o.vx : R.spread(24),
      vy: o.vy != null ? o.vy : -R.range(50, 88),
      life: o.life || 0.9, max: o.life || 0.9,
      color: o.color || '#ffffff',
      size: o.size || 20,
      weight: o.weight || 700,
      crit: !!o.crit,
      outline: o.outline !== false,
      grav: o.grav != null ? o.grav : 120,
      shadow: o.shadow,
    });
  }

  function streak(x, y, angle, len, o) {
    o = o || {};
    if (streaks.length >= MAX_STREAKS) streaks.splice(0, 8);
    streaks.push({
      x, y, angle, len,
      life: o.life || 0.22, max: o.life || 0.22,
      color: o.color || '#fff', w: o.w || 3,
      speed: o.speed || 0,
    });
  }

  /* ---------------- screen effects ---------------- */
  function shake(amount, decay) {
    if (settings.shake <= 0) return;
    cam.shake = Math.max(cam.shake, amount * settings.shake);
    if (decay) cam.shakeDecay = decay;
  }
  function stop(t) { hitstop = Math.max(hitstop, t); }
  function slow(t, scale) { slowmo = Math.max(slowmo, t); if (scale != null) slowmoScale = scale; }
  function screenFlash(color, a, decay) {
    if (settings.flashes <= 0) return;
    if (a > flash.a) { flash.a = a; flash.color = color; flash.decay = decay || 4; }
  }
  function vignette(color, a) { vignetteColor = color; vignettePulse = Math.max(vignettePulse, a); }
  function chromatic(a) { chroma = Math.max(chroma, a); }
  function zoomTo(z, snap) { cam.zoomTarget = z; if (snap) cam.zoom = z; }
  function camRot(a) { cam.rot += a; }

  /* ---------------- combined "impact" presets ---------------- */
  function impact(x, y, opt) {
    opt = opt || {};
    const c = opt.color || '#ffcf6b';
    const scale = opt.scale || 1;
    ring({ x, y, r: 6 * scale, rEnd: 70 * scale, life: 0.33, color: c, w: 4 * scale });
    burst(x, y, 12 * scale, { color: c, color2: opt.color2, speedMin: 60 * scale, speedMax: 300 * scale, rMax: 4 * scale, lifeMax: 0.55 });
    shake(opt.shake != null ? opt.shake : 5 * scale);
    stop(opt.stop != null ? opt.stop : 0.03 * scale);
  }

  /* ---------------- cached glow sprites ----------------
     Building a createRadialGradient per glowing object per frame is the single
     most expensive thing this game can do — with a screen full of orbs it is
     enough to stall a frame for seconds. Bake each colour once, then blit. */
  const glowCache = new Map();
  const GLOW_SIZE = 128;

  function glowSprite(color, profile) {
    const key = color + '|' + profile;
    const hit = glowCache.get(key);
    if (hit !== undefined) return hit;

    let cv = null;
    try {
      cv = document.createElement('canvas');
      cv.width = cv.height = GLOW_SIZE;
      const g = cv.getContext && cv.getContext('2d');
      if (!g) throw new Error('no 2d');
      const h = GLOW_SIZE / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      if (profile === 'orb') {
        grad.addColorStop(0, U.rgba('#ffffff', 0.95));
        grad.addColorStop(0.10, U.rgba(color, 0.8));
        grad.addColorStop(0.30, U.rgba(color, 0.34));
        grad.addColorStop(1, U.rgba(color, 0));
      } else {
        grad.addColorStop(0, U.rgba(color, 0.6));
        grad.addColorStop(0.45, U.rgba(color, 0.18));
        grad.addColorStop(1, U.rgba(color, 0));
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
    } catch (e) { cv = null; }   /* headless (soak harness) — glow is a no-op */

    if (glowCache.size > 64) glowCache.clear();
    glowCache.set(key, cv);
    return cv;
  }

  /* Draw a soft radial glow of radius r. Caller sets composite mode. */
  function glow(ctx, x, y, r, color, alpha, profile) {
    const sp = glowSprite(color, profile || 'soft');
    if (!sp) return;
    const a = alpha == null ? 1 : alpha;
    if (a <= 0.004 || r <= 0.5) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * a;
    ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prev;
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    /* particles */
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.rot += p.spin * dt;
    }
    /* rings */
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      if (r.life <= 0) rings.splice(i, 1);
    }
    /* texts */
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      if (t.life <= 0) { texts.splice(i, 1); continue; }
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.vy += t.grav * dt;
      t.vx *= Math.pow(0.94, dt * 60);
    }
    /* streaks */
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.life -= dt;
      if (s.life <= 0) { streaks.splice(i, 1); continue; }
      if (s.speed) { s.x += Math.cos(s.angle) * s.speed * dt; s.y += Math.sin(s.angle) * s.speed * dt; }
    }

    /* camera */
    cam.shake = Math.max(0, cam.shake - cam.shake * cam.shakeDecay * dt - 6 * dt);
    const s = cam.shake;
    cam.ox = R.spread(s); cam.oy = R.spread(s);
    cam.rot *= Math.pow(0.86, dt * 60);
    cam.zoom = U.approach(cam.zoom, cam.zoomTarget, dt, 0.11);

    flash.a = Math.max(0, flash.a - flash.decay * dt);
    vignettePulse = Math.max(0, vignettePulse - 2.2 * dt);
    chroma = Math.max(0, chroma - 3.4 * dt);
  }

  function tickTimers(realDt) {
    if (hitstop > 0) { hitstop = Math.max(0, hitstop - realDt); return true; }
    return false;
  }
  function timeScale(realDt) {
    if (slowmo > 0) { slowmo = Math.max(0, slowmo - realDt); return slowmoScale; }
    return 1;
  }

  /* ---------------- draw ---------------- */
  function applyCam(ctx, w, h) {
    ctx.save();
    const z = cam.zoom;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(cam.rot);
    ctx.scale(z, z);
    ctx.translate(-w / 2 + cam.ox, -h / 2 + cam.oy);
  }
  function popCam(ctx) { ctx.restore(); }

  function drawWorld(ctx) {
    /* streaks (under particles) */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of streaks) {
      const t = s.life / s.max;
      ctx.globalAlpha = t;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.w * t;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(s.angle) * s.len * t, s.y + Math.sin(s.angle) * s.len * t);
      ctx.stroke();
    }
    ctx.restore();

    /* particles */
    ctx.save();
    let addMode = false;
    ctx.globalCompositeOperation = 'lighter'; addMode = true;
    for (const p of parts) {
      const t = p.life / p.max;
      if (p.add !== addMode) {
        ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
        addMode = p.add;
      }
      const col = p.color2 ? U.mixHex(p.color2, p.color, t) : p.color;
      const rr = U.lerp(p.r2, p.r, t);
      ctx.globalAlpha = p.glow * (t > 0.75 ? U.map(t, 1, 0.75, 0.4, 1) : t);
      ctx.fillStyle = col;
      if (p.shape === 'square') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-rr, -rr, rr * 2, rr * 2); ctx.restore();
      } else if (p.shape === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(rr * 2, 0); ctx.lineTo(0, rr * .7); ctx.lineTo(-rr * .6, 0); ctx.lineTo(0, -rr * .7);
        ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (p.shape === 'line') {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, rr * 0.8); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.4, rr), 0, U.TAU); ctx.fill();
      }
    }
    ctx.restore();

    /* rings */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      const raw = 1 - r.life / r.max;
      const t = U.ease[r.ease] ? U.ease[r.ease](raw) : raw;
      const rad = U.lerp(r.r, r.rEnd, t);
      ctx.globalAlpha = (1 - raw) * (1 - raw);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(0.2, U.lerp(r.w, r.wEnd, t));
      ctx.save();
      ctx.translate(r.x, r.y);
      if (r.squash !== 1) { ctx.rotate(r.angle); ctx.scale(1, r.squash); }
      if (r.sides > 2) {
        U.poly(ctx, 0, 0, r.sides, rad, null, r.rot + t * 1.2);
        ctx.stroke();
      } else if (r.arc) {
        ctx.beginPath(); ctx.arc(0, 0, rad, r.angle - r.arc / 2, r.angle + r.arc / 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawText(ctx) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of texts) {
      const k = t.life / t.max;
      const grow = t.crit ? (1 + U.ease.outBack(U.clamp((1 - k) * 4, 0, 1)) * 0.35) : 1;
      const alpha = k > 0.6 ? 1 : k / 0.6;
      const size = t.size * grow * (0.7 + 0.3 * U.clamp((1 - k) * 6, 0, 1));
      ctx.globalAlpha = alpha;
      ctx.font = `${t.weight} ${size.toFixed(1)}px "Rajdhani","DIN Alternate",Arial Narrow,sans-serif`;
      if (t.outline) {
        ctx.lineWidth = Math.max(2, size * 0.16); ctx.strokeStyle = 'rgba(4,3,10,.92)';
        ctx.lineJoin = 'round';
        ctx.strokeText(t.str, t.x, t.y);
      }
      if (t.shadow) { ctx.shadowColor = t.color; ctx.shadowBlur = 14; }
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawScreen(ctx, w, h) {
    if (vignettePulse > 0.001) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.82);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, U.rgba(vignetteColor, U.clamp(vignettePulse, 0, 1) * 0.75));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (flash.a > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = flash.color === '#000000' ? 'source-over' : 'lighter';
      ctx.fillStyle = U.rgba(flash.color, U.clamp(flash.a, 0, 1));
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  return {
    cam, reset, setSettings,
    particle, burst, ring, text, streak, impact, glow,
    shake, stop, slow, screenFlash, vignette, chromatic, zoomTo, camRot,
    update, tickTimers, timeScale,
    applyCam, popCam, drawWorld, drawText, drawScreen,
    get hitstop() { return hitstop; },
    get chroma() { return chroma; },
    counts: () => parts.length + rings.length + texts.length,
  };
})();
