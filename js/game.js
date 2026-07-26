/* ============================================================
   DEADMAN VOLLEY — game.js
   Boot, main loop, run lifecycle, rewards/shops/events,
   persistence, and the ambient menu renderer.
   ============================================================ */
(function () {
  const U = DV.U, FX = DV.FX, R = U.rnd, A = DV.Audio, C = DV.Content, IN = DV.Input, UI = DV.UI;

  const W = 1280, H = 720;
  const SAVE_META = 'dv_meta_v1';
  const SAVE_SET = 'dv_settings_v1';
  const SAVE_RUN = 'dv_run_v1';

  const Game = {
    canvas: null, ctx: null,
    mode: 'menu',            // menu | game
    paused: false,
    arena: null,
    run: null,
    meta: null,
    settings: null,
    last: 0,
    ambient: null,
    shopStock: null,
    pendingNode: null,
  };
  DV.Game = Game;

  /* ============================================================
     PERSISTENCE
     ============================================================ */
  const DEFAULT_SETTINGS = {
    volMaster: 0.85, volSfx: 0.9, volMusic: 0.5,
    shake: 1, particles: 1, flashes: true, dmgNumbers: true, aimAssist: true,
  };
  const DEFAULT_META = {
    resolve: 0, runs: 0, wins: 0, bestRally: 0, totalKills: 0, totalDamageTaken: 0,
    upgrades: {}, unlocks: {}, seen: {}, deepestSector: 1,
  };

  function loadJSON(key, def) {
    try {
      const s = localStorage.getItem(key);
      if (!s) return JSON.parse(JSON.stringify(def));
      return Object.assign(JSON.parse(JSON.stringify(def)), JSON.parse(s));
    } catch (e) { return JSON.parse(JSON.stringify(def)); }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }

  Game.saveMeta = () => saveJSON(SAVE_META, Game.meta);
  Game.saveSettings = () => saveJSON(SAVE_SET, Game.settings);
  Game.wipeSave = () => {
    try {
      localStorage.removeItem(SAVE_META);
      localStorage.removeItem(SAVE_RUN);
    } catch (e) { }
    Game.meta = JSON.parse(JSON.stringify(DEFAULT_META));
    UI.renderTitle();
  };

  Game.applySettings = () => {
    const s = Game.settings;
    A.setVol('master', s.volMaster);
    A.setVol('sfx', s.volSfx);
    A.setVol('music', s.volMusic);
    FX.setSettings({ shake: s.shake, particles: s.particles, flashes: s.flashes ? 1 : 0 });
  };

  /* ---------- run save/resume ---------- */
  Game.hasSavedRun = () => {
    try { return !!localStorage.getItem(SAVE_RUN); } catch (e) { return false; }
  };
  function saveRun() {
    if (!Game.run) return;
    const r = Game.run;
    if (!r.map) return;
    saveJSON(SAVE_RUN, {
      seed: r.seed, vessel: r.vessel.id,
      sigils: r.sigils.map(s => s.id), techs: r.techs.slice(),
      hp: r.hp, ki: r.ki, shards: r.shards, shardsEarned: r.shardsEarned,
      sectorN: r.sectorN, roomsCleared: r.roomsCleared, kills: r.kills,
      parries: r.parries, perfects: r.perfects, bestRally: r.bestRally,
      damageDealt: r.damageDealt, damageTaken: r.damageTaken,
      deadmanStacks: r.deadmanStacks, eventBonuses: r.eventBonuses,
      usedEvents: r.usedEvents,
      mapVisited: r.map.nodes.filter(n => n.visited).map(n => n.id),
      mapCurrent: r.map.lastNode ? r.map.lastNode.id : null,
    });
  }
  function clearRunSave() { try { localStorage.removeItem(SAVE_RUN); } catch (e) { } }

  Game.continueRun = function () {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_RUN)); } catch (e) { d = null; }
    if (!d) { UI.toast('No saved run', '#ff4d5e'); return; }
    const vessel = C.VESSEL_MAP[d.vessel] || C.VESSELS[0];
    const run = newRun(vessel, d.seed);
    run.sigils = (d.sigils || []).map(id => C.SIGIL_MAP[id]).filter(Boolean);
    run.techs = d.techs || run.techs;
    run.shards = d.shards; run.shardsEarned = d.shardsEarned || 0;
    run.sectorN = d.sectorN; run.roomsCleared = d.roomsCleared || 0;
    run.kills = d.kills || 0; run.parries = d.parries || 0; run.perfects = d.perfects || 0;
    run.bestRally = d.bestRally || 0;
    run.damageDealt = d.damageDealt || 0; run.damageTaken = d.damageTaken || 0;
    run.deadmanStacks = d.deadmanStacks || 0;
    run.eventBonuses = d.eventBonuses || {};
    run.usedEvents = d.usedEvents || [];
    Game.run = run;
    rebuildStats(run, true);
    run.hp = U.clamp(d.hp, 1, run.stats.maxHp);
    run.ki = d.ki || 0;

    run.map = DV.MapGen.generate(run.sectorN, run.seed);
    const byId = {};
    for (const n of run.map.nodes) byId[n.id] = n;
    for (const id of (d.mapVisited || [])) if (byId[id]) byId[id].visited = true;
    if (d.mapCurrent != null && byId[d.mapCurrent]) {
      DV.MapGen.advance(run.map, byId[d.mapCurrent]);
      for (const id of (d.mapVisited || [])) if (byId[id]) byId[id].visited = true;
      for (const n of run.map.nodes) if (n.visited) n.available = false;
    } else {
      for (const n of run.map.nodes) if (n.row === 0 && !n.visited) n.available = true;
    }
    Game.mode = 'menu';
    UI.renderMap();
    UI.toast('Run resumed', '#6be6ff');
  };

  /* ============================================================
     STAT BUILDING
     ============================================================ */
  const SET_KEYS = new Set(['critMult']);

  function mergeStats(st, deltas, curseSoften) {
    for (const k in deltas) {
      let v = deltas[k];
      if (curseSoften) {
        if (k.endsWith('Mult')) v = v < 1 ? v + (1 - v) * curseSoften : v;
        else if (v < 0) v = v * (1 - curseSoften);
      }
      if (SET_KEYS.has(k)) { st[k] = Math.max(st[k] || 0, v); }
      else if (k.endsWith('Mult')) { st[k] = (st[k] != null ? st[k] : 1) * v; }
      else { st[k] = (st[k] || 0) + v; }
    }
  }

  function rebuildStats(run, initial) {
    const oldMax = run.stats ? run.stats.maxHp : null;
    const st = JSON.parse(JSON.stringify(C.BASE_STATS));
    st.powerMult = 1; st.maxHpMult = 1;

    /* meta upgrades */
    const m = Game.meta;
    for (const up of C.META) {
      const rank = (m.upgrades && m.upgrades[up.id]) || 0;
      if (rank > 0) { try { up.apply(st, rank); } catch (e) { } }
    }
    const curseSoften = st.curseSoften || 0;

    /* vessel */
    mergeStats(st, run.vessel.stats || {});

    /* sigils */
    for (const s of run.sigils) {
      if (s.stats) mergeStats(st, s.stats, s.rarity === 'cursed' ? curseSoften : 0);
    }

    /* event bonuses */
    if (run.eventBonuses) mergeStats(st, run.eventBonuses);

    /* finalise */
    st.maxHp = Math.max(20, Math.round(st.maxHp * (st.maxHpMult || 1)));
    st.dashCharges = Math.max(1, Math.round(st.dashCharges));
    st.basePowerMult = st.powerMult;
    if (run.deadmanStacks) st.powerMult *= 1 + run.deadmanStacks * 0.02;

    run.stats = st;
    if (initial) {
      run.hp = st.maxHp;
      run.ki = st.kiMax * 0.5;
    } else if (oldMax != null) {
      const delta = st.maxHp - oldMax;
      if (delta > 0) run.hp += delta;
      run.hp = U.clamp(run.hp, 1, st.maxHp);
    }
    return st;
  }
  Game.rebuildStats = rebuildStats;

  /* ============================================================
     RUN LIFECYCLE
     ============================================================ */
  function newRun(vessel, seed) {
    const run = {
      seed: seed != null ? seed : (Math.random() * 0xffffffff) >>> 0,
      vessel, sigils: [], techs: [vessel.tech],
      stats: null, hp: 100, ki: 0,
      shards: 0, shardsEarned: 0,
      sectorN: 1, map: null,
      roomsCleared: 0, kills: 0, parries: 0, perfects: 0, bestRally: 0,
      damageDealt: 0, damageTaken: 0, deadmanStacks: 0,
      eventBonuses: {}, usedEvents: [], ascension: 0,
      enraged: false, deathCause: null,
      startedAt: Date.now(),
    };
    return run;
  }

  Game.startRun = function (vessel) {
    const run = newRun(vessel);
    Game.run = run;
    rebuildStats(run, true);
    run.shards = Math.round(run.stats.startShards || 100);

    /* meta: extra technique */
    if (run.stats.extraTech) {
      const pool = C.TECHNIQUES.filter(t => t.id !== vessel.tech);
      run.techs.push(U.rnd.pick(pool).id);
    }

    run.map = DV.MapGen.generate(1, run.seed);
    Game.meta.runs = (Game.meta.runs || 0) + 1;
    Game.saveMeta();
    saveRun();
    Game.mode = 'menu';
    UI.renderMap();
    UI.toast('Sector I — ' + C.SECTORS[0].name, C.SECTORS[0].color);
  };

  Game.abandonRun = function () {
    clearRunSave();
    Game.run = null;
    Game.arena = null;
    Game.mode = 'menu';
    Game.paused = false;
    UI.hideOverlay();
    UI.renderTitle();
  };

  /* ---------- entering a node ---------- */
  Game.enterNode = function (node) {
    const run = Game.run;
    Game.pendingNode = node;
    run.currentNodeType = node.type;

    if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
      const room = DV.MapGen.buildRoom(node, run);
      startCombat(room);
    } else if (node.type === 'event') {
      openEvent(node);
    } else if (node.type === 'shop') {
      openShop(node);
    } else if (node.type === 'rest') {
      openRest(node);
    } else if (node.type === 'treasure') {
      openTreasure(node);
    }
  };

  function startCombat(room) {
    FX.reset();
    Game.arena = new DV.Arena(Game, room);
    Game.mode = 'game';
    Game.paused = false;
    UI.show(null);
    UI.hideOverlay();
    IN.clearAll();
    /* codex discovery */
    for (const w of (room.waves || [])) for (const g of w) Game.meta.seen['e_' + g.id] = 1;
    if (room.bossId) Game.meta.seen['b_' + room.bossId] = 1;
    Game.saveMeta();
  }

  /* ---------- room cleared ---------- */
  Game.onRoomCleared = function (arena) {
    const run = Game.run;
    const node = Game.pendingNode;
    run.hp = arena.player.hp;
    run.ki = arena.player.ki;
    run.roomsCleared++;
    Game.mode = 'menu';
    Game.arena = null;

    if (node.type === 'boss') {
      onBossDefeated(node);
      return;
    }

    DV.MapGen.advance(run.map, node);
    /* shard reward */
    const bonus = Math.round((22 + node.depth * 5) * (node.type === 'elite' ? 2.2 : 1) * (run.stats.shardMult || 1));
    run.shards += bonus; run.shardsEarned += bonus;

    const chance = node.type === 'elite' ? 1 : 0.34 + (run.stats.luck || 0) * 0.04;
    if (Math.random() < chance) {
      offerSigils(node.type === 'elite' ? 'elite' : 'normal', () => { saveRun(); UI.renderMap(); });
    } else {
      UI.toast('+' + bonus + ' Shards', '#ffcf6b');
      saveRun();
      UI.renderMap();
    }
  };

  function onBossDefeated(node) {
    const run = Game.run;
    DV.MapGen.advance(run.map, node);
    Game.meta.deepestSector = Math.max(Game.meta.deepestSector || 1, run.sectorN);
    checkUnlocks(true);

    const shards = Math.round(180 * run.sectorN * (run.stats.shardMult || 1));
    run.shards += shards; run.shardsEarned += shards;

    /* boss reward: a strong sigil or a technique */
    const offerTech = run.techs.length < 2 || Math.random() < 0.4;
    if (offerTech) {
      const owned = new Set(run.techs);
      const pool = C.TECHNIQUES.filter(t => !owned.has(t.id));
      const picks = U.rnd.pick ? shuffle(pool).slice(0, 3) : pool.slice(0, 3);
      const offers = picks.map(t => ({ kindType: 'tech', data: t }));
      UI.renderReward('Warden Slain', `+${shards} Shards. Claim a technique.`, offers, (o) => {
        if (run.techs.length < 2) run.techs.push(o.data.id);
        else run.techs[1] = o.data.id;
        A.play('levelup');
        UI.toast('Learned ' + o.data.name, o.data.color);
        afterBoss();
      }, 'Take a sigil instead');
      UI.skipBtn.onclick = () => {
        A.play('ui_click');
        offerSigils('boss', afterBoss);
      };
    } else {
      offerSigils('boss', afterBoss);
    }
  }

  function afterBoss() {
    const run = Game.run;
    run.sectorN++;
    if (run.sectorN > 4) { Game.onRunEnd(true); return; }
    /* between-sector heal */
    const heal = Math.round(run.stats.maxHp * 0.35);
    run.hp = Math.min(run.stats.maxHp, run.hp + heal);
    run.map = DV.MapGen.generate(run.sectorN, run.seed);
    saveRun();
    const S = C.SECTORS[run.sectorN - 1];
    UI.renderMap();
    UI.toast(`Sector ${U.roman(run.sectorN)} — ${S.name}  ·  +${heal} HP`, S.color);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ============================================================
     SIGIL OFFERS
     ============================================================ */
  function rarityRoll(tier) {
    const luck = (Game.run.stats.luck || 0);
    let table;
    if (tier === 'boss') table = [['relic', 22 + luck * 3], ['epic', 44], ['rare', 30], ['cursed', 12]];
    else if (tier === 'elite') table = [['relic', 6 + luck * 2], ['epic', 26 + luck * 3], ['rare', 42], ['common', 22], ['cursed', 16]];
    else if (tier === 'treasure') table = [['relic', 4 + luck], ['epic', 20 + luck * 2], ['rare', 40], ['common', 34], ['cursed', 12]];
    else table = [['relic', 1 + luck], ['epic', 9 + luck * 2], ['rare', 30], ['common', 52], ['cursed', 14]];
    let total = 0; for (const t of table) total += t[1];
    let x = Math.random() * total;
    for (const t of table) { x -= t[1]; if (x <= 0) return t[0]; }
    return 'common';
  }

  function pickSigils(n, tier) {
    const owned = new Set(Game.run.sigils.map(s => s.id));
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 200) {
      const rar = rarityRoll(tier);
      const pool = C.SIGILS.filter(s => s.rarity === rar && !owned.has(s.id) && !out.some(o => o.id === s.id));
      if (!pool.length) continue;
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    if (!out.length) {
      const pool = C.SIGILS.filter(s => !owned.has(s.id));
      if (pool.length) out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return out;
  }

  function offerSigils(tier, done) {
    const run = Game.run;
    let count = tier === 'normal' ? 2 : 3;
    count += (run.stats.extraChoice || 0);
    const picks = pickSigils(count, tier);
    if (!picks.length) { done(); return; }
    const offers = picks.map(s => ({ kindType: 'sigil', data: s }));
    const titles = { boss: 'Warden Spoils', elite: 'Elite Spoils', treasure: 'The Cache', normal: 'Spoils' };
    UI.renderReward(titles[tier] || 'Spoils', 'Take one. Only one.', offers, (o) => {
      grantSigil(o.data);
      done();
    });
    UI.skipBtn.textContent = 'Skip (+45 Shards)';
    UI.skipBtn.style.display = '';
    UI.skipBtn.onclick = () => {
      A.play('ui_click');
      run.shards += 45; run.shardsEarned += 45;
      UI.toast('+45 Shards', '#ffcf6b');
      done();
    };
  }

  function grantSigil(s) {
    const run = Game.run;
    run.sigils.push(s);
    rebuildStats(run);
    /* run-start hook */
    if (s.hooks && s.hooks.onAcquire) { try { s.hooks.onAcquire(run); } catch (e) { } }
    A.play('levelup');
    UI.toast('Bound: ' + s.name, C.RARITY[s.rarity].color);
    saveRun();
  }
  Game.grantSigil = grantSigil;

  /* ============================================================
     TREASURE
     ============================================================ */
  function openTreasure(node) {
    DV.MapGen.advance(Game.run.map, node);
    Game.run.roomsCleared++;
    offerSigils('treasure', () => { saveRun(); UI.renderMap(); });
  }

  /* ============================================================
     SHOP
     ============================================================ */
  function openShop(node) {
    const run = Game.run;
    DV.MapGen.advance(run.map, node);
    const disc = 1 - (run.stats.shopDiscount || 0);
    /* Services first, then sigils fill the rest: the shop is capped at five
       items so it is always a single readable row of cards. */
    const SHOP_SLOTS = 5;
    const services = [];
    services.push({
      type: 'service', id: 'heal', price: Math.round(110 * disc),
      data: {
        glyph: '✚', kind: 'Service', name: 'Field Surgery', color: '#7dff9b',
        sub: 'Instant', desc: `Restore ${Math.round(run.stats.maxHp * 0.4)} vitality.`,
        flavor: 'It is not clean, but it is quick.'
      }
    });
    services.push({
      type: 'service', id: 'maxhp', price: Math.round(190 * disc),
      data: {
        glyph: '❤', kind: 'Service', name: 'Reinforce Vessel', color: '#ff4d5e',
        sub: 'Permanent', desc: '+18 max vitality, and heal that much.',
        flavor: 'More of you to lose.'
      }
    });
    /* only offered once there is something worth shedding */
    if (run.sigils.length >= 3) {
      services.push({
        type: 'service', id: 'purge', price: Math.round(140 * disc),
        data: {
          glyph: '⌫', kind: 'Service', name: 'Sever a Sigil', color: '#9a95b4',
          sub: 'Removes one', desc: 'Destroy your lowest-value sigil. Useful for shedding curses.',
          flavor: 'Some bindings were mistakes.'
        }
      });
    }

    const stock = [];
    for (const s of pickSigils(Math.max(1, SHOP_SLOTS - services.length), 'treasure')) {
      stock.push({
        type: 'sigil', data: s,
        price: Math.round(C.RARITY[s.rarity].price * disc * (1 + (run.sectorN - 1) * 0.12))
      });
    }
    stock.push(...services);

    Game.shopStock = stock;
    UI.renderShop(stock, onBuy, Game.leaveShop);
  }

  function onBuy(item) {
    const run = Game.run;
    if (item.sold || run.shards < item.price) { A.play('ui_deny'); return; }
    run.shards -= item.price;
    if (item.type === 'sigil') {
      item.sold = true;
      grantSigil(item.data);
    } else if (item.type === 'tech') {
      item.sold = true;
      if (run.techs.length < 2) run.techs.push(item.data.id); else run.techs[1] = item.data.id;
      UI.toast('Learned ' + item.data.name, item.data.color);
    } else {
      if (item.id === 'heal') {
        const amt = Math.round(run.stats.maxHp * 0.4);
        run.hp = Math.min(run.stats.maxHp, run.hp + amt);
        UI.toast('+' + amt + ' Vitality', '#7dff9b');
        A.play('heal');
        item.sold = true;
      } else if (item.id === 'maxhp') {
        run.eventBonuses.maxHp = (run.eventBonuses.maxHp || 0) + 18;
        rebuildStats(run);
        run.hp = Math.min(run.stats.maxHp, run.hp + 18);
        UI.toast('+18 Max Vitality', '#ff4d5e');
        A.play('levelup');
        item.sold = true;
      } else if (item.id === 'purge') {
        const order = ['cursed', 'common', 'rare', 'epic', 'relic'];
        run.sigils.sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
        const gone = run.sigils.shift();
        rebuildStats(run);
        UI.toast('Severed: ' + gone.name, '#9a95b4');
        A.play('shield_break');
        item.sold = true;
      }
    }
    saveRun();
    UI.renderShop(Game.shopStock, onBuy, Game.leaveShop);
  }

  Game.leaveShop = function () {
    saveRun();
    UI.renderMap();
  };

  /* ============================================================
     REST
     ============================================================ */
  function openRest(node) {
    const run = Game.run;
    DV.MapGen.advance(run.map, node);
    const healPct = 0.4 + (run.stats.restBonus || 0);
    const opts = [
      {
        id: 'sleep', glyph: '✚', kind: 'Rest', name: 'Sleep', color: '#7dff9b',
        sub: 'Recover', desc: `Restore ${Math.round(healPct * 100)}% of max vitality (${Math.round(run.stats.maxHp * healPct)} HP).`,
        flavor: 'The dead do not dream. It is restful anyway.'
      },
      {
        id: 'forge', glyph: '⚒', kind: 'Rest', name: 'Temper', color: '#ffcf6b',
        sub: 'Permanent', desc: '+14 max vitality and +6% damage for the rest of the run.',
        flavor: 'Heat, fold, repeat.'
      },
      {
        id: 'attune', glyph: '◈', kind: 'Rest', name: 'Attune', color: '#6be6ff',
        sub: 'Technique', desc: 'Replace a technique with a random new one, and gain +20 max Ki.',
        flavor: 'Unlearn something. Make room.'
      },
      {
        id: 'scavenge', glyph: '⛏', kind: 'Rest', name: 'Scavenge', color: '#b46bff',
        sub: 'Shards', desc: `Gain ${Math.round(150 * (run.stats.shardMult || 1))} shards and restore 12% vitality.`,
        flavor: 'Somebody left in a hurry.'
      },
    ];
    UI.renderRest(opts, (o) => {
      if (o.id === 'sleep') {
        const amt = Math.round(run.stats.maxHp * healPct);
        run.hp = Math.min(run.stats.maxHp, run.hp + amt);
        A.play('heal'); UI.toast('+' + amt + ' Vitality', '#7dff9b');
      } else if (o.id === 'forge') {
        run.eventBonuses.maxHp = (run.eventBonuses.maxHp || 0) + 14;
        run.eventBonuses.powerMult = (run.eventBonuses.powerMult || 1) * 1.06;
        rebuildStats(run);
        run.hp += 14;
        A.play('levelup'); UI.toast('Tempered: +14 HP, +6% damage', '#ffcf6b');
      } else if (o.id === 'attune') {
        const owned = new Set(run.techs);
        const pool = C.TECHNIQUES.filter(t => !owned.has(t.id));
        if (pool.length) {
          const t = pool[Math.floor(Math.random() * pool.length)];
          run.techs[run.techs.length - 1] = t.id;
          UI.toast('Attuned: ' + t.name, t.color);
        }
        run.eventBonuses.kiMax = (run.eventBonuses.kiMax || 0) + 20;
        rebuildStats(run);
        A.play('tech');
      } else if (o.id === 'scavenge') {
        const amt = Math.round(150 * (run.stats.shardMult || 1));
        run.shards += amt; run.shardsEarned += amt;
        run.hp = Math.min(run.stats.maxHp, run.hp + Math.round(run.stats.maxHp * 0.12));
        A.play('shards'); UI.toast('+' + amt + ' Shards', '#ffcf6b');
      }
      run.roomsCleared++;
      saveRun();
      UI.renderMap();
    });
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function openEvent(node) {
    const run = Game.run;
    DV.MapGen.advance(run.map, node);
    const pool = C.EVENTS.filter(e => run.usedEvents.indexOf(e.id) < 0);
    const ev = (pool.length ? pool : C.EVENTS)[Math.floor(Math.random() * (pool.length ? pool.length : C.EVENTS.length))];
    run.usedEvents.push(ev.id);
    UI.renderEvent(ev, (choice) => {
      resolveEvent(choice.act, choice.cost);
    });
  }

  function randomSigilOfRarity(rar) {
    const owned = new Set(Game.run.sigils.map(s => s.id));
    const pool = C.SIGILS.filter(s => s.rarity === rar && !owned.has(s.id));
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function resolveEvent(act, cost) {
    const run = Game.run;
    if (cost) run.shards -= cost;
    const done = () => { run.roomsCleared++; saveRun(); UI.renderMap(); };

    switch (act) {
      case 'trade_hp_epic': {
        run.eventBonuses.maxHp = (run.eventBonuses.maxHp || 0) - 12;
        rebuildStats(run);
        const s = randomSigilOfRarity('epic') || randomSigilOfRarity('rare');
        if (s) grantSigil(s);
        UI.toast('-12 Max Vitality', '#ff4d5e');
        done(); break;
      }
      case 'pay_heal':
        run.hp = run.stats.maxHp;
        A.play('heal'); UI.toast('Fully restored', '#7dff9b');
        done(); break;
      case 'small_shards':
        run.shards += 60; run.shardsEarned += 60;
        UI.toast('+60 Shards', '#ffcf6b'); done(); break;
      case 'elite_fight': {
        const node = Game.pendingNode;
        const room = DV.MapGen.buildRoom({ ...node, type: 'elite', depth: node.depth + 2, modifier: 'keen' }, run);
        room.type = 'elite';
        room.eventReward = true;
        startCombat(room);
        break;
      }
      case 'steal_orb': {
        const s = randomSigilOfRarity('rare');
        if (s) grantSigil(s);
        run.hp = Math.max(1, run.hp - 18);
        UI.toast('-18 Vitality', '#ff4d5e');
        done(); break;
      }
      case 'nothing': done(); break;
      case 'heal_curse': {
        run.hp = Math.min(run.stats.maxHp, run.hp + 45);
        const s = randomSigilOfRarity('cursed');
        if (s) grantSigil(s);
        A.play('heal'); done(); break;
      }
      case 'heal_25':
        run.hp = Math.min(run.stats.maxHp, run.hp + 25);
        A.play('heal'); UI.toast('+25 Vitality', '#7dff9b'); done(); break;
      case 'shards_120':
        run.shards += 120; run.shardsEarned += 120;
        UI.toast('+120 Shards', '#ffcf6b'); done(); break;
      case 'upgrade_sigil': {
        const order = ['common', 'rare', 'epic', 'relic'];
        if (!run.sigils.length) { const s = randomSigilOfRarity('rare'); if (s) grantSigil(s); done(); break; }
        const i = Math.floor(Math.random() * run.sigils.length);
        const old = run.sigils[i];
        const idx = order.indexOf(old.rarity);
        const nextRar = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : 'relic';
        const s = randomSigilOfRarity(nextRar) || randomSigilOfRarity('epic');
        if (s) {
          run.sigils.splice(i, 1, s);
          rebuildStats(run);
          A.play('levelup');
          UI.toast(old.name + ' → ' + s.name, C.RARITY[s.rarity].color);
        }
        done(); break;
      }
      case 'maxhp_12':
        run.eventBonuses.maxHp = (run.eventBonuses.maxHp || 0) + 12;
        rebuildStats(run); run.hp += 12;
        UI.toast('+12 Max Vitality', '#ff4d5e'); done(); break;
      case 'shards_90':
        run.shards += 90; run.shardsEarned += 90;
        UI.toast('+90 Shards', '#ffcf6b'); done(); break;
      case 'borrow': {
        run.shards += 250; run.shardsEarned += 250;
        const dmg = Math.round(run.stats.maxHp * 0.25);
        run.hp = Math.max(1, run.hp - dmg);
        UI.toast('+250 Shards, -' + dmg + ' Vitality', '#ffcf6b');
        done(); break;
      }
      case 'repay':
        run.eventBonuses.maxHp = (run.eventBonuses.maxHp || 0) + 20;
        rebuildStats(run);
        run.hp = run.stats.maxHp;
        A.play('heal'); UI.toast('+20 Max Vitality, fully restored', '#7dff9b');
        done(); break;
      case 'perm_perfect':
        run.eventBonuses.perfectWindowMult = (run.eventBonuses.perfectWindowMult || 1) * 1.25;
        rebuildStats(run); UI.toast('Perfect window +25%', '#ffcf6b'); done(); break;
      case 'perm_reach':
        run.eventBonuses.parryRadius = (run.eventBonuses.parryRadius || 0) + 12;
        rebuildStats(run); UI.toast('Parry reach +12', '#6be6ff'); done(); break;
      case 'perm_volley':
        run.eventBonuses.volleyDamageAdd = (run.eventBonuses.volleyDamageAdd || 0) + 0.06;
        rebuildStats(run); UI.toast('Volley damage growth +6%', '#ff6b3d'); done(); break;
      case 'sac_sigil': {
        if (run.sigils.length) {
          const i = Math.floor(Math.random() * run.sigils.length);
          const gone = run.sigils.splice(i, 1)[0];
          UI.toast('Offered: ' + gone.name, '#9a95b4');
        }
        const s = randomSigilOfRarity('relic') || randomSigilOfRarity('epic');
        rebuildStats(run);
        if (s) grantSigil(s);
        done(); break;
      }
      case 'sac_blood':
        run.hp = Math.max(1, run.hp - 30);
        run.eventBonuses.kiMax = (run.eventBonuses.kiMax || 0) + 35;
        rebuildStats(run);
        UI.toast('+35 Max Ki', '#6be6ff'); done(); break;
      case 'sac_coin': {
        const s = randomSigilOfRarity('epic') || randomSigilOfRarity('rare');
        if (s) grantSigil(s);
        done(); break;
      }
      case 'kneel':
        run.hp = Math.min(run.stats.maxHp, run.hp + 35);
        run.ki = run.stats.kiMax;
        A.play('heal'); UI.toast('+35 Vitality, Ki restored', '#7dff9b'); done(); break;
      case 'perm_speed':
        run.eventBonuses.speedMult = (run.eventBonuses.speedMult || 1) * 1.08;
        rebuildStats(run); UI.toast('Move speed +8%', '#6be6ff'); done(); break;
      case 'desecrate': {
        const s = randomSigilOfRarity(rarityRoll('treasure'));
        if (s) grantSigil(s);
        run.enraged = true;
        UI.toast('The next room is enraged', '#ff4d5e');
        done(); break;
      }
      default: done();
    }
  }

  /* ============================================================
     RUN END
     ============================================================ */
  Game.onRunEnd = function (won) {
    const run = Game.run;
    if (!run || run.ended) return;
    run.ended = true;
    Game.mode = 'menu';
    Game.arena = null;
    clearRunSave();

    /* resolve */
    let resolve = Math.round(
      run.roomsCleared * 4 +
      (run.sectorN - 1) * 45 +
      run.kills * 0.6 +
      run.perfects * 0.8 +
      run.bestRally * 3 +
      (won ? 350 : 0)
    );
    Game.meta.resolve = (Game.meta.resolve || 0) + resolve;
    if (won) Game.meta.wins = (Game.meta.wins || 0) + 1;
    Game.meta.deepestSector = Math.max(Game.meta.deepestSector || 1, run.sectorN);

    const before = Object.keys(Game.meta.unlocks || {});
    if (won) Game.meta.unlocks.win = 1;
    checkUnlocks();
    const after = Object.keys(Game.meta.unlocks || {});
    const fresh = after.filter(k => before.indexOf(k) < 0);

    Game.saveMeta();
    UI.renderEnd(won, run, resolve, fresh);
    if (won) A.play('victory');
  };

  function checkUnlocks(announce) {
    const m = Game.meta;
    m.unlocks = m.unlocks || {};
    const grant = (key) => {
      if (m.unlocks[key]) return;
      m.unlocks[key] = 1;
      const info = C.UNLOCKS[key];
      if (announce && info) UI.toast(`${info.kind} unlocked — ${info.name}`, '#ffcf6b');
    };
    if ((m.deepestSector || 1) >= 3) grant('sector2');
    if ((m.totalDamageTaken || 0) >= 400) grant('tank');
    if ((m.bestRally || 0) >= 15) grant('rally15');
    m.seen = m.seen || {};
    Game.saveMeta();
  }

  /* ============================================================
     PAUSE
     ============================================================ */
  Game.pause = function () {
    if (Game.mode !== 'game' || Game.paused) return;
    Game.paused = true;
    A.play('ui_back');
    UI.renderPause();
  };
  Game.resume = function () {
    Game.paused = false;
    UI.hideOverlay();
    IN.clearAll();
  };

  /* ============================================================
     AMBIENT MENU BACKDROP
     ============================================================ */
  function makeAmbient() {
    const orbs = [];
    for (let i = 0; i < 7; i++) {
      orbs.push({
        x: R.range(0, W), y: R.range(0, H),
        vx: R.spread(46), vy: R.spread(46),
        r: R.range(7, 20),
        c: R.pick(['#ffcf6b', '#ff4d5e', '#6be6ff', '#b46bff', '#ff6b3d']),
        trail: []
      });
    }
    const dust = [];
    for (let i = 0; i < 120; i++) {
      dust.push({ x: R.range(0, W), y: R.range(0, H), r: R.range(0.4, 1.8), a: R.range(0.05, 0.35), s: R.range(4, 20), ph: R.range(0, U.TAU) });
    }
    return { orbs, dust, t: 0 };
  }

  function drawAmbient(ctx, dt) {
    const am = Game.ambient;
    am.t += dt;
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.5, H);
    g.addColorStop(0, 'rgba(255,207,107,.05)');
    g.addColorStop(0.6, 'rgba(180,107,255,.03)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (const d of am.dust) {
      ctx.globalAlpha = d.a * (0.5 + 0.5 * Math.sin(am.t * d.s * 0.1 + d.ph));
      ctx.fillStyle = '#fff';
      ctx.fillRect(d.x, d.y, d.r, d.r);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of am.orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); }
      if (o.x > W - o.r) { o.x = W - o.r; o.vx = -Math.abs(o.vx); }
      if (o.y < o.r) { o.y = o.r; o.vy = Math.abs(o.vy); }
      if (o.y > H - o.r) { o.y = H - o.r; o.vy = -Math.abs(o.vy); }
      o.trail.push(o.x, o.y);
      while (o.trail.length > 40) o.trail.splice(0, 2);

      ctx.strokeStyle = U.rgba(o.c, 0.10);
      ctx.lineWidth = o.r * 0.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(o.trail[0], o.trail[1]);
      for (let i = 2; i < o.trail.length; i += 2) ctx.lineTo(o.trail[i], o.trail[i + 1]);
      ctx.stroke();

      const gg = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 4);
      gg.addColorStop(0, U.rgba(o.c, 0.5));
      gg.addColorStop(1, U.rgba(o.c, 0));
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 4, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.4, 0, U.TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - Game.last) / 1000 || 0);
    Game.last = ts;

    IN.pollPad();

    /* global hotkeys */
    if (Game.mode === 'game') {
      if (IN.actHit('pause')) {
        if (Game.paused) Game.resume(); else Game.pause();
      }
      if (IN.keyHit('Tab') && !Game.paused) Game.pause();
    } else {
      if (IN.actHit('pause') && UI.isOverlayOpen()) {
        UI.hideOverlay();
        A.play('ui_back');
      }
    }

    const ctx = Game.ctx;
    /* draw in logical 1280x720 units regardless of the backing-store resolution */
    ctx.setTransform(DV.RENDER.q, 0, 0, DV.RENDER.q, 0, 0);
    if (Game.mode === 'game' && Game.arena) {
      const arena = Game.arena;
      if (!Game.paused) arena.update(dt);
      /* update() can end the room or the run, which clears Game.arena */
      if (Game.arena === arena) {
        arena.draw(ctx);
        if (Game.paused) {
          ctx.fillStyle = 'rgba(5,5,10,.55)';
          ctx.fillRect(0, 0, W, H);
        }
      } else {
        drawAmbient(ctx, dt);
      }
    } else {
      drawAmbient(ctx, dt);
      UI.tickMap(dt);
    }

    IN.endFrame();
  }

  /* ============================================================
     BOOT
     ============================================================ */
  /* The game is authored in a fixed 1280x720 space. `q` is how many real device
     pixels back each logical pixel, so text and vector art stay crisp on HiDPI
     displays instead of being upscaled from a 720p buffer. */
  function resize() {
    const pad = 24;
    const sx = (window.innerWidth - pad) / W;
    const sy = (window.innerHeight - pad) / H;
    const s = Math.max(0.3, Math.min(sx, sy));
    document.getElementById('frame').style.setProperty('--scale', s);

    const dpr = window.devicePixelRatio || 1;
    const q = U.clamp(s * dpr, 1, 2.5);
    DV.RENDER.q = q;

    const cv = Game.canvas;
    if (cv) {
      const pw = Math.round(W * q), ph = Math.round(H * q);
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw; cv.height = ph;
        Game.ctx = cv.getContext('2d', { alpha: false });
      }
    }
    const mc = document.getElementById('mapcanvas');
    if (mc) {
      const MW = DV.MapGen.MW, MH = DV.MapGen.MH;
      const mq = U.clamp(dpr, 1, 2.5);
      const pw = Math.round(MW * mq), ph = Math.round(MH * mq);
      if (mc.width !== pw || mc.height !== ph) {
        mc.width = pw; mc.height = ph;
        mc.style.width = MW + 'px'; mc.style.height = MH + 'px';
      }
      DV.RENDER.mq = mq;
    }
  }

  function boot() {
    Game.canvas = document.getElementById('game');
    Game.ctx = Game.canvas.getContext('2d', { alpha: false });
    Game.ctx.textBaseline = 'middle';

    Game.settings = loadJSON(SAVE_SET, DEFAULT_SETTINGS);
    Game.meta = loadJSON(SAVE_META, DEFAULT_META);
    Game.meta.upgrades = Game.meta.upgrades || {};
    Game.meta.unlocks = Game.meta.unlocks || {};
    Game.meta.seen = Game.meta.seen || {};
    Game.ambient = makeAmbient();

    IN.attach(Game.canvas);
    UI.init(Game);
    Game.applySettings();

    resize();
    window.addEventListener('resize', resize);

    /* audio unlock */
    const cc = document.getElementById('clickcatch');
    const unlock = () => {
      A.init(); A.resume();
      Game.applySettings();
      cc.classList.add('gone');
      UI.renderTitle();
      window.removeEventListener('keydown', unlock);
    };
    cc.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);

    /* keep audio alive after tab switches */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) A.resume();
      else if (Game.mode === 'game' && !Game.paused) Game.pause();
    });

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
