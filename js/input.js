/* ============================================================
   DEADMAN VOLLEY — input.js
   Keyboard + mouse + gamepad, with edge detection and
   canvas-space pointer mapping.
   ============================================================ */
DV.Input = (function () {
  const U = DV.U;
  const LOGICAL_W = 1280, LOGICAL_H = 720;

  const down = Object.create(null);
  const pressed = Object.create(null);
  const released = Object.create(null);

  const mouse = { x: 640, y: 360, rawX: 0, rawY: 0, inside: false };
  const mb = [false, false, false];
  const mbPressed = [false, false, false];
  const mbReleased = [false, false, false];
  let wheel = 0;

  let canvas = null;
  let padIndex = null;
  let usingPad = false;
  let lastPadBtns = [];
  const padAxes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };

  const BINDS = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    dash: ['Space', 'ShiftLeft'],
    tech1: ['KeyQ', 'Digit1'],
    tech2: ['KeyE', 'Digit2'],
    pause: ['Escape', 'KeyP'],
    map: ['Tab'],
    confirm: ['Enter', 'NumpadEnter'],
  };

  const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Digit1', 'Digit2', 'Slash', 'Quote']);

  function attach(cv) {
    canvas = cv;

    window.addEventListener('keydown', e => {
      if (e.repeat) { if (PREVENT.has(e.code)) e.preventDefault(); return; }
      if (!down[e.code]) pressed[e.code] = true;
      down[e.code] = true;
      usingPad = false;
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      down[e.code] = false;
      released[e.code] = true;
    });
    window.addEventListener('blur', () => {
      for (const k in down) down[k] = false;
      mb[0] = mb[1] = mb[2] = false;
    });

    /* Map the pointer into the game's logical 1280x720 space. The canvas
       backing store may be larger (HiDPI), so never use canvas.width here. */
    const upd = e => {
      const r = canvas.getBoundingClientRect();
      mouse.rawX = e.clientX; mouse.rawY = e.clientY;
      mouse.x = ((e.clientX - r.left) / r.width) * LOGICAL_W;
      mouse.y = ((e.clientY - r.top) / r.height) * LOGICAL_H;
      mouse.inside = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= LOGICAL_W && mouse.y <= LOGICAL_H;
      usingPad = false;
    };
    window.addEventListener('mousemove', upd);
    window.addEventListener('mousedown', e => {
      upd(e);
      if (e.button < 3) { if (!mb[e.button]) mbPressed[e.button] = true; mb[e.button] = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button < 3) { mb[e.button] = false; mbReleased[e.button] = true; }
    });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', e => { wheel += Math.sign(e.deltaY); }, { passive: true });

    window.addEventListener('gamepadconnected', e => { padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { padIndex = null; usingPad = false; });
  }

  function pollPad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let gp = null;
    if (padIndex != null && pads[padIndex]) gp = pads[padIndex];
    else { for (const p of pads) if (p) { gp = p; padIndex = p.index; break; } }
    if (!gp) return;

    const dz = v => Math.abs(v) < 0.22 ? 0 : (v - Math.sign(v) * 0.22) / 0.78;
    padAxes.lx = dz(gp.axes[0] || 0); padAxes.ly = dz(gp.axes[1] || 0);
    padAxes.rx = dz(gp.axes[2] || 0); padAxes.ry = dz(gp.axes[3] || 0);
    padAxes.lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    padAxes.rt = gp.buttons[7] ? gp.buttons[7].value : 0;

    if (Math.abs(padAxes.lx) + Math.abs(padAxes.ly) + Math.abs(padAxes.rx) + Math.abs(padAxes.ry) > 0.05) usingPad = true;

    const b = gp.buttons.map(x => x.pressed);
    for (let i = 0; i < b.length; i++) {
      if (b[i] && !lastPadBtns[i]) { padPressed[i] = true; usingPad = true; }
      if (!b[i] && lastPadBtns[i]) padReleased[i] = true;
    }
    padDown = b;
    lastPadBtns = b;
  }
  let padDown = [];
  const padPressed = Object.create(null);
  const padReleased = Object.create(null);

  /* ---- gamepad button map (standard) ---- */
  const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, DU: 12, DD: 13, DL: 14, DR: 15 };
  const PADBINDS = {
    dash: [PAD.A, PAD.LB],
    tech1: [PAD.X],
    tech2: [PAD.Y],
    pause: [PAD.START],
    confirm: [PAD.A],
  };

  /* ---- public queries ---- */
  function key(code) { return !!down[code]; }
  function keyHit(code) { return !!pressed[code]; }

  function act(name) {
    const b = BINDS[name];
    if (b) for (const c of b) if (down[c]) return true;
    const p = PADBINDS[name];
    if (p) for (const i of p) if (padDown[i]) return true;
    if (name === 'dash' && padAxes.lt > 0.5) return true;
    return false;
  }
  function actHit(name) {
    const b = BINDS[name];
    if (b) for (const c of b) if (pressed[c]) return true;
    const p = PADBINDS[name];
    if (p) for (const i of p) if (padPressed[i]) return true;
    return false;
  }

  function fireDown() { return mb[0] || padAxes.rt > 0.45; }
  function fireHit() { return mbPressed[0] || (padPressed[PAD.RT]); }
  function fireUp() { return mbReleased[0] || padReleased[PAD.RT]; }
  function parryHit() { return mbPressed[2] || padPressed[PAD.RB] || pressed['KeyK'] || pressed['KeyJ'] || padPressed[PAD.B]; }

  /* movement vector, normalised */
  function moveVec() {
    let x = 0, y = 0;
    if (act('left')) x -= 1;
    if (act('right')) x += 1;
    if (act('up')) y -= 1;
    if (act('down')) y += 1;
    if (Math.abs(padAxes.lx) > 0 || Math.abs(padAxes.ly) > 0) { x = padAxes.lx; y = padAxes.ly; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m) };
  }

  /* aim: pad right-stick keeps a persistent angle, else mouse */
  let padAim = 0;
  function aimAngle(fromX, fromY) {
    if (usingPad && (Math.abs(padAxes.rx) > 0.1 || Math.abs(padAxes.ry) > 0.1)) {
      padAim = Math.atan2(padAxes.ry, padAxes.rx);
    }
    if (usingPad) return padAim;
    return U.angTo(fromX, fromY, mouse.x, mouse.y);
  }
  function isPad() { return usingPad; }

  function endFrame() {
    for (const k in pressed) pressed[k] = false;
    for (const k in released) released[k] = false;
    for (const k in padPressed) padPressed[k] = false;
    for (const k in padReleased) padReleased[k] = false;
    mbPressed[0] = mbPressed[1] = mbPressed[2] = false;
    mbReleased[0] = mbReleased[1] = mbReleased[2] = false;
    wheel = 0;
  }

  function clearAll() {
    for (const k in down) down[k] = false;
    endFrame();
  }

  return {
    attach, pollPad, endFrame, clearAll,
    key, keyHit, act, actHit,
    fireDown, fireHit, fireUp, parryHit,
    moveVec, aimAngle, isPad,
    mouse, mb, BINDS,
    get wheel() { return wheel; }
  };
})();
