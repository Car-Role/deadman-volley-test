/* ============================================================
   DEADMAN VOLLEY — ui.js
   DOM screen management: title, vessel select, map, rewards,
   shop, rest, events, pause, settings, codex, shrine, end.
   ============================================================ */
DV.UI = (function () {
  const U = DV.U, C = DV.Content, A = DV.Audio;

  let G = null;                 // game ref, set by game.js
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  const SCREENS = ['scr-title', 'scr-char', 'scr-map', 'scr-reward', 'scr-shop', 'scr-rest',
    'scr-event', 'scr-pause', 'scr-settings', 'scr-codex', 'scr-meta', 'scr-end'];
  let current = null;
  let overlay = null;           // pause/settings/codex layered on top
  let returnFrom = null;

  function show(id) {
    for (const s of SCREENS) $(s).classList.remove('on');
    current = id;
    if (id) $(id).classList.add('on');
    hideTooltip();
  }
  function showOverlay(id) {
    if (overlay) $(overlay).classList.remove('on');
    overlay = id;
    if (id) $(id).classList.add('on');
  }
  function hideOverlay() {
    if (overlay) $(overlay).classList.remove('on');
    overlay = null;
  }
  function isOverlayOpen() { return !!overlay; }
  function currentScreen() { return current; }

  /* ============================================================
     TOASTS + TOOLTIP
     ============================================================ */
  function toast(text, color) {
    const t = el('div', 'toast', text);
    if (color) t.style.setProperty('--accent', color);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  const tip = () => $('tooltip');
  function showTooltip(e, data) {
    const t = tip();
    t.style.setProperty('--accent', data.color || '#9a95b4');
    t.innerHTML = `${data.kind ? `<div class="tt-kind">${data.kind}</div>` : ''}
      <h5>${data.name}</h5>
      <p>${data.desc || ''}</p>
      ${data.flavor ? `<div class="fl">“${data.flavor}”</div>` : ''}`;
    t.style.display = 'block';
    positionTooltip(e);
  }
  function positionTooltip(e) {
    const t = tip();
    const stage = $('ui').getBoundingClientRect();
    const scale = stage.width / 1280;
    let x = (e.clientX - stage.left) / scale + 16;
    let y = (e.clientY - stage.top) / scale + 16;
    const r = t.getBoundingClientRect();
    const w = r.width / scale, h = r.height / scale;
    if (x + w > 1280 - 12) x = x - w - 32;
    if (y + h > 720 - 12) y = 720 - h - 12;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  function hideTooltip() { tip().style.display = 'none'; }
  function bindTip(node, data) {
    node.addEventListener('mouseenter', e => showTooltip(e, data));
    node.addEventListener('mousemove', e => positionTooltip(e));
    node.addEventListener('mouseleave', hideTooltip);
  }

  /* cards wrap onto a second row past 4 — shrink them so both rows fit */
  function fitCards(row) {
    row.classList.toggle('dense', row.children.length > 4);
  }

  function click(node, fn) {
    node.addEventListener('click', e => { A.play('ui_click'); fn(e); });
    node.addEventListener('mouseenter', () => A.play('ui_move'));
  }

  /* ============================================================
     TITLE
     ============================================================ */
  function renderTitle() {
    $('title-version').textContent = 'v' + DV.VERSION;
    const m = G.meta;
    const runs = m.runs || 0, wins = m.wins || 0;
    $('title-stats').textContent = `${runs} descent${runs === 1 ? '' : 's'} · ${wins} clear${wins === 1 ? '' : 's'} · best rally ×${m.bestRally || 0}`;
    const cont = $('title-menu').querySelector('[data-act="continue"]');
    cont.disabled = !G.hasSavedRun();
    show('scr-title');
    A.setMusic('menu');
  }

  /* ============================================================
     VESSEL SELECT
     ============================================================ */
  let selVessel = 0;
  function renderCharSelect() {
    const list = $('char-list');
    list.innerHTML = '';
    C.VESSELS.forEach((v, i) => {
      const unlocked = isVesselUnlocked(v);
      const item = el('div', 'char-item' + (i === selVessel ? ' sel' : '') + (unlocked ? '' : ' locked'));
      item.innerHTML = `
        <div class="char-chip" style="background:radial-gradient(circle at 35% 30%,#ffffff40,transparent 60%),${v.color}">${unlocked ? v.glyph : '🔒'}</div>
        <div>
          <h3>${unlocked ? v.name : '???'}</h3>
          <p>${unlocked ? v.title : v.unlockText}</p>
        </div>`;
      click(item, () => { selVessel = i; renderCharSelect(); });
      list.appendChild(item);
    });
    renderCharDetail();
    show('scr-char');
  }

  function isVesselUnlocked(v) {
    if (v.unlocked) return true;
    return !!(G.meta.unlocks && G.meta.unlocks[v.unlockKey]);
  }

  function renderCharDetail() {
    const v = C.VESSELS[selVessel];
    const unlocked = isVesselUnlocked(v);
    const d = $('char-detail');
    const t = C.TECH_MAP[v.tech];
    const bar = (label, val, max) => `
      <div class="stat-row"><span>${label}</span>
      <div class="bar"><i style="width:${(val / max) * 100}%"></i></div>
      <b>${val}</b></div>`;
    d.innerHTML = `
      <div class="cd-name" style="color:${v.color}">${unlocked ? v.name : 'LOCKED'}</div>
      <div class="cd-title">${unlocked ? v.title : v.unlockText}</div>
      <p class="cd-flavor">${unlocked ? v.flavor : 'This vessel has not yet been earned.'}</p>
      <div class="stat-rows">
        ${bar('Power', v.bars.power, 5)}
        ${bar('Speed', v.bars.speed, 5)}
        ${bar('Defense', v.bars.defense, 5)}
        ${bar('Skill Cap', v.bars.skill, 5)}
      </div>
      <div class="kit-title">Passive</div>
      <div class="kit-card" style="border-left-color:${v.color}">
        <h4>${v.passive.name}</h4><p>${v.passive.desc}</p>
      </div>
      <div class="kit-title">Starting Technique</div>
      <div class="kit-card" style="border-left-color:${t.color}">
        <h4>${t.glyph} ${t.name} <span style="color:#6be6ff;font-size:12px">${t.cost} Ki · ${t.cd}s</span></h4>
        <p>${t.desc}</p>
      </div>
      ${unlocked ? '' : `<p class="lock-note">Unlock: ${v.unlockText}</p>`}`;
    $('char-start').disabled = !unlocked;
    $('char-start').textContent = unlocked ? 'Descend' : 'Locked';
  }

  /* ============================================================
     MAP
     ============================================================ */
  let mapHover = null;
  let mapT = 0;
  function renderMap() {
    const run = G.run;
    $('map-sector').textContent = `Sector ${U.roman(run.sectorN)} — ${run.map.sector.name}`;
    $('map-sub').textContent = run.map.sector.sub;
    $('map-runstats').innerHTML = `
      <div class="rs hp"><span class="l">Vitality</span><span class="v">${Math.ceil(run.hp)}/${run.stats.maxHp}</span></div>
      <div class="rs sh"><span class="l">Shards</span><span class="v">${run.shards}</span></div>
      <div class="rs"><span class="l">Sigils</span><span class="v">${run.sigils.length}</span></div>
      <div class="rs"><span class="l">Best Rally</span><span class="v">×${run.bestRally}</span></div>`;
    $('map-hint').textContent = 'Click a lit node to advance · hover any node to preview the paths beyond it';
    DV.MapGen.resetHoverCache();
    show('scr-map');
    A.setMusic('map');
  }

  function tickMap(dt) {
    if (current !== 'scr-map' || !G.run || !G.run.map) return;
    mapT += dt;
    const cv = $('mapcanvas');
    DV.MapGen.draw(cv.getContext('2d'), G.run.map, mapHover, mapT);
  }

  function setupMapCanvas() {
    const cv = $('mapcanvas');
    const toLocal = e => {
      const r = cv.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width * DV.MapGen.MW,
        y: (e.clientY - r.top) / r.height * DV.MapGen.MH
      };
    };
    cv.addEventListener('mousemove', e => {
      if (!G.run || !G.run.map) return;
      const p = toLocal(e);
      const n = DV.MapGen.hitTest(G.run.map, p.x, p.y);
      if (n !== mapHover) {
        mapHover = n;
        if (n) A.play('ui_move');
        cv.style.cursor = n && n.available ? 'pointer' : 'default';
        if (n) {
          const T = DV.MapGen.NODE_TYPES[n.type];
          const mod = n.modifier ? C.MODIFIERS.find(m => m.id === n.modifier) : null;
          showTooltip(e, {
            name: n.type === 'boss' ? C.BOSS_MAP[n.bossId].name : T.name,
            kind: n.available ? 'Available' : n.visited ? 'Cleared' : 'Locked',
            color: T.color,
            desc: T.desc + (mod ? `<br><b style="color:${mod.color}">${mod.name}:</b> ${mod.desc}` : ''),
          });
        } else hideTooltip();
      } else if (n) positionTooltip(e);
    });
    cv.addEventListener('mouseleave', () => { mapHover = null; hideTooltip(); });
    cv.addEventListener('click', e => {
      if (!G.run || !G.run.map) return;
      const p = toLocal(e);
      const n = DV.MapGen.hitTest(G.run.map, p.x, p.y);
      if (n && n.available) { A.play('ui_confirm'); hideTooltip(); G.enterNode(n); }
      else if (n) A.play('ui_deny');
    });
  }

  /* ============================================================
     CARDS (shared renderer)
     ============================================================ */
  function sigilCard(s, opts) {
    opts = opts || {};
    const rar = C.RARITY[s.rarity];
    const card = el('div', 'card' + (opts.disabled ? ' unaffordable' : ''));
    card.style.setProperty('--accent', rar.color);
    card.innerHTML = `
      <div class="card-icon">${s.glyph}</div>
      <div class="card-kind">Sigil</div>
      <h3>${s.name}</h3>
      <div class="rarity" style="color:${rar.color}">${rar.name}</div>
      <div class="desc">${s.desc}</div>
      <div class="flav">${s.flavor}</div>
      ${opts.price != null ? `<div class="price${opts.disabled ? ' cant' : ''}">◈ ${opts.price}</div>` : ''}`;
    if (opts.owned) card.appendChild(el('div', 'owned', 'Owned'));
    return card;
  }

  function techCard(t, opts) {
    opts = opts || {};
    const card = el('div', 'card' + (opts.disabled ? ' unaffordable' : ''));
    card.style.setProperty('--accent', t.color);
    card.innerHTML = `
      <div class="card-icon">${t.glyph}</div>
      <div class="card-kind">Technique</div>
      <h3>${t.name}</h3>
      <div class="rarity" style="color:#6be6ff">${t.cost} Ki · ${t.cd}s cooldown</div>
      <div class="desc">${t.desc}</div>
      <div class="flav">${t.flavor}</div>
      ${opts.price != null ? `<div class="price${opts.disabled ? ' cant' : ''}">◈ ${opts.price}</div>` : ''}`;
    return card;
  }

  function genericCard(o) {
    const card = el('div', 'card' + (o.disabled ? ' unaffordable' : ''));
    card.style.setProperty('--accent', o.color || '#9a95b4');
    card.innerHTML = `
      <div class="card-icon">${o.glyph}</div>
      <div class="card-kind">${o.kind || ''}</div>
      <h3>${o.name}</h3>
      <div class="rarity">${o.sub || ''}</div>
      <div class="desc">${o.desc}</div>
      ${o.flavor ? `<div class="flav">${o.flavor}</div>` : ''}
      ${o.price != null ? `<div class="price${o.disabled ? ' cant' : ''}">◈ ${o.price}</div>` : ''}`;
    return card;
  }

  /* ============================================================
     REWARD
     ============================================================ */
  function renderReward(title, sub, offers, onPick, skipText) {
    $('reward-title').textContent = title;
    $('reward-sub').textContent = sub;
    const row = $('reward-cards');
    row.innerHTML = '';
    offers.forEach((o, i) => {
      const card = o.kindType === 'tech' ? techCard(o.data) : o.kindType === 'generic' ? genericCard(o.data) : sigilCard(o.data);
      click(card, () => { hideTooltip(); onPick(o, i); });
      row.appendChild(card);
    });
    fitCards(row);
    const skip = $('reward-skip');
    skip.textContent = skipText || 'Skip (+30 Shards)';
    skip.style.display = skipText === false ? 'none' : '';
    show('scr-reward');
  }

  /* ============================================================
     SHOP
     ============================================================ */
  function renderShop(stock, onBuy, onLeave) {
    $('shop-shards').innerHTML = `<div class="rs sh"><span class="l">Shards</span><span class="v">${G.run.shards}</span></div>
      <div class="rs hp"><span class="l">Vitality</span><span class="v">${Math.ceil(G.run.hp)}/${G.run.stats.maxHp}</span></div>`;
    const row = $('shop-cards');
    row.innerHTML = '';
    stock.forEach((item, i) => {
      const afford = G.run.shards >= item.price && !item.sold;
      let card;
      if (item.type === 'sigil') card = sigilCard(item.data, { price: item.price, disabled: !afford, owned: item.sold });
      else if (item.type === 'tech') card = techCard(item.data, { price: item.price, disabled: !afford });
      else card = genericCard(Object.assign({}, item.data, { price: item.price, disabled: !afford }));
      if (item.sold) card.appendChild(el('div', 'owned', 'Sold'));
      click(card, () => { if (afford) onBuy(item, i); else A.play('ui_deny'); });
      row.appendChild(card);
    });
    fitCards(row);
    show('scr-shop');
  }

  /* ============================================================
     REST
     ============================================================ */
  function renderRest(options, onPick) {
    const row = $('rest-cards');
    row.innerHTML = '';
    options.forEach((o, i) => {
      const card = genericCard(o);
      click(card, () => onPick(o, i));
      row.appendChild(card);
    });
    fitCards(row);
    show('scr-rest');
  }

  /* ============================================================
     EVENT
     ============================================================ */
  function renderEvent(ev, onChoose) {
    $('event-title').textContent = ev.title;
    $('event-body').textContent = ev.body;
    const box = $('event-choices');
    box.innerHTML = '';
    ev.choices.forEach((c, i) => {
      const afford = c.cost == null || G.run.shards >= c.cost;
      const b = el('button', 'echoice' + (afford ? '' : ' bad'),
        `<b>${c.label}${!afford ? ' — not enough shards' : ''}</b><span>${c.sub}</span>`);
      if (afford) click(b, () => onChoose(c, i));
      else b.addEventListener('click', () => A.play('ui_deny'));
      box.appendChild(b);
    });
    show('scr-event');
  }

  /* ============================================================
     PAUSE / LOADOUT
     ============================================================ */
  function renderLoadout(target) {
    const run = G.run;
    const box = $(target || 'pause-loadout');
    const st = run.stats;
    const chips = (arr) => arr.length ? arr : null;

    const sigHtml = run.sigils.map(s => {
      const rar = C.RARITY[s.rarity];
      return `<div class="chip" style="--accent:${rar.color}" data-sigil="${s.id}"><i>${s.glyph}</i>${s.name}</div>`;
    }).join('') || '<div class="chip empty">No sigils yet.</div>';

    const techHtml = run.techs.map(id => {
      const t = C.TECH_MAP[id];
      return `<div class="chip" style="--accent:${t.color}" data-tech="${id}"><i>${t.glyph}</i>${t.name}</div>`;
    }).join('') || '<div class="chip empty">No techniques.</div>';

    const stat = (l, v) => `<div class="chip" style="--accent:#9a95b4"><i>·</i>${l}: <b style="margin-left:5px;color:#e9e6f2">${v}</b></div>`;

    box.innerHTML = `
      <div class="lo-sect">
        <h4>Vessel</h4>
        <div class="lo-chips">
          <div class="chip" style="--accent:${run.vessel.color}"><i>${run.vessel.glyph}</i>${run.vessel.name} — ${run.vessel.passive.name}</div>
        </div>
      </div>
      <div class="lo-sect"><h4>Techniques</h4><div class="lo-chips">${techHtml}</div></div>
      <div class="lo-sect"><h4>Sigils (${run.sigils.length})</h4><div class="lo-chips">${sigHtml}</div></div>
      <div class="lo-sect"><h4>Stats</h4><div class="lo-chips">
        ${stat('Vitality', Math.ceil(run.hp) + '/' + st.maxHp)}
        ${stat('Damage', '×' + ((st.power * (st.powerMult || 1))).toFixed(2))}
        ${stat('Parry Window', (st.parryWindow * (st.parryWindowMult || 1) * 1000).toFixed(0) + 'ms')}
        ${stat('Perfect Window', (st.perfectWindow * (st.perfectWindowMult || 1) * 1000).toFixed(0) + 'ms')}
        ${stat('Parry Reach', Math.round(st.parryRadius * (st.parryRadiusMult || 1)))}
        ${stat('Volley Dmg', '+' + (((st.volleyDamage + (st.volleyDamageAdd || 0)) - 1) * 100).toFixed(0) + '%/hit')}
        ${stat('Volley Spd', '+' + (((st.volleySpeed + (st.volleySpeedAdd || 0)) - 1) * 100).toFixed(1) + '%/hit')}
        ${stat('Move Speed', Math.round(st.speed * (st.speedMult || 1)))}
        ${stat('Max Ki', Math.round(st.kiMax))}
        ${stat('Shards', run.shards)}
      </div></div>`;

    box.querySelectorAll('[data-sigil]').forEach(n => {
      const s = C.SIGIL_MAP[n.dataset.sigil];
      bindTip(n, { name: s.name, kind: C.RARITY[s.rarity].name + ' Sigil', desc: s.desc, flavor: s.flavor, color: C.RARITY[s.rarity].color });
    });
    box.querySelectorAll('[data-tech]').forEach(n => {
      const t = C.TECH_MAP[n.dataset.tech];
      bindTip(n, { name: t.name, kind: 'Technique · ' + t.cost + ' Ki', desc: t.desc, flavor: t.flavor, color: t.color });
    });
  }

  function renderPause() {
    renderLoadout('pause-loadout');
    showOverlay('scr-pause');
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  function renderSettings() {
    const s = G.settings;
    const grid = $('settings-grid');
    grid.innerHTML = '';

    const slider = (label, sub, key, fmt) => {
      const row = el('div', 'setrow');
      row.innerHTML = `<div class="lbl">${label}<small>${sub}</small></div>`;
      const inp = el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 100; inp.value = Math.round(s[key] * 100);
      const val = el('div', 'val', fmt ? fmt(s[key]) : Math.round(s[key] * 100) + '%');
      inp.addEventListener('input', () => {
        s[key] = inp.value / 100;
        val.textContent = fmt ? fmt(s[key]) : Math.round(s[key] * 100) + '%';
        G.applySettings();
      });
      inp.addEventListener('change', () => { G.saveSettings(); A.play('ui_move'); });
      row.appendChild(inp); row.appendChild(val);
      grid.appendChild(row);
    };

    const toggle = (label, sub, key) => {
      const row = el('div', 'setrow');
      row.innerHTML = `<div class="lbl">${label}<small>${sub}</small></div>`;
      const t = el('div', 'toggle' + (s[key] ? ' on' : ''));
      t.addEventListener('click', () => {
        s[key] = !s[key];
        t.classList.toggle('on', s[key]);
        A.play('ui_click');
        G.applySettings(); G.saveSettings();
      });
      row.appendChild(t);
      row.appendChild(el('div', 'val', ''));
      grid.appendChild(row);
    };

    slider('Master Volume', 'Overall output level.', 'volMaster');
    slider('Effects', 'Impacts, parries, hits.', 'volSfx');
    slider('Music', 'Generative score intensity.', 'volMusic');
    slider('Screen Shake', 'Camera reaction to impacts.', 'shake');
    slider('Particles', 'Visual density. Lower this if the game stutters.', 'particles');
    toggle('Screen Flashes', 'Bright full-screen flashes on big hits.', 'flashes');
    toggle('Show Damage Numbers', 'Floating numbers on every hit.', 'dmgNumbers');
    toggle('Aim Assist', 'Slight magnetism when parrying toward an enemy.', 'aimAssist');

    const row = el('div', 'setrow');
    row.innerHTML = `<div class="lbl">Erase All Progress<small>Deletes meta upgrades, unlocks, and any saved run.</small></div>`;
    const btn = el('button', 'mbtn danger', 'Erase');
    btn.style.padding = '8px 16px'; btn.style.fontSize = '13px';
    let armed = false;
    btn.addEventListener('click', () => {
      if (!armed) { armed = true; btn.textContent = 'Confirm Erase?'; A.play('ui_deny'); setTimeout(() => { armed = false; btn.textContent = 'Erase'; }, 4000); }
      else { G.wipeSave(); toast('Progress erased', '#ff4d5e'); armed = false; btn.textContent = 'Erase'; }
    });
    row.appendChild(btn); row.appendChild(el('div', 'val', ''));
    grid.appendChild(row);

    showOverlay('scr-settings');
  }

  /* ============================================================
     CODEX
     ============================================================ */
  let codexTab = 'help';
  function renderCodex() {
    const tabs = $('codex-tabs');
    tabs.innerHTML = '';
    const defs = [
      ['help', 'How to Play'], ['vessels', 'Vessels'], ['sigils', 'Sigils'],
      ['techs', 'Techniques'], ['enemies', 'Bestiary'], ['bosses', 'Wardens'],
    ];
    for (const [id, label] of defs) {
      const b = el('button', codexTab === id ? 'on' : '', label);
      click(b, () => { codexTab = id; renderCodex(); });
      tabs.appendChild(b);
    }
    const body = $('codex-body');
    body.innerHTML = '';
    const seen = G.meta.seen || {};

    const entry = (color, glyph, name, kindLabel, desc, flavor, hidden) => {
      const e = el('div', 'cx-entry' + (hidden ? ' hidden-e' : ''));
      e.style.setProperty('--accent', color);
      e.innerHTML = `<div class="cx-icon">${hidden ? '?' : glyph}</div>
        <div><h4>${hidden ? '???' : name}<span>${kindLabel}</span></h4>
        <p>${hidden ? 'Not yet encountered.' : desc}</p>
        ${!hidden && flavor ? `<div class="fl">“${flavor}”</div>` : ''}</div>`;
      body.appendChild(e);
    };

    if (codexTab === 'help') {
      body.innerHTML = `<div class="cx-help">${C.HELP}</div>`;
    } else if (codexTab === 'vessels') {
      for (const v of C.VESSELS) {
        const un = isVesselUnlocked(v);
        entry(v.color, v.glyph, v.name, v.title, `<b>${v.passive.name}:</b> ${v.passive.desc}`, v.flavor, !un);
      }
    } else if (codexTab === 'sigils') {
      const order = ['relic', 'epic', 'rare', 'common', 'cursed'];
      const sorted = C.SIGILS.slice().sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
      for (const s of sorted) {
        const rar = C.RARITY[s.rarity];
        entry(rar.color, s.glyph, s.name, rar.name, s.desc, s.flavor, false);
      }
    } else if (codexTab === 'techs') {
      for (const t of C.TECHNIQUES) entry(t.color, t.glyph, t.name, `${t.cost} Ki · ${t.cd}s`, t.desc, t.flavor, false);
    } else if (codexTab === 'enemies') {
      for (const e of C.ENEMIES) {
        const p = e.parry ? `Parry skill: <b style="color:#6be6ff">${Math.round(e.parry.skill * 100)}%</b>` : `<b style="color:#7dff9b">Cannot parry</b>`;
        entry(e.color, e.glyph, e.name, `Tier ${e.tier} · Sector ${U.roman(e.minSector)}+`,
          `${e.flavor}<br>${p} · HP ${e.hp}`, null, !seen['e_' + e.id]);
      }
    } else if (codexTab === 'bosses') {
      for (const b of C.BOSSES) {
        entry(b.color, b.glyph, b.name, b.subtitle, `${b.flavor}<br>HP ${b.hp} · ${b.phases} phases`, b.intro, !seen['b_' + b.id]);
      }
    }
    showOverlay('scr-codex');
  }

  /* ============================================================
     SHRINE OF RESOLVE (meta)
     ============================================================ */
  function renderMeta() {
    const m = G.meta;
    $('meta-resolve').innerHTML = `<div class="rs sh"><span class="l">Resolve</span><span class="v">${m.resolve || 0}</span></div>`;
    const grid = $('meta-grid');
    grid.innerHTML = '';
    for (const up of C.META) {
      const rank = (m.upgrades && m.upgrades[up.id]) || 0;
      const maxed = rank >= up.ranks;
      const cost = maxed ? 0 : up.cost[rank];
      const afford = !maxed && (m.resolve || 0) >= cost;
      const node = el('div', 'meta-node' + (maxed ? ' maxed' : afford ? '' : ' cant'));
      node.innerHTML = `
        <h4>${up.name}</h4>
        <div class="meta-pips">${Array.from({ length: up.ranks }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('')}</div>
        <p>${up.desc}</p>
        <div class="meta-cost ${maxed ? 'max' : ''}">${maxed ? 'MAXED' : '◈ ' + cost}</div>`;
      if (!maxed) {
        click(node, () => {
          if ((G.meta.resolve || 0) >= cost) {
            G.meta.resolve -= cost;
            G.meta.upgrades[up.id] = rank + 1;
            G.saveMeta();
            A.play('levelup');
            toast(up.name + ' → Rank ' + (rank + 1), '#ffcf6b');
            renderMeta();
          } else { A.play('ui_deny'); toast('Not enough Resolve', '#ff4d5e'); }
        });
      }
      grid.appendChild(node);
    }
    show('scr-meta');
    A.setMusic('menu');
  }

  /* ============================================================
     END SCREEN
     ============================================================ */
  function renderEnd(won, run, resolveGained, newUnlocks) {
    const t = $('end-title');
    t.textContent = won ? 'THE COURT IS QUIET' : 'YOU DROPPED IT';
    t.classList.toggle('win', won);
    $('end-sub').textContent = won
      ? 'You returned everything. Including yourself.'
      : run.deathCause || 'The rally ended without you.';

    const stat = (l, v) => `<div class="es"><span class="l">${l}</span><span class="v">${v}</span></div>`;
    /* a win increments sectorN past the last sector — report the one actually cleared */
    $('end-stats').innerHTML =
      stat('Sector', U.roman(Math.min(run.sectorN, C.SECTORS.length))) +
      stat('Rooms Cleared', run.roomsCleared) +
      stat('Best Rally', '×' + run.bestRally) +
      stat('Perfect Parries', run.perfects) +
      stat('Parries', run.parries) +
      stat('Kills', run.kills) +
      stat('Damage Dealt', Math.round(run.damageDealt)) +
      stat('Resolve Earned', '+' + resolveGained);

    const un = $('end-unlocks');
    un.innerHTML = '';
    for (const k of newUnlocks) {
      const info = C.UNLOCKS[k];
      if (info) un.appendChild(el('div', 'unlock-pill', `Unlocked ${info.kind}: ${info.name}`));
    }
    show('scr-end');
    A.setMusic(won ? 'win' : 'dead', true);
  }

  /* ============================================================
     WIRING
     ============================================================ */
  function init(game) {
    G = game;

    /* title menu */
    $('title-menu').querySelectorAll('.mbtn').forEach(b => {
      click(b, () => {
        const act = b.dataset.act;
        if (act === 'play') { selVessel = 0; renderCharSelect(); }
        else if (act === 'continue') G.continueRun();
        else if (act === 'shrine') renderMeta();
        else if (act === 'codex') { returnFrom = 'scr-title'; renderCodex(); }
        else if (act === 'settings') { returnFrom = 'scr-title'; renderSettings(); }
      });
    });

    /* char select */
    click($('scr-char').querySelector('[data-act="back"]'), () => renderTitle());
    click($('char-start'), () => {
      const v = C.VESSELS[selVessel];
      if (!isVesselUnlocked(v)) { A.play('ui_deny'); return; }
      G.startRun(v);
    });

    /* map */
    setupMapCanvas();
    click($('scr-map').querySelector('[data-act="pause-from-map"]'), () => renderPause());

    /* pause */
    $('scr-pause').querySelectorAll('.mbtn').forEach(b => {
      click(b, () => {
        const act = b.dataset.act;
        if (act === 'resume') { hideOverlay(); G.resume(); }
        else if (act === 'settings') { returnFrom = 'scr-pause'; renderSettings(); }
        else if (act === 'codex') { returnFrom = 'scr-pause'; renderCodex(); }
        else if (act === 'abandon') {
          if (b.dataset.armed) { hideOverlay(); G.abandonRun(); }
          else {
            b.dataset.armed = '1'; b.textContent = 'Confirm Abandon?';
            setTimeout(() => { delete b.dataset.armed; b.textContent = 'Abandon Run'; }, 4000);
          }
        }
      });
    });

    click($('settings-back'), () => {
      if (returnFrom === 'scr-pause') { renderPause(); }
      else { hideOverlay(); }
    });
    click($('codex-back'), () => {
      if (returnFrom === 'scr-pause') { renderPause(); }
      else { hideOverlay(); }
    });

    /* meta */
    click($('scr-meta').querySelector('[data-act="back"]'), () => renderTitle());

    /* end */
    $('scr-end').querySelectorAll('.mbtn').forEach(b => {
      click(b, () => {
        if (b.dataset.act === 'retry') { selVessel = 0; renderCharSelect(); }
        else renderTitle();
      });
    });

    /* shop leave */
    click($('shop-leave'), () => G.leaveShop());
  }

  return {
    init, show, showOverlay, hideOverlay, isOverlayOpen, currentScreen,
    renderTitle, renderCharSelect, renderMap, tickMap, renderReward, renderShop,
    renderRest, renderEvent, renderPause, renderSettings, renderCodex, renderMeta,
    renderEnd, renderLoadout, toast, hideTooltip, bindTip,
    sigilCard, techCard, genericCard,
    get skipBtn() { return $('reward-skip'); },
  };
})();
