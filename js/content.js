/* ============================================================
   DEADMAN VOLLEY — content.js
   All game data: vessels, sigils, techniques, enemies, bosses,
   events, meta upgrades, sectors, codex text.
   ============================================================ */
DV.Content = (function () {

  /* ============================================================
     RARITY
     ============================================================ */
  const RARITY = {
    common: { name: 'Common', color: '#9a95b4', weight: 100, price: 90 },
    rare: { name: 'Rare', color: '#6be6ff', weight: 46, price: 155 },
    epic: { name: 'Epic', color: '#b46bff', weight: 17, price: 245 },
    relic: { name: 'Relic', color: '#ffcf6b', weight: 5, price: 380 },
    cursed: { name: 'Cursed', color: '#ff4d5e', weight: 22, price: 60 },
  };

  /* ============================================================
     BASE PLAYER STATS
     Every vessel starts from this and applies deltas.
     ============================================================ */
  const BASE_STATS = {
    maxHp: 100,
    speed: 268,
    accel: 0.24,
    parryWindow: 0.155,     // seconds the parry is active
    parryRadius: 58,        // catch radius
    parryCooldown: 0.36,    // after a successful parry
    parryWhiffLock: 0.42,   // recovery after a miss
    perfectWindow: 0.062,   // first N seconds of parryWindow = perfect
    dashSpeed: 900,
    dashTime: 0.16,
    dashCooldown: 0.62,
    dashCharges: 1,
    dashIFrames: 0.22,
    chargeTime: 0.72,       // full charge for own orb
    power: 1,               // global damage mult
    orbSpeed: 520,          // speed of a freshly fired orb
    volleySpeed: 1.115,     // orb speed mult per volley
    volleyDamage: 1.30,     // orb damage mult per volley
    volleyCap: 24,
    kiMax: 100,
    kiRegen: 7.2,           // per second
    kiOnParry: 9,
    kiOnPerfect: 18,
    luck: 0,
    lifesteal: 0,
    thorns: 0,
    critChance: 0,
    critMult: 1.9,
    magnet: 92,
    reflectRange: 1,        // multiplier applied to parryRadius by sigils
    startShards: 100,
    revives: 0,
  };

  /* ============================================================
     VESSELS (playable characters)
     ============================================================ */
  const VESSELS = [
    {
      id: 'ronin',
      name: 'The Ronin',
      title: 'Balanced Blade',
      glyph: '刃',
      color: '#ffcf6b',
      unlocked: true,
      flavor: 'He died mid-swing and never noticed. Now he practises the same cut forever, and it has gotten very good.',
      stats: {},
      passive: {
        name: 'Unbroken Form',
        desc: 'Every 3rd consecutive parry in a rally is automatically perfect.'
      },
      tech: 'phase_step',
      bars: { power: 3, speed: 3, defense: 3, skill: 3 },
    },
    {
      id: 'ember',
      name: 'Ember',
      title: 'The Overcharged',
      glyph: '炎',
      color: '#ff6b3d',
      unlocked: true,
      flavor: 'She burned so hot the pyre refused her. What came back is mostly heat and grudge.',
      stats: { maxHp: -25, power: 0.25, volleyDamage: 0.09, chargeTime: -0.16, speed: 10, kiRegen: 1.5 },
      passive: {
        name: 'Runaway Reaction',
        desc: 'Orbs you return gain +9% damage on top of normal volley growth, but you take +20% damage from orbs.'
      },
      tech: 'solar_flare',
      bars: { power: 5, speed: 3, defense: 1, skill: 3 },
    },
    {
      id: 'wraith',
      name: 'The Wraith',
      title: 'Thin as Rumour',
      glyph: '影',
      color: '#b46bff',
      unlocked: false,
      unlockText: 'Clear Sector II',
      unlockKey: 'sector2',
      flavor: 'Not a ghost. A gap where somebody used to stand. It moves the way a lie travels — quickly, and around things.',
      stats: { maxHp: -30, speed: 42, dashCharges: 1, dashCooldown: -0.2, dashIFrames: 0.08, parryRadius: -6, power: -0.05 },
      passive: {
        name: 'Two Steps Removed',
        desc: 'Gain a 2nd dash charge. Dashing through an orb slows it by 35% and marks it — your next parry on it is perfect.'
      },
      tech: 'afterimage',
      bars: { power: 2, speed: 5, defense: 1, skill: 4 },
    },
    {
      id: 'bulwark',
      name: 'The Bulwark',
      title: 'Load-Bearing Corpse',
      glyph: '盾',
      color: '#6be6ff',
      unlocked: false,
      unlockText: 'Take 400 total damage across all runs',
      unlockKey: 'tank',
      flavor: 'They built a wall and buried a volunteer inside it for luck. The wall fell. The volunteer kept the job.',
      stats: { maxHp: 60, speed: -38, parryRadius: 14, parryWindow: 0.03, parryCooldown: 0.06, dashSpeed: -160, power: -0.08, kiMax: 20 },
      passive: {
        name: 'Immovable',
        desc: 'Failing to parry deals 35% less damage. Standing still for 1s grants a shield that absorbs one hit.'
      },
      tech: 'bastion',
      bars: { power: 2, speed: 1, defense: 5, skill: 4 },
    },
    {
      id: 'twin',
      name: 'Halfheart',
      title: 'Two in One Coat',
      glyph: '双',
      color: '#7dff9b',
      unlocked: false,
      unlockText: 'Reach a 15-volley rally',
      unlockKey: 'rally15',
      flavor: 'Siblings. One of them is dead. They have not agreed on which.',
      stats: { maxHp: -12, power: -0.12, volleyDamage: 0.05, kiMax: 30, kiRegen: 2.4, parryWindow: 0.012 },
      passive: {
        name: 'Split Return',
        desc: 'Every parry at volley 4+ spawns a small echo orb that seeks the nearest enemy for 30% damage.'
      },
      tech: 'split_palm',
      bars: { power: 3, speed: 3, defense: 2, skill: 5 },
    },
    {
      id: 'deadman',
      name: 'The Deadman',
      title: 'It Came Back Wrong',
      glyph: '死',
      color: '#ff4d5e',
      unlocked: false,
      unlockText: 'Defeat the Deadman',
      unlockKey: 'win',
      flavor: 'You beat it. It considered that an introduction.',
      stats: { maxHp: -45, power: 0.4, volleySpeed: 0.03, volleyDamage: 0.1, perfectWindow: 0.022, parryWindow: -0.03, kiRegen: 3 },
      passive: {
        name: 'Terminal Velocity',
        desc: 'You cannot heal above 55 HP. Every perfect parry permanently adds +2% damage for the rest of the run.'
      },
      tech: 'chain_volley',
      bars: { power: 5, speed: 4, defense: 1, skill: 5 },
    },
  ];

  /* ============================================================
     TECHNIQUES (active abilities, Q / E)
     ============================================================ */
  const TECHNIQUES = [
    {
      id: 'phase_step', name: 'Phase Step', glyph: '⇢', color: '#ffcf6b', cost: 25, cd: 4.5,
      desc: 'Blink 260px toward your aim. Orbs crossed become yours and gain +1 volley.',
      flavor: 'Distance is a formality between the dead.'
    },
    {
      id: 'solar_flare', name: 'Solar Flare', glyph: '☀', color: '#ff6b3d', cost: 35, cd: 9,
      desc: 'Blind every enemy for 3.2s. Blinded enemies cannot parry and aim badly.',
      flavor: 'The last thing anyone honest sees.'
    },
    {
      id: 'afterimage', name: 'Afterimage', glyph: '⧉', color: '#b46bff', cost: 30, cd: 8,
      desc: 'Leave a decoy for 4s. Enemies and orbs target it. It detonates for 40 damage.',
      flavor: 'Left behind on purpose, for once.'
    },
    {
      id: 'bastion', name: 'Bastion', glyph: '⬢', color: '#6be6ff', cost: 30, cd: 8.5,
      desc: 'Raise a 2.6s barrier. Orbs that strike it are parried automatically at your aim.',
      flavor: 'Hold. Just hold.'
    },
    {
      id: 'split_palm', name: 'Split Palm', glyph: '⋔', color: '#7dff9b', cost: 28, cd: 7,
      desc: 'Your next 2 parries split the orb into 3 (each 55% damage, full volley count).',
      flavor: 'One problem, neatly trisected.'
    },
    {
      id: 'chain_volley', name: 'Chain Volley', glyph: '∞', color: '#ff4d5e', cost: 40, cd: 11,
      desc: 'For 4s every orb that touches you is auto-parried perfectly at the nearest enemy.',
      flavor: 'Stop thinking. Start returning.'
    },
    {
      id: 'gravity_well', name: 'Gravity Well', glyph: '◉', color: '#b46bff', cost: 32, cd: 8,
      desc: 'Drop a well at your cursor for 3s. It drags orbs and enemies inward.',
      flavor: 'Everything falls. Some things faster.'
    },
    {
      id: 'shear', name: 'Shear', glyph: '✂', color: '#ffcf6b', cost: 22, cd: 5.5,
      desc: 'Slash a 200px cone: 45 damage, and any orb in it is instantly returned with +2 volleys.',
      flavor: 'Not elegant. Extremely fast.'
    },
    {
      id: 'grave_pulse', name: 'Grave Pulse', glyph: '◎', color: '#7dff9b', cost: 34, cd: 9,
      desc: 'Shockwave: 60 damage in 240px, knocks enemies back, refunds 20 Ki per enemy hit.',
      flavor: 'The ground remembers who is buried in it.'
    },
    {
      id: 'hollow_step', name: 'Hollow Step', glyph: '◇', color: '#6be6ff', cost: 26, cd: 7,
      desc: 'Become intangible for 1.8s. Orbs pass through. Parrying ends it early with a perfect.',
      flavor: 'Briefly, an absence.'
    },
    {
      id: 'conflagrate', name: 'Conflagrate', glyph: '✸', color: '#ff6b3d', cost: 45, cd: 12,
      desc: 'Detonate every enemy-owned orb for 70 damage each in a 130px radius.',
      flavor: 'Return to sender, all at once.'
    },
    {
      id: 'deadhand', name: "Dead Man's Hand", glyph: '✋', color: '#ff4d5e', cost: 50, cd: 14,
      desc: 'Seize the largest orb in play, refresh it to your ownership at volley +4, and hurl it.',
      flavor: 'Mine now.'
    },
  ];

  /* ============================================================
     SIGILS (passive relics)
     Hooks are optional functions the arena calls.
     ============================================================ */
  const SIGILS = [
    /* ---- COMMON ---- */
    {
      id: 'iron_wrist', name: 'Iron Wrist', glyph: '⌚', rarity: 'common', color: '#9a95b4',
      desc: 'Parry window +22%.', flavor: 'Bound tight enough to hurt. That is the point.',
      stats: { parryWindowMult: 1.22 },
    },
    {
      id: 'wide_palm', name: 'Wide Palm', glyph: '✊', rarity: 'common', color: '#9a95b4',
      desc: 'Parry radius +16.', flavor: 'Reach exceeding grasp, corrected.',
      stats: { parryRadius: 16 },
    },
    {
      id: 'quick_feet', name: 'Quick Feet', glyph: '👟', rarity: 'common', color: '#9a95b4',
      desc: 'Move speed +11%. Dash cooldown -15%.', flavor: 'Running away counts as strategy.',
      stats: { speedMult: 1.11, dashCooldownMult: 0.85 },
    },
    {
      id: 'thick_hide', name: 'Thick Hide', glyph: '🛡', rarity: 'common', color: '#9a95b4',
      desc: 'Max HP +25. Damage taken -6%.', flavor: 'Layers of something that used to be skin.',
      stats: { maxHp: 25, damageTakenMult: 0.94 },
    },
    {
      id: 'ember_core', name: 'Ember Core', glyph: '✦', rarity: 'common', color: '#9a95b4',
      desc: 'Orb damage +14%.', flavor: 'Still warm. Suspiciously warm.',
      stats: { powerMult: 1.14 },
    },
    {
      id: 'ki_conduit', name: 'Ki Conduit', glyph: '⚡', rarity: 'common', color: '#9a95b4',
      desc: 'Ki regen +50%. Max Ki +20.', flavor: 'A vein re-routed to somewhere useful.',
      stats: { kiRegenMult: 1.5, kiMax: 20 },
    },
    {
      id: 'lodestone', name: 'Lodestone', glyph: '◈', rarity: 'common', color: '#9a95b4',
      desc: 'Shard pickup range +150%. +18% shards from all sources.', flavor: 'Greed, made magnetic.',
      stats: { magnetMult: 2.5, shardMult: 1.18 },
    },
    {
      id: 'short_fuse', name: 'Short Fuse', glyph: '⏱', rarity: 'common', color: '#9a95b4',
      desc: 'Charge time -30%. Fired orbs +8% speed.', flavor: 'Aim later. Fire now.',
      stats: { chargeTimeMult: 0.7, orbSpeedMult: 1.08 },
    },

    /* ---- RARE ---- */
    {
      id: 'bloodrite', name: 'Bloodrite', glyph: '✚', rarity: 'rare', color: '#6be6ff',
      desc: 'Perfect parries heal 4 HP.', flavor: 'Timing as medicine.',
      hooks: { onPerfectParry: (a) => { a.healPlayer(4); } },
    },
    {
      id: 'momentum', name: 'Momentum', glyph: '➤', rarity: 'rare', color: '#6be6ff',
      desc: 'Volley speed growth +45%. Volley damage growth +12%.', flavor: 'Nothing here knows how to slow down.',
      stats: { volleySpeedAdd: 0.052, volleyDamageAdd: 0.036 },
    },
    {
      id: 'static_field', name: 'Static Field', glyph: '⚡', rarity: 'rare', color: '#6be6ff',
      desc: 'Perfect parries chain lightning to 3 enemies for 22 damage.',
      flavor: 'The air was already angry.',
      hooks: { onPerfectParry: (a, e) => { a.chainLightning(e.x, e.y, 3, 22); } },
    },
    {
      id: 'executioner', name: "Executioner's Mark", glyph: '☠', rarity: 'rare', color: '#6be6ff',
      desc: '+65% damage to enemies below 35% HP.', flavor: 'Finish it. Do not admire it.',
      hooks: {
        modifyDamage: (a, e) => {
          if (e.target && e.target.hp / e.target.maxHp < 0.35) e.damage *= 1.65;
        }
      },
    },
    {
      id: 'riposte', name: 'Riposte', glyph: '⤨', rarity: 'rare', color: '#6be6ff',
      desc: 'Parrying grants +12% move speed for 3s, stacking to 5.', flavor: 'Confidence is chemical.',
      hooks: { onParry: (a) => { a.addBuff('riposte', 3, 5); } },
    },
    {
      id: 'second_wind', name: 'Second Wind', glyph: '🌀', rarity: 'rare', color: '#6be6ff',
      desc: 'Clearing a room heals 12 HP.', flavor: 'Breathe. You still can, technically.',
      hooks: { onRoomClear: (a) => { a.healPlayer(12); } },
    },
    {
      id: 'greedy_ghost', name: 'Greedy Ghost', glyph: '💠', rarity: 'rare', color: '#6be6ff',
      desc: '+45% shards. Shop prices -20%.', flavor: 'It followed the coins, not you.',
      stats: { shardMult: 1.45, shopDiscount: 0.2 },
    },
    {
      id: 'vampiric', name: 'Vampiric Return', glyph: '🩸', rarity: 'rare', color: '#6be6ff',
      desc: 'Heal 4% of damage your orbs deal.', flavor: 'A tidy arrangement.',
      stats: { lifesteal: 0.04 },
    },
    {
      id: 'brambles', name: 'Brambles', glyph: '❋', rarity: 'rare', color: '#6be6ff',
      desc: 'Enemies that touch you take 35 damage and are knocked back.',
      flavor: 'Do not.',
      stats: { thorns: 35 },
    },
    {
      id: 'coldsnap', name: 'Coldsnap', glyph: '❄', rarity: 'rare', color: '#6be6ff',
      desc: 'Orbs you parry slow enemies they pass near by 45% for 2s.',
      flavor: 'The rally leaves frost behind it.',
      stats: { chill: 1 },
    },
    {
      id: 'twin_tap', name: 'Twin Tap', glyph: '⁘', rarity: 'rare', color: '#6be6ff',
      desc: 'Parry cooldown -30%. Whiff recovery -35%.', flavor: 'Room for one more mistake.',
      stats: { parryCooldownMult: 0.7, whiffMult: 0.65 },
    },

    /* ---- EPIC ---- */
    {
      id: 'splitter_sigil', name: 'Fork of the Path', glyph: '⋔', rarity: 'epic', color: '#b46bff',
      desc: 'Perfect parries split the orb into 2 (each 62% damage, volley preserved).',
      flavor: 'Two futures. Both of them hit.',
      stats: { perfectSplit: 1 },
    },
    {
      id: 'gravekeeper', name: "Gravekeeper's Toll", glyph: '⚱', rarity: 'epic', color: '#b46bff',
      desc: 'Killing an enemy heals 6 HP and refunds 12 Ki.',
      flavor: 'Every burial pays a wage.',
      hooks: { onEnemyKill: (a) => { a.healPlayer(6); a.addKi(12); } },
    },
    {
      id: 'crescendo', name: 'Crescendo', glyph: '♬', rarity: 'epic', color: '#b46bff',
      desc: 'Each volley in a rally adds +7% to ALL damage you deal, resetting when the rally ends.',
      flavor: 'It is a song and it is getting loud.',
      stats: { crescendo: 0.07 },
    },
    {
      id: 'deadmans_hand', name: "Deadman's Hand", glyph: '🂡', rarity: 'epic', color: '#b46bff',
      desc: 'Once per room, surviving lethal damage leaves you at 1 HP with 1.5s of invulnerability.',
      flavor: 'Aces and eights, and one more turn.',
      stats: { cheatDeath: 1 },
    },
    {
      id: 'orbit', name: 'Dead Satellite', glyph: '◐', rarity: 'epic', color: '#b46bff',
      desc: 'A small orb orbits you, dealing 24 damage to enemies it touches.',
      flavor: 'It used to be someone. It circles anyway.',
      stats: { satellites: 1 },
    },
    {
      id: 'overreach', name: 'Overreach', glyph: '↔', rarity: 'epic', color: '#b46bff',
      desc: 'Parry radius +40%, but taking a hit shrinks it by 8% until the room ends.',
      flavor: 'Grasping. Always grasping.',
      stats: { parryRadiusMult: 1.4, overreach: 1 },
    },
    {
      id: 'echo_chamber', name: 'Echo Chamber', glyph: '◌', rarity: 'epic', color: '#b46bff',
      desc: 'Every 4th parry fires a duplicate orb at the nearest enemy for 70% damage.',
      flavor: 'The room repeats you. Badly, but often.',
      stats: { echoEvery: 4 },
    },
    {
      id: 'timeslip', name: 'Timeslip', glyph: '⧗', rarity: 'epic', color: '#b46bff',
      desc: 'When an orb enters your parry radius, time slows 45% for 0.22s.',
      flavor: 'A courtesy extended to the very nearly dead.',
      stats: { timeslip: 1 },
    },
    {
      id: 'conductor', name: 'Conductor', glyph: '⌁', rarity: 'epic', color: '#b46bff',
      desc: 'Techniques cost 35% less Ki and cool down 30% faster.',
      flavor: 'Signal without resistance.',
      stats: { techCostMult: 0.65, techCdMult: 0.7 },
    },

    /* ---- RELIC ---- */
    {
      id: 'perfect_form', name: 'Perfect Form', glyph: '✧', rarity: 'relic', color: '#ffcf6b',
      desc: 'Perfect window +100%. Perfect parries deal double volley growth.',
      flavor: 'There is a correct moment. It has been widened for you.',
      stats: { perfectWindowMult: 2, perfectDouble: 1 },
    },
    {
      id: 'the_sun', name: 'The Hollow Sun', glyph: '☉', rarity: 'relic', color: '#ffcf6b',
      desc: 'Your orbs grow larger with each volley and pierce enemies they kill.',
      flavor: 'It sets on nobody.',
      stats: { sunOrb: 1 },
    },
    {
      id: 'undertow', name: 'Undertow', glyph: '≈', rarity: 'relic', color: '#ffcf6b',
      desc: 'All orbs curve toward the enemy you are aiming at.',
      flavor: 'The current has opinions.',
      stats: { homing: 1 },
    },
    {
      id: 'ninth_life', name: 'Ninth Life', glyph: '⑨', rarity: 'relic', color: '#ffcf6b',
      desc: 'Revive once per run at 50% HP with a screen-clearing blast.',
      flavor: 'You have been counting. So has it.',
      stats: { revives: 1 },
    },
    {
      id: 'metronome', name: 'Metronome', glyph: '⊹', rarity: 'relic', color: '#ffcf6b',
      desc: 'Parries alternate: every other parry is automatically perfect.',
      flavor: 'Tick. Tock. Tick.',
      stats: { metronome: 1 },
    },
    {
      id: 'both_hands', name: 'Both Hands', glyph: '⇋', rarity: 'relic', color: '#ffcf6b',
      desc: 'You may parry your own orbs at full volley growth. A self-parried orb turns LIVE — it can strike you as well as your enemies.',
      flavor: 'No opponent required.',
      stats: { selfVolley: 1 },
    },

    /* ---- CURSED (strong, with a real cost) ---- */
    {
      id: 'glass_marrow', name: 'Glass Marrow', glyph: '☠', rarity: 'cursed', color: '#ff4d5e',
      desc: 'Damage +55%. Max HP -35%.', flavor: 'Lighter. Sharper. Briefer.',
      stats: { powerMult: 1.55, maxHpMult: 0.65 },
    },
    {
      id: 'hungry_orb', name: 'Hungry Orb', glyph: '◍', rarity: 'cursed', color: '#ff4d5e',
      desc: 'Volley damage growth +70%. Failing to parry costs an extra 12 HP.',
      flavor: 'It eats either way.',
      stats: { volleyDamageAdd: 0.21, failPenalty: 12 },
    },
    {
      id: 'blind_faith', name: 'Blind Faith', glyph: '◑', rarity: 'cursed', color: '#ff4d5e',
      desc: 'Perfect window +160%. You can no longer see enemy telegraph rings.',
      flavor: 'Feel for it.',
      stats: { perfectWindowMult: 2.6, noTelegraph: 1 },
    },
    {
      id: 'iron_maiden', name: 'Iron Maiden', glyph: '⊗', rarity: 'cursed', color: '#ff4d5e',
      desc: 'Damage taken -45%. Move speed -25%. Cannot dash.',
      flavor: 'Comfortable, in the way of coffins.',
      stats: { damageTakenMult: 0.55, speedMult: 0.75, noDash: 1 },
    },
    {
      id: 'gamblers_grin', name: "Gambler's Grin", glyph: '🎲', rarity: 'cursed', color: '#ff4d5e',
      desc: '35% crit chance for 220% damage. All healing halved.',
      flavor: 'The house is dead too.',
      stats: { critChance: 0.35, critMult: 2.2, healMult: 0.5 },
    },
    {
      id: 'tithe', name: 'The Tithe', glyph: '⛓', rarity: 'cursed', color: '#ff4d5e',
      desc: '+120% shards. Take 4 damage every time you clear a room.',
      flavor: 'Coin now. Skin later.',
      stats: { shardMult: 2.2 },
      hooks: { onRoomClear: (a) => { a.damagePlayer(4, 'tithe'); } },
    },
  ];

  /* ============================================================
     ENEMIES
     ai kinds handled in arena.js:
       chaser | caster | duelist | orbiter | mirror | sentinel
       splitter | bomber | summoner | lancer
     parry: {skill 0..1, react (s), cd (s)}
     ============================================================ */
  const ENEMIES = [
    {
      id: 'husk', name: 'Husk', glyph: '◔', color: '#8b8299', ai: 'chaser',
      hp: 42, r: 17, speed: 108, contact: 12, tier: 1, weight: 100, minSector: 1,
      parry: null, xp: 1,
      flavor: 'Walks toward heat. Does not stop for anything, including advice.'
    },
    {
      id: 'caster', name: 'Ashcaster', glyph: '◈', color: '#ff9b5c', ai: 'caster',
      hp: 38, r: 16, speed: 76, contact: 8, tier: 1, weight: 92, minSector: 1,
      fireCd: 2.4, orbPower: 16, orbSpeed: 330, parry: { skill: 0.18, react: 0.5, cd: 1.4 }, xp: 2,
      flavor: 'Throws a small unpleasantness every few seconds. Rude, but parryable.'
    },
    {
      id: 'duelist', name: 'Duelist', glyph: '⧗', color: '#6be6ff', ai: 'duelist',
      hp: 56, r: 18, speed: 132, contact: 10, tier: 2, weight: 74, minSector: 1,
      fireCd: 3.2, orbPower: 22, orbSpeed: 400, parry: { skill: 0.72, react: 0.30, cd: 0.75 }, xp: 3,
      flavor: 'Wants the rally. Will keep it going until one of you drops.'
    },
    {
      id: 'reaper', name: 'Reaper', glyph: '⟁', color: '#ff4d5e', ai: 'lancer',
      hp: 48, r: 17, speed: 96, dashSpeed: 720, contact: 22, tier: 2, weight: 66, minSector: 1,
      parry: { skill: 0.28, react: 0.42, cd: 1.2 }, xp: 3,
      flavor: 'Winds up, then crosses the room in a straight and honest line.'
    },
    {
      id: 'sentinel', name: 'Sentinel', glyph: '⬡', color: '#c0b8d8', ai: 'sentinel',
      hp: 84, r: 22, speed: 62, contact: 14, tier: 2, weight: 58, minSector: 1,
      shieldArc: 2.1, fireCd: 3.6, orbPower: 24, orbSpeed: 360,
      parry: { skill: 0.5, react: 0.4, cd: 1.1 }, xp: 4,
      flavor: 'Shielded from the front. Its back has never been introduced to anyone — and a rally of 3+ shatters the shield outright.'
    },
    {
      id: 'orbiter', name: 'Wisp Choir', glyph: '✧', color: '#b46bff', ai: 'orbiter',
      hp: 30, r: 13, speed: 190, contact: 9, tier: 2, weight: 62, minSector: 2,
      fireCd: 2.0, orbPower: 15, orbSpeed: 380, parry: { skill: 0.35, react: 0.42, cd: 1.0 }, xp: 2,
      flavor: 'Circles at a polite distance and refuses to hold still.'
    },
    {
      id: 'mirror', name: 'Mirrorwarden', glyph: '◫', color: '#e9e6f2', ai: 'mirror',
      hp: 44, r: 19, speed: 88, contact: 10, tier: 3, weight: 48, minSector: 2,
      parry: { skill: 0.96, react: 0.13, cd: 0.3 }, xp: 5,
      flavor: 'Returns everything instantly. The rally becomes a race you can lose.'
    },
    {
      id: 'splitter', name: 'Splitkin', glyph: '❂', color: '#7dff9b', ai: 'splitter',
      hp: 60, r: 20, speed: 92, contact: 12, tier: 2, weight: 54, minSector: 2,
      fireCd: 3.0, orbPower: 18, orbSpeed: 340, splits: 2,
      parry: { skill: 0.4, react: 0.4, cd: 1.0 }, xp: 4,
      flavor: 'Dies into two smaller problems. Its orbs do the same when parried.'
    },
    {
      id: 'bomber', name: 'Censer', glyph: '◉', color: '#ffcf6b', ai: 'bomber',
      hp: 52, r: 19, speed: 118, contact: 0, tier: 3, weight: 44, minSector: 2,
      fuse: 1.5, blastR: 130, blastDmg: 32, parry: null, xp: 3,
      flavor: 'Approaches with terrible enthusiasm and then stops existing, loudly.'
    },
    {
      id: 'summoner', name: 'Pallbearer', glyph: '⚱', color: '#9b7dff', ai: 'summoner',
      hp: 70, r: 21, speed: 70, contact: 10, tier: 3, weight: 40, minSector: 2,
      summonCd: 5.5, summonId: 'husk', summonMax: 4,
      parry: { skill: 0.45, react: 0.38, cd: 1.0 }, xp: 5,
      flavor: 'Keeps producing more of the dead. Deal with the source.'
    },
    {
      id: 'lancer', name: 'Spearwake', glyph: '⤞', color: '#ff6b3d', ai: 'lancer',
      hp: 58, r: 17, speed: 112, dashSpeed: 900, contact: 26, tier: 3, weight: 42, minSector: 3,
      parry: { skill: 0.55, react: 0.3, cd: 0.8 }, xp: 4,
      flavor: 'Faster than the Reaper and considerably less forgiving.'
    },
    {
      id: 'archon', name: 'Ash Archon', glyph: '✦', color: '#ff4d5e', ai: 'duelist',
      hp: 110, r: 23, speed: 118, contact: 14, tier: 4, weight: 26, minSector: 3,
      fireCd: 2.4, orbPower: 34, orbSpeed: 470, orbCount: 2,
      parry: { skill: 0.86, react: 0.2, cd: 0.5 }, xp: 8,
      flavor: 'Throws two at once and returns both. Pick your target carefully.'
    },
    {
      id: 'wardstone', name: 'Wardstone', glyph: '⬢', color: '#6be6ff', ai: 'sentinel',
      hp: 150, r: 27, speed: 44, contact: 16, tier: 4, weight: 24, minSector: 3,
      shieldArc: 2.6, fireCd: 3.0, orbPower: 38, orbSpeed: 400,
      parry: { skill: 0.7, react: 0.28, cd: 0.7 }, aura: 'shield', xp: 8,
      flavor: 'Shields its neighbours. Get behind it, or break the shield with a rally of 3+.'
    },
    {
      id: 'hollow', name: 'Hollowed', glyph: '◍', color: '#b46bff', ai: 'mirror',
      hp: 90, r: 21, speed: 104, contact: 12, tier: 4, weight: 22, minSector: 4,
      parry: { skill: 1.0, react: 0.10, cd: 0.22 }, xp: 9,
      flavor: 'A perfect returner. The only way through is to overwhelm the angle.'
    },
  ];

  /* ============================================================
     BOSSES
     ============================================================ */
  const BOSSES = [
    {
      id: 'gravekeeper', name: 'THE GRAVEKEEPER', subtitle: 'Warden of the Ashen Court',
      glyph: '⚰', color: '#ffcf6b', hp: 900, r: 42, speed: 92,
      sector: 1,
      flavor: 'It has buried everyone who came before. It keeps their names in its mouth.',
      intro: 'You are late. The plot is already dug.',
      phases: 3,
    },
    {
      id: 'twinfang', name: 'THE TWIN FANGS', subtitle: 'Argument Made Flesh',
      glyph: '⚔', color: '#ff4d5e', hp: 620, r: 30, speed: 148,
      sector: 2, twin: true,
      flavor: 'Two halves of one killer, still disagreeing about the method.',
      intro: 'YOU take the head. No — YOU take the head.',
      phases: 2,
    },
    {
      id: 'hollowsun', name: 'THE HOLLOW SUN', subtitle: 'That Which Does Not Set',
      glyph: '☉', color: '#ff6b3d', hp: 1500, r: 72, speed: 30,
      sector: 3,
      flavor: 'It is not a creature. It is a wound in the ceiling of the world, and it is very warm.',
      intro: 'IT DOES NOT BLINK.',
      phases: 3,
    },
    {
      id: 'deadman', name: 'THE DEADMAN', subtitle: 'Your Own Returned Serve',
      glyph: '死', color: '#b46bff', hp: 1900, r: 40, speed: 168,
      sector: 4,
      flavor: 'It moves the way you move. It parries the way you wish you did.',
      intro: 'I have been practising. Against you.',
      phases: 4,
    },
  ];

  /* ============================================================
     SECTORS
     ============================================================ */
  const SECTORS = [
    {
      n: 1, name: 'The Ashen Court', color: '#ffcf6b', accent: '#ff6b3d',
      rooms: 9, boss: 'gravekeeper', hpMult: 1.0, dmgMult: 1.0,
      sub: 'Where the first of you were buried standing.',
      floorHue: 32,
    },
    {
      n: 2, name: 'The Drowned Choir', color: '#6be6ff', accent: '#b46bff',
      rooms: 10, boss: 'twinfang', hpMult: 1.55, dmgMult: 1.32,
      sub: 'Everything here still sings. Nothing here still breathes.',
      floorHue: 196,
    },
    {
      n: 3, name: 'The Furnace Reach', color: '#ff6b3d', accent: '#ffcf6b',
      rooms: 11, boss: 'hollowsun', hpMult: 2.3, dmgMult: 1.7,
      sub: 'The light is close enough to touch. Do not.',
      floorHue: 14,
    },
    {
      n: 4, name: 'The Deadman’s Court', color: '#b46bff', accent: '#ff4d5e',
      rooms: 12, boss: 'deadman', hpMult: 3.2, dmgMult: 2.15,
      sub: 'It has been watching the whole descent. It took notes.',
      floorHue: 272,
    },
  ];

  /* ============================================================
     ROOM MODIFIERS — spice for elite rooms
     ============================================================ */
  const MODIFIERS = [
    { id: 'swift', name: 'Swiftfoot', desc: 'Enemies move 35% faster.', color: '#6be6ff' },
    { id: 'volatile', name: 'Volatile', desc: 'Orbs gain speed twice as fast.', color: '#ff6b3d' },
    { id: 'armored', name: 'Ossified', desc: 'Enemies have 45% more HP.', color: '#c0b8d8' },
    { id: 'keen', name: 'Keen-Eyed', desc: 'Enemies parry far more reliably.', color: '#b46bff' },
    { id: 'swarm', name: 'Swarming', desc: 'One extra wave, smaller enemies.', color: '#7dff9b' },
    { id: 'dim', name: 'Dim', desc: 'The arena is dark beyond your reach.', color: '#9a95b4' },
  ];

  /* ============================================================
     EVENTS
     ============================================================ */
  const EVENTS = [
    {
      id: 'wellofnames',
      title: 'The Well of Names',
      body: 'A dry well, ringed with teeth. Something at the bottom is reciting a list, and one of the names is nearly yours. It offers a trade: memory for weight.',
      choices: [
        { label: 'Give it a name', sub: 'Lose 12 max HP. Gain a random Epic sigil.', act: 'trade_hp_epic' },
        { label: 'Give it coin', sub: 'Pay 150 shards. Heal to full.', act: 'pay_heal', cost: 150 },
        { label: 'Give it nothing', sub: 'Leave. Gain 60 shards from the rim.', act: 'small_shards' },
      ]
    },
    {
      id: 'duelist_ghost',
      title: 'A Standing Invitation',
      body: 'A duelist waits in the middle of the room with an orb balanced on one finger. It has clearly been waiting a long time. It nods at the empty space opposite.',
      choices: [
        { label: 'Accept the rally', sub: 'Fight an elite. Reward: choose from 3 sigils.', act: 'elite_fight' },
        { label: 'Take the orb instead', sub: 'Gain a random Rare sigil. Take 18 damage.', act: 'steal_orb' },
        { label: 'Walk past', sub: 'Nothing happens. It does not mind.', act: 'nothing' },
      ]
    },
    {
      id: 'furnace',
      title: 'The Ration Furnace',
      body: 'A squat iron stove burning something that smells like citrus and hair. A ladle hangs from a chain. There is enough for one long drink.',
      choices: [
        { label: 'Drink deep', sub: 'Heal 45 HP. Gain a Cursed sigil.', act: 'heal_curse' },
        { label: 'Fill a flask', sub: 'Heal 25 HP.', act: 'heal_25' },
        { label: 'Snuff it out', sub: 'Gain 120 shards.', act: 'shards_120' },
      ]
    },
    {
      id: 'mirrorpool',
      title: 'The Mirror Pool',
      body: 'Still water, and in it a version of you that is doing considerably better. It is holding something you do not have. It waits to see if you will reach in.',
      choices: [
        { label: 'Reach in', sub: 'Swap a random sigil for a different one of higher rarity.', act: 'upgrade_sigil' },
        { label: 'Drink', sub: 'Gain +12 max HP permanently this run.', act: 'maxhp_12' },
        { label: 'Break the surface', sub: 'Gain 90 shards. The reflection stops smiling.', act: 'shards_90' },
      ]
    },
    {
      id: 'debt',
      title: 'The Collector',
      body: 'A thin figure with a ledger the size of a door. It does not look up. "You are carrying weight you did not pay for," it says. "I can adjust that. Either direction."',
      choices: [
        { label: 'Borrow', sub: 'Gain 250 shards. Take 25% max HP as damage.', act: 'borrow' },
        { label: 'Repay', sub: 'Pay 200 shards. Gain +20 max HP and full heal.', act: 'repay', cost: 200 },
        { label: 'Refuse the ledger', sub: 'Nothing. It writes something anyway.', act: 'nothing' },
      ]
    },
    {
      id: 'trainer',
      title: 'The Long Drill',
      body: 'An empty court with a machine at one end that fires orbs at a mercilessly even tempo. Someone has scratched a tally into the wall. The tally is very long.',
      choices: [
        { label: 'Train the window', sub: 'Perfect parry window +25% for the run.', act: 'perm_perfect' },
        { label: 'Train the reach', sub: 'Parry radius +12 for the run.', act: 'perm_reach' },
        { label: 'Train the return', sub: 'Volley damage growth +6% for the run.', act: 'perm_volley' },
      ]
    },
    {
      id: 'altar',
      title: 'Altar of Small Sacrifices',
      body: 'Offerings pile at the foot of a faceless statue: teeth, coins, one very good shoe. The statue’s hands are cupped, and empty, and expectant.',
      choices: [
        { label: 'Offer a sigil', sub: 'Destroy a random sigil. Gain a Relic sigil.', act: 'sac_sigil' },
        { label: 'Offer blood', sub: 'Take 30 damage. Gain a technique charge slot (+35 max Ki).', act: 'sac_blood' },
        { label: 'Offer coin', sub: 'Pay 180 shards for a random Epic sigil.', act: 'sac_coin', cost: 180 },
      ]
    },
    {
      id: 'shrine_speed',
      title: 'The Quiet Shrine',
      body: 'Nobody is buried here. That is the whole point of it. The air has the specific stillness of a held breath, and it is offering to give that stillness to you.',
      choices: [
        { label: 'Kneel', sub: 'Heal 35 HP and refill Ki.', act: 'kneel' },
        { label: 'Take the stillness', sub: 'Move speed +8% for the run.', act: 'perm_speed' },
        { label: 'Desecrate', sub: 'Gain a random sigil. Enemies in the next room are enraged.', act: 'desecrate' },
      ]
    },
  ];

  /* ============================================================
     META UPGRADES (Shrine of Resolve)
     ============================================================ */
  const META = [
    { id: 'm_hp', name: 'Thicker Vessel', desc: '+8 starting max HP per rank.', ranks: 5, cost: [30, 60, 110, 190, 300], apply: (s, r) => { s.maxHp += 8 * r; } },
    { id: 'm_pow', name: 'Sharper Return', desc: '+5% damage per rank.', ranks: 5, cost: [35, 70, 130, 220, 340], apply: (s, r) => { s.power += 0.05 * r; } },
    { id: 'm_win', name: 'Steadier Hand', desc: '+5% parry window per rank.', ranks: 4, cost: [40, 90, 170, 290], apply: (s, r) => { s.parryWindow *= (1 + 0.05 * r); } },
    { id: 'm_perf', name: 'Sharper Instinct', desc: '+8% perfect window per rank.', ranks: 4, cost: [55, 110, 200, 330], apply: (s, r) => { s.perfectWindow *= (1 + 0.08 * r); } },
    { id: 'm_ki', name: 'Deeper Well', desc: '+10 max Ki and +8% regen per rank.', ranks: 4, cost: [30, 65, 120, 210], apply: (s, r) => { s.kiMax += 10 * r; s.kiRegen *= (1 + 0.08 * r); } },
    { id: 'm_spd', name: 'Lighter Step', desc: '+4% move speed per rank.', ranks: 4, cost: [30, 65, 120, 210], apply: (s, r) => { s.speed *= (1 + 0.04 * r); } },
    { id: 'm_dash', name: 'Second Shadow', desc: 'Rank 1: -12% dash cooldown. Rank 2: +1 dash charge.', ranks: 2, cost: [90, 260], apply: (s, r) => { s.dashCooldown *= (1 - 0.12 * Math.min(r, 1)); if (r >= 2) s.dashCharges += 1; } },
    { id: 'm_shard', name: 'Grave Robber', desc: '+15% shards found per rank.', ranks: 4, cost: [25, 55, 100, 180], apply: (s, r) => { s.shardMult = (s.shardMult || 1) * (1 + 0.15 * r); } },
    { id: 'm_start', name: 'Full Purse', desc: '+60 starting shards per rank.', ranks: 3, cost: [40, 90, 160], apply: (s, r) => { s.startShards += 60 * r; } },
    { id: 'm_choice', name: 'Wider Spoils', desc: 'Rewards offer +1 choice.', ranks: 1, cost: [200], apply: (s, r) => { s.extraChoice = r; } },
    { id: 'm_luck', name: 'Crooked Fate', desc: 'Better sigil rarity odds per rank.', ranks: 3, cost: [110, 230, 400], apply: (s, r) => { s.luck += r; } },
    { id: 'm_heal', name: 'Slow Mending', desc: 'Rest sites heal +10% max HP per rank.', ranks: 3, cost: [45, 95, 175], apply: (s, r) => { s.restBonus = 0.1 * r; } },
    { id: 'm_rev', name: 'One More Breath', desc: 'Start each run with a revive.', ranks: 1, cost: [500], apply: (s, r) => { s.revives += r; } },
    { id: 'm_tech', name: 'Open Channel', desc: 'Start the run with a 2nd technique.', ranks: 1, cost: [350], apply: (s, r) => { s.extraTech = r; } },
    { id: 'm_curse', name: 'Curse-Bearer', desc: 'Cursed sigils lose 30% of their drawback.', ranks: 1, cost: [280], apply: (s, r) => { s.curseSoften = 0.3; } },
    { id: 'm_elite', name: 'Grudge', desc: '+18% damage to elites and bosses per rank.', ranks: 3, cost: [90, 190, 330], apply: (s, r) => { s.eliteDmg = 0.18 * r; } },
  ];

  /* ============================================================
     ACHIEVEMENTS / UNLOCK KEYS shown on end screen
     ============================================================ */
  const UNLOCKS = {
    sector2: { name: 'The Wraith', kind: 'Vessel' },
    tank: { name: 'The Bulwark', kind: 'Vessel' },
    rally15: { name: 'Halfheart', kind: 'Vessel' },
    win: { name: 'The Deadman', kind: 'Vessel' },
  };

  /* ============================================================
     CODEX — how to play
     ============================================================ */
  const HELP = `
<h3>The Only Rule</h3>
<p>Combat is a <em>rally</em>. Death orbs cross the arena. If one touches you and you are not parrying, it hurts —
and it hurts more the longer the rally has been going. <em>Return it, or become the answer.</em></p>

<h3>Controls</h3>
<ul>
<li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — move</li>
<li><kbd>Mouse</kbd> — aim (this is where a parried orb goes)</li>
<li><kbd>RMB</kbd> or <kbd>K</kbd> — <em>Parry</em></li>
<li><kbd>LMB</kbd> — hold to charge, release to fire your own orb</li>
<li><kbd>Space</kbd> — dash (brief invulnerability)</li>
<li><kbd>Q</kbd> / <kbd>E</kbd> — techniques</li>
<li><kbd>Esc</kbd> — pause &nbsp;·&nbsp; <kbd>Tab</kbd> — loadout</li>
</ul>
<p>Gamepad is supported: left stick moves, right stick aims, <em>RT</em> fires, <em>RB</em> parries, <em>A</em> dashes.</p>

<h3>Reading the Orb</h3>
<p>You can tell at a glance what an orb will do to you, by its <em>shape</em>:</p>
<ul>
<li><em>Spiked, red-hot core</em> — an enemy orb. <em>This is the one you parry.</em> The thin outer rim is tinted
with the colour of whatever threw it.</li>
<li><em>Smooth rings with a forward arrow</em> — yours. It cannot hurt you. Ignore it and let it fly.</li>
<li><em>Spiked with a white outline</em> — a <em>LIVE</em> orb (only possible with the <em>Both Hands</em> sigil).
It is yours, it still damages enemies, and it will also kill you.</li>
</ul>
<p>Anything spiked can hurt you. Anything smooth cannot. Every orb past two exchanges also shows its rally count.</p>

<h3>Parrying</h3>
<p>Pressing parry opens a short window. If an orb enters your reach during it, you send it back along your aim —
faster, and considerably angrier. Parry <em>early in the window</em> for a <em>PERFECT</em>: bigger growth, extra Ki,
a shockwave, and a slice of slow motion.</p>
<p>Miss, and you are locked in recovery. Parry spam is punished. Read the orb.</p>
<p>You cannot parry your own orbs, and an orb cannot be parried twice in quick succession — one press, one return.</p>

<h3>Charging</h3>
<p>Hold <kbd>LMB</kbd> to charge a shot of your own. The instant it fills, a white ring closes in: release inside that
ring for a <em>PERFECT RELEASE</em> — far more damage, much more speed, and the orb starts the rally two exchanges in.
Miss the beat and you simply fire a normal full-charge shot. There is no penalty for waiting.</p>

<h3>Shields</h3>
<p><em>Sentinels</em> and <em>Wardstones</em> block almost all damage from the front. Ordinary shots bounce off —
but an orb carrying a rally of <em>3 or more</em> punches straight through, shatters the shield permanently,
and lands in full. The rally is the answer to the wall.</p>

<h3>The Volley Counter</h3>
<p>Each exchange raises the rally count. Orb speed and damage climb with it. A 12-volley orb is a room-clearing
weapon and a one-shot death sentence in the same object. <em>You are always holding both.</em></p>

<h3>Choose Your Target</h3>
<p>Aim matters more than anything. Some enemies return orbs reliably (<em>Mirrorwardens</em>, <em>Duelists</em>);
others cannot parry at all (<em>Husks</em>, <em>Censers</em>). Build a monstrous rally against a good returner,
then aim the finish at something that cannot answer.</p>

<h3>Ki &amp; Techniques</h3>
<p>Parries generate Ki. Techniques spend it. Perfects generate much more — aggression funds itself.</p>

<h3>The Descent</h3>
<p>Four sectors, each ending in a boss. Between rooms you choose your path: combat, elite, shop, rest, event, treasure.
Death returns you to the Shrine of Resolve, where <em>Resolve</em> earned in the run buys permanent upgrades.</p>
`;

  /* ---------- lookups ---------- */
  const byId = (arr) => { const m = {}; for (const x of arr) m[x.id] = x; return m; };
  const SIGIL_MAP = byId(SIGILS);
  const TECH_MAP = byId(TECHNIQUES);
  const ENEMY_MAP = byId(ENEMIES);
  const BOSS_MAP = byId(BOSSES);
  const VESSEL_MAP = byId(VESSELS);
  const META_MAP = byId(META);

  return {
    RARITY, BASE_STATS, VESSELS, TECHNIQUES, SIGILS, ENEMIES, BOSSES,
    SECTORS, MODIFIERS, EVENTS, META, UNLOCKS, HELP,
    SIGIL_MAP, TECH_MAP, ENEMY_MAP, BOSS_MAP, VESSEL_MAP, META_MAP,
  };
})();
