/* ============================================================
   DEADMAN VOLLEY — audio.js
   Fully procedural WebAudio. No asset files.
   Two buses: SFX and MUSIC, each with its own gain + a shared
   convolution-free "space" (feedback delay) send.
   ============================================================ */
DV.Audio = (function () {
  const U = DV.U;
  let ctx = null, ready = false;
  let masterGain, sfxGain, musGain, spaceIn, comp;
  let vol = { master: 0.85, sfx: 0.9, music: 0.55 };
  let muted = false;

  /* ---------- setup ---------- */
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22;
    comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;

    masterGain = ctx.createGain(); masterGain.gain.value = vol.master;
    sfxGain = ctx.createGain(); sfxGain.gain.value = vol.sfx;
    musGain = ctx.createGain(); musGain.gain.value = vol.music;

    /* feedback delay "space" */
    const dl = ctx.createDelay(1.2); dl.delayTime.value = 0.26;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const dlFilt = ctx.createBiquadFilter(); dlFilt.type = 'lowpass'; dlFilt.frequency.value = 2200;
    const dlOut = ctx.createGain(); dlOut.gain.value = 0.5;
    spaceIn = ctx.createGain(); spaceIn.gain.value = 1;
    spaceIn.connect(dl); dl.connect(dlFilt); dlFilt.connect(fb); fb.connect(dl);
    dlFilt.connect(dlOut); dlOut.connect(masterGain);

    sfxGain.connect(comp);
    musGain.connect(comp);
    comp.connect(masterGain);
    masterGain.connect(ctx.destination);
    ready = true;
  }

  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function now() { return ctx ? ctx.currentTime : 0; }
  function ok() { return ready && ctx && ctx.state === 'running' && !muted; }

  function setVol(which, v) {
    vol[which] = U.clamp(v, 0, 1);
    if (!ready) return;
    if (which === 'master') masterGain.gain.value = muted ? 0 : vol.master;
    if (which === 'sfx') sfxGain.gain.value = vol.sfx;
    if (which === 'music') musGain.gain.value = vol.music;
  }
  function getVol(which) { return vol[which]; }
  function setMuted(m) { muted = m; if (ready) masterGain.gain.value = muted ? 0 : vol.master; }

  /* ---------- primitives ---------- */
  function env(g, t, a, d, peak, sus, rel, hold) {
    peak = peak == null ? 1 : peak;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (sus != null && hold) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sus), t + a + d);
      g.gain.setValueAtTime(Math.max(0.0002, sus), t + a + d + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + rel);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
  }

  function tone(opts) {
    if (!ok()) return;
    const t = opts.t != null ? opts.t : now();
    const o = ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f, t);
    if (opts.f2 != null) {
      if (opts.exp === false) o.frequency.linearRampToValueAtTime(opts.f2, t + (opts.slide || opts.dur || 0.2));
      else o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f2), t + (opts.slide || opts.dur || 0.2));
    }
    if (opts.detune) o.detune.setValueAtTime(opts.detune, t);

    let node = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter; f.frequency.setValueAtTime(opts.ff || 1200, t);
      if (opts.ff2 != null) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.ff2), t + (opts.dur || 0.2));
      f.Q.value = opts.q || 1;
      node.connect(f); node = f;
    }
    const g = ctx.createGain();
    node.connect(g);
    env(g, t, opts.a || 0.004, opts.d || (opts.dur || 0.2), opts.v == null ? 0.4 : opts.v, opts.sus, opts.rel || 0.1, opts.hold);
    g.connect(opts.bus || sfxGain);
    if (opts.space) { const s = ctx.createGain(); s.gain.value = opts.space; g.connect(s); s.connect(spaceIn); }
    o.start(t);
    o.stop(t + (opts.a || 0.004) + (opts.d || (opts.dur || 0.2)) + (opts.hold || 0) + (opts.rel || 0.1) + 0.05);
    return o;
  }

  let noiseBuf = null;
  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noise(opts) {
    if (!ok()) return;
    const t = opts.t != null ? opts.t : now();
    const s = ctx.createBufferSource();
    s.buffer = getNoise(); s.loop = true;
    s.playbackRate.value = opts.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.ff || 900, t);
    if (opts.ff2 != null) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.ff2), t + (opts.dur || 0.2));
    f.Q.value = opts.q || 1.2;
    const g = ctx.createGain();
    s.connect(f); f.connect(g);
    env(g, t, opts.a || 0.003, opts.d || (opts.dur || 0.2), opts.v == null ? 0.3 : opts.v, opts.sus, opts.rel || 0.08, opts.hold);
    g.connect(opts.bus || sfxGain);
    if (opts.space) { const sp = ctx.createGain(); sp.gain.value = opts.space; g.connect(sp); sp.connect(spaceIn); }
    s.start(t);
    s.stop(t + (opts.a || .003) + (opts.d || (opts.dur || .2)) + (opts.hold || 0) + (opts.rel || .08) + 0.05);
    return s;
  }

  /* ---------- SFX library ---------- */
  const S = {
    ui_move() { tone({ type: 'square', f: 620, f2: 700, dur: 0.05, v: 0.05, filter: 'lowpass', ff: 2400 }); },
    ui_click() {
      tone({ type: 'triangle', f: 880, f2: 1320, dur: 0.09, v: 0.13 });
      noise({ ff: 3200, ff2: 900, dur: 0.07, v: 0.06 });
    },
    ui_back() { tone({ type: 'triangle', f: 520, f2: 300, dur: 0.11, v: 0.11 }); },
    ui_deny() {
      tone({ type: 'sawtooth', f: 190, f2: 120, dur: 0.16, v: 0.13, filter: 'lowpass', ff: 900 });
    },
    ui_confirm() {
      const t = now();
      [523, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.24, v: 0.11, t: t + i * 0.055, space: 0.2 }));
    },

    /* --- combat --- */
    charge_start() {
      tone({ type: 'sawtooth', f: 60, f2: 220, dur: 0.9, v: 0.09, filter: 'lowpass', ff: 300, ff2: 1600, q: 6 });
    },
    charge_full() {
      tone({ type: 'sine', f: 1400, f2: 2100, dur: 0.18, v: 0.1, space: 0.3 });
      tone({ type: 'sine', f: 700, f2: 1050, dur: 0.2, v: 0.08 });
    },
    /* released inside the beat — bright, obviously "you nailed it" */
    charge_perfect() {
      const t = now();
      [784, 1175, 1568].forEach((f, i) =>
        tone({ type: 'square', f, f2: f * 1.5, dur: 0.16, v: 0.11, t: t + i * 0.028, space: 0.4 }));
      tone({ type: 'sine', f: 2350, f2: 3400, dur: 0.22, v: 0.07, t, space: 0.45 });
      noise({ ff: 7000, ff2: 1600, dur: 0.14, v: 0.13, t });
      tone({ type: 'sine', f: 95, f2: 44, dur: 0.28, v: 0.36, t });
    },
    fire(power) {
      const p = power || 0;
      const t = now();
      tone({ type: 'sawtooth', f: 260 - p * 90, f2: 70, dur: 0.3 + p * 0.2, v: 0.24, filter: 'lowpass', ff: 2600, ff2: 260, q: 3, space: 0.22, t });
      noise({ ff: 2400, ff2: 300, dur: 0.26, v: 0.16, t });
      tone({ type: 'sine', f: 120 - p * 30, f2: 40, dur: 0.4, v: 0.3, t });
    },
    parry(volley, perfect) {
      const t = now();
      const pitch = 520 + Math.min(volley, 16) * 62;
      if (perfect) {
        tone({ type: 'square', f: pitch * 1.5, f2: pitch * 2.6, dur: 0.11, v: 0.2, t, space: 0.35 });
        tone({ type: 'sine', f: pitch * 3, f2: pitch * 4.5, dur: 0.2, v: 0.12, t, space: 0.4 });
        noise({ ff: 6000, ff2: 1400, dur: 0.13, v: 0.16, t });
        tone({ type: 'sine', f: 90, f2: 45, dur: 0.22, v: 0.34, t });
      } else {
        tone({ type: 'triangle', f: pitch, f2: pitch * 1.7, dur: 0.1, v: 0.17, t, space: 0.2 });
        noise({ ff: 3400, ff2: 900, dur: 0.1, v: 0.11, t });
        tone({ type: 'sine', f: 110, f2: 55, dur: 0.16, v: 0.24, t });
      }
    },
    parry_whiff() {
      noise({ ff: 1600, ff2: 500, dur: 0.14, v: 0.09, filter: 'bandpass', q: 0.8 });
      tone({ type: 'triangle', f: 320, f2: 190, dur: 0.12, v: 0.07 });
    },
    dash() {
      noise({ ff: 700, ff2: 2600, dur: 0.16, v: 0.13, q: 0.7 });
      tone({ type: 'sine', f: 220, f2: 520, dur: 0.13, v: 0.09 });
    },
    hurt() {
      const t = now();
      tone({ type: 'sawtooth', f: 180, f2: 55, dur: 0.4, v: 0.3, filter: 'lowpass', ff: 1200, ff2: 180, t });
      noise({ ff: 1000, ff2: 160, dur: 0.35, v: 0.2, t });
      tone({ type: 'sine', f: 70, f2: 32, dur: 0.5, v: 0.36, t });
    },
    enemy_hit(big) {
      const t = now();
      tone({ type: 'square', f: big ? 190 : 300, f2: big ? 60 : 110, dur: 0.16, v: 0.15, filter: 'lowpass', ff: 1800, ff2: 400, t });
      noise({ ff: big ? 900 : 1800, ff2: 260, dur: 0.16, v: 0.13, t });
    },
    enemy_die() {
      const t = now();
      tone({ type: 'sawtooth', f: 240, f2: 40, dur: 0.5, v: 0.18, filter: 'lowpass', ff: 2000, ff2: 150, t, space: 0.25 });
      noise({ ff: 1600, ff2: 90, dur: 0.55, v: 0.18, t });
    },
    boss_die() {
      const t = now();
      for (let i = 0; i < 6; i++) {
        noise({ ff: 2200 - i * 260, ff2: 70, dur: 0.7, v: 0.15, t: t + i * 0.09 });
        tone({ type: 'sawtooth', f: 200 - i * 22, f2: 34, dur: 0.8, v: 0.12, filter: 'lowpass', ff: 1400, ff2: 90, t: t + i * 0.09, space: 0.3 });
      }
    },
    orb_bounce() {
      tone({ type: 'triangle', f: 420, f2: 260, dur: 0.08, v: 0.08 });
    },
    orb_spawn() {
      tone({ type: 'sine', f: 90, f2: 320, dur: 0.5, v: 0.13, space: 0.3 });
      noise({ ff: 300, ff2: 2400, dur: 0.45, v: 0.07 });
    },
    telegraph() {
      tone({ type: 'square', f: 1500, dur: 0.06, v: 0.06, filter: 'highpass', ff: 900 });
    },
    heal() {
      const t = now();
      [660, 880, 1100, 1320].forEach((f, i) => tone({ type: 'sine', f, dur: 0.35, v: 0.09, t: t + i * 0.06, space: 0.35 }));
    },
    pickup() {
      const t = now();
      tone({ type: 'triangle', f: 980, f2: 1560, dur: 0.13, v: 0.13, t });
      tone({ type: 'sine', f: 1960, dur: 0.2, v: 0.05, t: t + 0.05, space: 0.4 });
    },
    shards() {
      const t = now();
      for (let i = 0; i < 3; i++) tone({ type: 'square', f: 1200 + i * 400, dur: 0.06, v: 0.05, t: t + i * 0.035, filter: 'highpass', ff: 700 });
    },
    levelup() {
      const t = now();
      [392, 523, 659, 784, 1046].forEach((f, i) =>
        tone({ type: 'triangle', f, dur: 0.5, v: 0.11, t: t + i * 0.07, space: 0.4 }));
    },
    room_clear() {
      const t = now();
      [523, 659, 784].forEach((f, i) => tone({ type: 'sine', f, dur: 0.7, v: 0.1, t: t + i * 0.1, space: 0.45 }));
      tone({ type: 'sine', f: 130, dur: 1.2, v: 0.13, t });
    },
    danger() {
      const t = now();
      tone({ type: 'sawtooth', f: 55, dur: 1.4, v: 0.14, filter: 'lowpass', ff: 200, t });
      tone({ type: 'square', f: 1100, f2: 1050, dur: 0.5, v: 0.04, t });
    },
    boss_intro() {
      const t = now();
      tone({ type: 'sawtooth', f: 40, f2: 30, dur: 2.4, v: 0.2, filter: 'lowpass', ff: 260, t });
      noise({ ff: 120, ff2: 40, dur: 2.2, v: 0.12, t, filter: 'lowpass' });
      [110, 146.8, 174.6].forEach((f, i) => tone({ type: 'sawtooth', f, dur: 1.6, v: 0.07, t: t + 0.1 + i * 0.18, filter: 'lowpass', ff: 800, space: 0.4 }));
    },
    death() {
      const t = now();
      tone({ type: 'sine', f: 220, f2: 22, dur: 2.6, v: 0.3, t, space: 0.5 });
      noise({ ff: 900, ff2: 40, dur: 2.4, v: 0.16, t, filter: 'lowpass' });
    },
    victory() {
      const t = now();
      [523, 659, 784, 1046, 1318].forEach((f, i) =>
        tone({ type: 'triangle', f, dur: 1.1, v: 0.12, t: t + i * 0.13, space: 0.5 }));
      tone({ type: 'sine', f: 130.8, dur: 2.6, v: 0.15, t });
    },
    shield_break() {
      const t = now();
      noise({ ff: 5200, ff2: 700, dur: 0.35, v: 0.2, t, q: 0.6 });
      tone({ type: 'square', f: 1800, f2: 300, dur: 0.25, v: 0.1, t });
    },
    tech() {
      const t = now();
      tone({ type: 'sine', f: 300, f2: 1400, dur: 0.25, v: 0.14, t, space: 0.35 });
      noise({ ff: 600, ff2: 4000, dur: 0.22, v: 0.09, t });
    },
    warn() { tone({ type: 'square', f: 880, f2: 660, dur: 0.14, v: 0.07, filter: 'lowpass', ff: 2000 }); },
  };

  function play(name, ...args) {
    if (!ok()) return;
    const fn = S[name];
    if (fn) { try { fn(...args); } catch (e) { /* audio should never break the game */ } }
  }

  /* ============================================================
     MUSIC — layered generative engine
     Layers: drone / pulse / arp / drums / lead-stab
     Intensity 0..1 fades layers in.
     ============================================================ */
  const SCALES = {
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    harmMinor: [0, 2, 3, 5, 7, 8, 11],
  };

  const music = {
    on: false, timer: null, step: 0,
    root: 55, scale: SCALES.aeolian, bpm: 92,
    intensity: 0, targetIntensity: 0,
    mode: 'menu',
    droneNodes: null,
    rng: U.makeRNG(1234),
  };

  function noteHz(root, scale, degree) {
    const oct = Math.floor(degree / scale.length);
    const idx = ((degree % scale.length) + scale.length) % scale.length;
    return root * Math.pow(2, (scale[idx] + oct * 12) / 12);
  }

  function stopDrone() {
    if (music.droneNodes) {
      const t = now();
      music.droneNodes.forEach(n => {
        try { n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0.0001, t, 0.4); n.o.stop(t + 2.2); } catch (e) { }
      });
      music.droneNodes = null;
    }
  }

  function startDrone() {
    if (!ok()) return;
    stopDrone();
    const t = now();
    const nodes = [];
    const mk = (f, type, v, detune) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      if (detune) o.detune.value = detune;
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 1.5;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(flt); flt.connect(g); g.connect(musGain);
      const s = ctx.createGain(); s.gain.value = 0.25; g.connect(s); s.connect(spaceIn);
      o.start(t);
      g.gain.setTargetAtTime(v, t, 1.4);
      /* slow LFO on filter for movement */
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045 + Math.random() * 0.05;
      const lg = ctx.createGain(); lg.gain.value = 190;
      lfo.connect(lg); lg.connect(flt.frequency); lfo.start(t);
      nodes.push({ o, g, flt, lfo });
      return { o, g };
    };
    mk(music.root / 2, 'sawtooth', 0.10, -4);
    mk(music.root / 2, 'sawtooth', 0.08, +7);
    mk(noteHz(music.root, music.scale, 4) / 2, 'triangle', 0.055, 0);
    music.droneNodes = nodes;
  }

  function musicStep() {
    if (!ok() || !music.on) return;
    const st = music.step++;
    const beat = 60 / music.bpm / 2; /* eighth notes */
    const t = now() + 0.02;
    const R = music.rng;
    const I = music.intensity;

    /* --- drums --- */
    if (I > 0.12) {
      if (st % 8 === 0) { /* kick */
        tone({ type: 'sine', f: 130, f2: 38, dur: 0.28, v: 0.34 * Math.min(1, I * 1.6), t, bus: musGain, exp: true });
        noise({ ff: 200, ff2: 60, dur: 0.09, v: 0.1 * I, t, bus: musGain, filter: 'lowpass' });
      }
      if (st % 8 === 4 || (I > 0.5 && st % 16 === 14)) { /* snare-ish */
        noise({ ff: 1900, ff2: 700, dur: 0.16, v: 0.12 * I, t, bus: musGain, q: 0.7, space: 0.15 });
        tone({ type: 'triangle', f: 220, f2: 150, dur: 0.1, v: 0.07 * I, t, bus: musGain });
      }
      if (I > 0.35 && st % 2 === 1) { /* hats */
        noise({ ff: 8000, ff2: 6000, dur: 0.035, v: 0.045 * I, t, bus: musGain, filter: 'highpass' });
      }
      if (I > 0.7 && st % 8 === 6) {
        tone({ type: 'sine', f: 150, f2: 44, dur: 0.2, v: 0.22 * I, t, bus: musGain });
      }
    }

    /* --- pulse bass --- */
    if (I > 0.05 && st % 2 === 0) {
      const deg = [0, 0, 0, 3, 0, 0, 5, 4][Math.floor(st / 2) % 8];
      tone({
        type: 'square', f: noteHz(music.root, music.scale, deg) / 2, dur: beat * 1.6,
        v: 0.10 + 0.09 * I, t, bus: musGain, filter: 'lowpass', ff: 300 + I * 900, q: 4
      });
    }

    /* --- arp --- */
    if (I > 0.3) {
      const pat = [0, 2, 4, 7, 4, 2, 6, 4];
      const deg = pat[st % pat.length] + (st % 32 >= 16 ? 2 : 0);
      tone({
        type: 'triangle', f: noteHz(music.root * 4, music.scale, deg), dur: beat * 0.9,
        v: 0.05 * (I - 0.3) * 1.6, t, bus: musGain, space: 0.4, filter: 'bandpass', ff: 1800, q: 1.2
      });
    }

    /* --- lead stabs at high intensity --- */
    if (I > 0.62 && st % 16 === 8) {
      const deg = R.pick([0, 3, 4, 6, 7]);
      tone({
        type: 'sawtooth', f: noteHz(music.root * 2, music.scale, deg), dur: 0.5,
        v: 0.07 * I, t, bus: musGain, filter: 'lowpass', ff: 2600, ff2: 500, q: 5, space: 0.45
      });
    }

    /* --- sparse bell in calm --- */
    if (I < 0.25 && st % 32 === 0) {
      const deg = R.pick([0, 2, 4, 6]);
      tone({ type: 'sine', f: noteHz(music.root * 4, music.scale, deg), dur: 1.8, v: 0.055, t, bus: musGain, space: 0.55 });
    }

    /* intensity glide */
    music.intensity += (music.targetIntensity - music.intensity) * 0.06;

    music.timer = setTimeout(musicStep, beat * 1000);
  }

  const MUSIC_MODES = {
    menu: { root: 51.9, scale: SCALES.aeolian, bpm: 78, intensity: 0.06 },
    map: { root: 55, scale: SCALES.dorian, bpm: 84, intensity: 0.12 },
    combat: { root: 55, scale: SCALES.aeolian, bpm: 100, intensity: 0.6 },
    combat_hot: { root: 55, scale: SCALES.phrygian, bpm: 112, intensity: 0.88 },
    elite: { root: 58.3, scale: SCALES.phrygian, bpm: 108, intensity: 0.8 },
    boss: { root: 49, scale: SCALES.harmMinor, bpm: 118, intensity: 0.95 },
    calm: { root: 55, scale: SCALES.dorian, bpm: 76, intensity: 0.1 },
    dead: { root: 46.2, scale: SCALES.locrian, bpm: 60, intensity: 0.05 },
    win: { root: 65.4, scale: SCALES.dorian, bpm: 96, intensity: 0.5 },
  };

  function setMusic(mode, hard) {
    init();
    if (!ctx) return;
    const m = MUSIC_MODES[mode] || MUSIC_MODES.menu;
    const changedTone = music.root !== m.root || music.scale !== m.scale;
    music.mode = mode;
    music.bpm = m.bpm;
    music.targetIntensity = m.intensity;
    if (hard) music.intensity = m.intensity;
    if (changedTone) {
      music.root = m.root; music.scale = m.scale;
      if (music.on) startDrone();
    }
    if (!music.on) {
      music.on = true;
      music.root = m.root; music.scale = m.scale;
      startDrone();
      musicStep();
    }
  }
  function nudgeIntensity(v) { music.targetIntensity = U.clamp(v, 0, 1); }
  function stopMusic() {
    music.on = false;
    if (music.timer) { clearTimeout(music.timer); music.timer = null; }
    stopDrone();
  }

  /* transient duck for big impacts */
  function duck(amount, time) {
    if (!ok()) return;
    const t = now();
    musGain.gain.cancelScheduledValues(t);
    musGain.gain.setValueAtTime(musGain.gain.value, t);
    musGain.gain.linearRampToValueAtTime(vol.music * (1 - amount), t + 0.03);
    musGain.gain.linearRampToValueAtTime(vol.music, t + 0.03 + (time || 0.4));
  }

  return { init, resume, play, setVol, getVol, setMuted, setMusic, stopMusic, nudgeIntensity, duck, isReady: () => ok() };
})();
