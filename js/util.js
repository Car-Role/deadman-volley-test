/* ============================================================
   DEADMAN VOLLEY — util.js
   Math, RNG, easing, colour, small helpers.
   ============================================================ */
window.DV = window.DV || {};

DV.VERSION = "1.0.3";

/* Backing-store resolution multipliers, set by game.js on resize.
   All draw code works in logical 1280x720 units; `q` maps those to device pixels. */
DV.RENDER = { q: 1, mq: 1 };

DV.U = (function () {
  const TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function inv(a, b, v) { return b === a ? 0 : (v - a) / (b - a); }
  function map(v, a, b, c, d) { return lerp(c, d, clamp(inv(a, b, v), 0, 1)); }
  function approach(cur, tgt, dt, rate) { return cur + (tgt - cur) * (1 - Math.pow(1 - rate, dt * 60)); }
  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
  function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
  function angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
  function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
  function sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

  /* deterministic RNG — mulberry32 */
  function makeRNG(seed) {
    let s = (seed >>> 0) || 1;
    const r = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    };
    /* weighted pick: items need .weight (default 1) */
    r.weighted = (arr, wf) => {
      let total = 0;
      for (const it of arr) total += (wf ? wf(it) : (it.weight || 1));
      let x = r() * total;
      for (const it of arr) { x -= (wf ? wf(it) : (it.weight || 1)); if (x <= 0) return it; }
      return arr[arr.length - 1];
    };
    r.seed = () => s;
    return r;
  }

  /* global non-deterministic rng for pure visuals */
  const rnd = () => Math.random();
  rnd.range = (a, b) => a + Math.random() * (b - a);
  rnd.int = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  rnd.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  rnd.chance = (p) => Math.random() < p;
  rnd.sign = () => (Math.random() < 0.5 ? -1 : 1);
  rnd.spread = (a) => (Math.random() * 2 - 1) * a;

  /* easing */
  const ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => t * (2 - t),
    inOutQuad: t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    inCubic: t => t * t * t,
    outCubic: t => (--t) * t * t + 1,
    inOutCubic: t => t < .5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    outQuart: t => 1 - Math.pow(1 - t, 4),
    outQuint: t => 1 - Math.pow(1 - t, 5),
    outExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    inExpo: t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
    outBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (TAU / 3)) + 1,
    outBounce: t => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
      return n * (t -= 2.625 / d) * t + .984375;
    },
    /* 0 -> 1 -> 0 */
    arc: t => Math.sin(clamp(t, 0, 1) * Math.PI),
  };

  /* colour utils — accept "#rrggbb" */
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
  }
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    if (amt >= 0) return rgbToHex(lerp(c[0], 255, amt), lerp(c[1], 255, amt), lerp(c[2], 255, amt));
    return rgbToHex(c[0] * (1 + amt), c[1] * (1 + amt), c[2] * (1 + amt));
  }

  /* deterministic-ish value noise for background wisps */
  function hash2(x, y) {
    let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function roman(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out || 'O';
  }

  /* circle-vs-circle sweep: does a moving circle (p,r,v over dt) touch static circle (q,R)? */
  function sweepHit(px, py, vx, vy, r, qx, qy, R, dt) {
    const ex = px - qx, ey = py - qy;
    const rad = r + R;
    const dx = vx * dt, dy = vy * dt;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return (ex * ex + ey * ey) <= rad * rad ? 0 : -1;
    const b = 2 * (ex * dx + ey * dy);
    const c = ex * ex + ey * ey - rad * rad;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > 1) return -1;
    return t;
  }

  /* rounded-rect path */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* n-pointed star / polygon path */
  function poly(ctx, x, y, n, rOuter, rInner, rot) {
    ctx.beginPath();
    const steps = rInner != null ? n * 2 : n;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU + (rot || 0);
      const r = (rInner != null && i % 2) ? rInner : rOuter;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  return {
    TAU, clamp, lerp, inv, map, approach, dist, dist2, angTo, angDiff, angLerp, sign,
    makeRNG, rnd, ease, hexToRgb, rgbToHex, rgba, mixHex, shade, hash2,
    fmtTime, roman, sweepHit, rr, poly
  };
})();
