/* ============================================================
   DEADMAN VOLLEY — map.js
   Branching sector maps (generation, drawing, hit-testing) and
   procedural room/wave construction.
   ============================================================ */
DV.MapGen = (function () {
  const U = DV.U, C = DV.Content;

  const MW = 1160, MH = 440;

  const NODE_TYPES = {
    combat: { name: 'Combat', glyph: '⚔', color: '#9a95b4', desc: 'A room of the dead. Clear it.' },
    elite: { name: 'Elite', glyph: '☠', color: '#ff4d5e', desc: 'Stronger foes, better spoils. A modifier is in play.' },
    event: { name: 'Event', glyph: '?', color: '#7dff9b', desc: 'Something that wants to talk.' },
    shop: { name: 'Market', glyph: '◈', color: '#ffcf6b', desc: 'Spend shards on sigils and repairs.' },
    rest: { name: 'Rest', glyph: '✚', color: '#6be6ff', desc: 'Heal, or sharpen a technique.' },
    treasure: { name: 'Cache', glyph: '⬟', color: '#b46bff', desc: 'A free sigil, unattended.' },
    boss: { name: 'Boss', glyph: '☗', color: '#ff4d5e', desc: 'The warden of this sector.' },
  };

  /* ============================================================
     GENERATION
     ============================================================ */
  function generate(sectorN, seed) {
    const sector = C.SECTORS[Math.min(3, sectorN - 1)];
    const rng = U.makeRNG((seed + sectorN * 104729) >>> 0);
    const ROWS = sector.rooms;      // includes boss row
    const LANES = 5;
    const PATHS = 4;

    /* grid[row][col] = node|null */
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(LANES).fill(null));

    const nodes = [];
    let uid = 0;
    function ensure(r, c) {
      if (grid[r][c]) return grid[r][c];
      const n = {
        id: uid++, row: r, col: c, type: 'combat',
        next: [], prev: [],
        visited: false, available: false, current: false,
        x: 0, y: 0, modifier: null, bossId: null,
        depth: r + 1, sector: sectorN,
        seed: (rng.int(0, 1e9)) >>> 0,
      };
      grid[r][c] = n;
      nodes.push(n);
      return n;
    }

    /* boss row: single centred node */
    const bossNode = ensure(ROWS - 1, 2);
    bossNode.type = 'boss';
    bossNode.bossId = sector.boss;

    /* random-walk paths */
    for (let p = 0; p < PATHS; p++) {
      let c = p === 0 ? 0 : p === 1 ? LANES - 1 : rng.int(0, LANES - 1);
      let node = ensure(0, c);
      for (let r = 1; r < ROWS - 1; r++) {
        const opts = [c - 1, c, c + 1].filter(x => x >= 0 && x < LANES);
        const nc = rng.pick(opts);
        const next = ensure(r, nc);
        if (node.next.indexOf(next) < 0) { node.next.push(next); next.prev.push(node); }
        node = next; c = nc;
      }
      if (node.next.indexOf(bossNode) < 0) { node.next.push(bossNode); bossNode.prev.push(node); }
    }

    /* prune unreachable (anything not on a path from row 0) */
    const alive = new Set();
    const mark = (n) => {
      if (alive.has(n)) return;
      alive.add(n);
      for (const nx of n.next) mark(nx);
    };
    for (const n of nodes) if (n.row === 0) mark(n);

    const kept = nodes.filter(n => alive.has(n));
    for (const n of kept) {
      n.prev = n.prev.filter(p => alive.has(p));
      n.next = n.next.filter(x => alive.has(x));
    }

    /* ---------- assign room types ---------- */
    const last = ROWS - 1;
    for (const n of kept) {
      if (n.type === 'boss') continue;
      const r = n.row;
      if (r === 0) { n.type = 'combat'; continue; }
      if (r === last - 1) { n.type = rng.chance(0.75) ? 'rest' : 'shop'; continue; }

      const roll = rng();
      if (r >= 2 && roll < 0.16) n.type = 'elite';
      else if (roll < 0.30) n.type = 'event';
      else if (r >= 2 && roll < 0.38) n.type = 'treasure';
      else if (r >= 2 && roll < 0.46) n.type = 'shop';
      else if (r >= 3 && roll < 0.53) n.type = 'rest';
      else n.type = 'combat';
    }

    /* guarantee at least one shop and one rest mid-sector */
    const mids = kept.filter(n => n.row > 1 && n.row < last - 1);
    if (mids.length) {
      if (!kept.some(n => n.type === 'shop')) rng.pick(mids).type = 'shop';
      if (!kept.some(n => n.type === 'rest')) rng.pick(mids).type = 'rest';
      if (!kept.some(n => n.type === 'elite') && mids.length > 2) rng.pick(mids).type = 'elite';
    }

    /* elite modifiers */
    for (const n of kept) {
      if (n.type === 'elite') n.modifier = rng.pick(C.MODIFIERS).id;
      else if (n.type === 'combat' && n.row >= 3 && rng.chance(0.16)) n.modifier = rng.pick(C.MODIFIERS).id;
    }

    /* ---------- layout ---------- */
    const padX = 90, padY = 52;
    const usableW = MW - padX * 2;
    const usableH = MH - padY * 2;
    for (const n of kept) {
      const rowsUsed = ROWS;
      n.x = padX + (n.row / (rowsUsed - 1)) * usableW;
      const cols = kept.filter(k => k.row === n.row).sort((a, b) => a.col - b.col);
      const idx = cols.indexOf(n);
      const span = cols.length;
      n.y = padY + usableH * (span === 1 ? 0.5 : (idx / (span - 1)));
      /* deterministic jitter */
      const j = U.makeRNG(n.seed);
      n.x += j.range(-14, 14);
      n.y += j.range(-12, 12);
      n.y = U.clamp(n.y, padY, MH - padY);
    }

    /* starting availability */
    for (const n of kept) if (n.row === 0) n.available = true;

    return { sector, sectorN, nodes: kept, rows: ROWS, current: null };
  }

  function advance(map, node) {
    node.visited = true;
    node.current = false;
    for (const n of map.nodes) { n.available = false; n.current = false; }
    node.current = true;
    for (const nx of node.next) if (!nx.visited) nx.available = true;
    map.lastNode = node;
  }

  /* ============================================================
     ROOM CONSTRUCTION
     ============================================================ */
  function buildRoom(node, run) {
    const sector = C.SECTORS[Math.min(3, node.sector - 1)];
    const rng = U.makeRNG(node.seed ^ 0x5f3759df);

    const room = {
      index: node.id + node.sector * 1000,
      type: node.type === 'elite' ? 'elite' : node.type === 'boss' ? 'boss' : 'combat',
      sector: node.sector,
      depth: node.depth,
      modifier: node.modifier,
      bossId: node.bossId,
      waves: [],
    };
    if (node.type === 'boss') return room;

    /* budget grows with depth, sector, and ascension */
    const base = 5 + node.depth * 1.5 + (node.sector - 1) * 5;
    let budget = base * (node.type === 'elite' ? 1.55 : 1) * (1 + (run.ascension || 0) * 0.12);

    const pool = C.ENEMIES.filter(e => e.minSector <= node.sector);
    const waveCount = node.type === 'elite' ? 1 : (node.depth < 3 ? 1 : rng.chance(0.45) ? 2 : 1);
    const extraWave = node.modifier === 'swarm' ? 1 : 0;
    const totalWaves = waveCount + extraWave;

    for (let w = 0; w < totalWaves; w++) {
      const share = budget / totalWaves;
      const wave = [];
      let spent = 0;
      let guard = 0;
      /* elite rooms: one big anchor enemy */
      if (node.type === 'elite' && w === 0) {
        const heavies = pool.filter(e => e.tier >= 3);
        const anchor = heavies.length ? rng.pick(heavies) : rng.pick(pool);
        wave.push({ id: anchor.id, count: 1 });
        spent += anchor.tier * 2.2;
      }
      while (spent < share && guard++ < 40) {
        const pick = rng.weighted(pool, e => e.weight * (e.tier <= node.sector + 1 ? 1 : 0.3));
        const cost = pick.tier * 2.1;
        let count = 1;
        if (pick.tier === 1 && share - spent > cost * 2.4) count = rng.int(2, 3);
        const existing = wave.find(x => x.id === pick.id);
        if (existing) existing.count += count; else wave.push({ id: pick.id, count });
        spent += cost * count;
      }
      if (!wave.length) wave.push({ id: 'husk', count: 2 });
      room.waves.push(wave);
    }
    return room;
  }

  /* ============================================================
     HOVER PREVIEW
     Every node and edge reachable from `node` by following .next.
     Cached, because draw() runs every frame but the hover rarely changes.
     ============================================================ */
  let _closureCache = { id: null, res: null };

  function forwardClosure(node) {
    if (_closureCache.id === node.id && _closureCache.res) return _closureCache.res;
    const nodes = new Set([node]);
    const edges = new Set();
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      for (const nx of n.next) {
        edges.add(n.id + '>' + nx.id);
        if (!nodes.has(nx)) { nodes.add(nx); stack.push(nx); }
      }
    }
    const res = { nodes, edges };
    _closureCache = { id: node.id, res };
    return res;
  }

  /* call when the graph itself changes (new sector) */
  function resetHoverCache() { _closureCache = { id: null, res: null }; }

  /* ============================================================
     DRAWING
     ============================================================ */
  function draw(ctx, map, hover, t) {
    const S = map.sector;
    ctx.setTransform(DV.RENDER.mq, 0, 0, DV.RENDER.mq, 0, 0);
    ctx.clearRect(0, 0, MW, MH);

    /* backdrop */
    const g = ctx.createLinearGradient(0, 0, MW, MH);
    g.addColorStop(0, U.rgba(S.color, 0.05));
    g.addColorStop(1, U.rgba(S.accent, 0.03));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, MW, MH);

    /* faint grid */
    ctx.strokeStyle = U.rgba(S.color, 0.05);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < MW; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, MH); }
    for (let y = 0; y < MH; y += 40) { ctx.moveTo(0, y); ctx.lineTo(MW, y); }
    ctx.stroke();

    /* ---- edges ----
       Four tiers, drawn in order so the important ones land on top. Hovering
       any node lights every route reachable from it and mutes everything else. */
    const cl = hover ? forwardClosure(hover) : null;

    const edgePath = (n, nx) => {
      const mx = (n.x + nx.x) / 2;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.bezierCurveTo(mx, n.y, mx, nx.y, nx.x, nx.y);
    };

    const tiers = [[], [], [], []];   /* 0 base, 1 walked, 2 live, 3 highlighted */
    for (const n of map.nodes) {
      for (const nx of n.next) {
        const hi = cl && cl.edges.has(n.id + '>' + nx.id);
        if (hi) tiers[3].push([n, nx]);
        else if (n.current && nx.available) tiers[2].push([n, nx]);
        else if (n.visited && nx.visited) tiers[1].push([n, nx]);
        else tiers[0].push([n, nx]);
      }
    }
    /* everything outside a hovered route recedes */
    const mute = cl ? 0.28 : 1;

    ctx.save();
    ctx.lineCap = 'round';

    ctx.strokeStyle = U.rgba('#968ec3', 0.38 * mute);
    ctx.lineWidth = 2;
    for (const [n, nx] of tiers[0]) { edgePath(n, nx); ctx.stroke(); }

    ctx.strokeStyle = U.rgba(S.color, 0.45 * mute);
    ctx.lineWidth = 2.2;
    for (const [n, nx] of tiers[1]) { edgePath(n, nx); ctx.stroke(); }

    ctx.strokeStyle = U.rgba(S.color, 0.9 * mute);
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -t * 26;
    ctx.shadowColor = S.color; ctx.shadowBlur = 12;
    for (const [n, nx] of tiers[2]) { edgePath(n, nx); ctx.stroke(); }
    ctx.setLineDash([]); ctx.shadowBlur = 0;

    if (tiers[3].length) {
      ctx.strokeStyle = U.rgba(S.accent, 0.92);
      ctx.lineWidth = 3.2;
      ctx.shadowColor = S.accent; ctx.shadowBlur = 14;
      for (const [n, nx] of tiers[3]) { edgePath(n, nx); ctx.stroke(); }
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    /* ---- nodes ---- */
    for (const n of map.nodes) {
      const T = NODE_TYPES[n.type];
      const isHover = hover === n;
      const r = n.type === 'boss' ? 27 : 19;
      const active = n.available;
      const pulse = active ? 1 + 0.07 * Math.sin(t * 4 + n.id) : 1;

      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(pulse * (isHover && active ? 1.14 : 1), pulse * (isHover && active ? 1.14 : 1));

      /* glow */
      if (active || n.current) {
        ctx.globalCompositeOperation = 'lighter';
        const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3);
        gg.addColorStop(0, U.rgba(T.color, 0.4));
        gg.addColorStop(1, U.rgba(T.color, 0));
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(0, 0, r * 3, 0, U.TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      /* body */
      const dim = !active && !n.visited && !n.current;
      ctx.fillStyle = n.visited ? 'rgba(20,17,34,.95)' : 'rgba(11,10,20,.95)';
      ctx.strokeStyle = dim ? 'rgba(140,132,180,.55)' : U.rgba(T.color, active ? 1 : 0.8);
      ctx.lineWidth = n.current ? 3.4 : active ? 2.6 : 1.6;
      const sides = n.type === 'boss' ? 8 : n.type === 'elite' ? 3 : n.type === 'shop' ? 4 : 6;
      U.poly(ctx, 0, 0, sides, r, null, n.type === 'elite' ? -Math.PI / 2 : (n.type === 'shop' ? Math.PI / 4 : 0));
      ctx.fill(); ctx.stroke();

      /* modifier ring */
      if (n.modifier && !n.visited) {
        const mod = C.MODIFIERS.find(m => m.id === n.modifier);
        ctx.strokeStyle = U.rgba(mod ? mod.color : '#fff', 0.6);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      /* glyph */
      ctx.fillStyle = dim ? 'rgba(168,160,205,.8)' : T.color;
      ctx.font = `700 ${n.type === 'boss' ? 24 : 17}px "Rajdhani",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(T.glyph, 0, 1);

      /* visited tick */
      if (n.visited && !n.current) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#7dff9b'; ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-5, 0); ctx.lineTo(-1, 5); ctx.lineTo(6, -5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* on a hovered route */
      if (cl && cl.nodes.has(n)) {
        ctx.strokeStyle = U.rgba(S.accent, isHover ? 0.95 : 0.6);
        ctx.lineWidth = isHover ? 2.6 : 1.6;
        ctx.beginPath(); ctx.arc(0, 0, r + (isHover ? 12 : 7), 0, U.TAU); ctx.stroke();
      }

      /* current marker */
      if (n.current) {
        ctx.strokeStyle = U.rgba('#ffffff', 0.5 + 0.4 * Math.sin(t * 5));
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, r + 10, 0, U.TAU); ctx.stroke();
      }
      ctx.restore();

      /* label */
      if (active || isHover || n.type === 'boss') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '700 10.5px "Rajdhani",sans-serif';
        ctx.fillStyle = U.rgba(T.color, active || isHover ? 0.95 : 0.8);
        ctx.fillText(T.name.toUpperCase(), n.x, n.y + r + 16);
        if (n.modifier) {
          const mod = C.MODIFIERS.find(m => m.id === n.modifier);
          ctx.font = '600 9px "Rajdhani",sans-serif';
          ctx.fillStyle = U.rgba(mod ? mod.color : '#fff', 0.85);
          ctx.fillText(mod ? mod.name.toUpperCase() : '', n.x, n.y + r + 28);
        }
        ctx.restore();
      }
    }

    /* row markers */
    ctx.save();
    ctx.font = '600 9px "Rajdhani",sans-serif';
    ctx.fillStyle = 'rgba(154,149,180,.9)';
    ctx.textAlign = 'center';
    for (let r = 0; r < map.rows; r++) {
      const xs = map.nodes.filter(n => n.row === r);
      if (!xs.length) continue;
      const x = xs.reduce((a, n) => a + n.x, 0) / xs.length;
      ctx.fillText(r === map.rows - 1 ? 'BOSS' : String(r + 1), x, MH - 12);
    }
    ctx.restore();
  }

  function hitTest(map, mx, my) {
    for (const n of map.nodes) {
      const r = n.type === 'boss' ? 30 : 24;
      if (U.dist(mx, my, n.x, n.y) < r) return n;
    }
    return null;
  }

  return { generate, advance, buildRoom, draw, hitTest, forwardClosure, resetHoverCache, NODE_TYPES, MW, MH };
})();
