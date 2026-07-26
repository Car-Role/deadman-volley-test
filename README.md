# DEADMAN VOLLEY

A browser roguelike where **every fight is a rally**.

A death orb crosses the arena. If it touches you and you aren't parrying, it hurts —
and it hurts more the longer the rally has run. Parry it back and it returns *faster*
and *angrier*, at whichever enemy you're aiming at. Whoever drops it, eats it.

You are always holding the win condition and the loss condition. They are the same object.

---

## Play it

**Double-click `index.html`.** That's it — no build step, no dependencies, no network.

For a local server instead (recommended while editing, since it disables caching):

```bash
python3 serve.py 8781
```

Then open <http://localhost:8781>.

---

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Aim — **this is where a parried orb goes** |
| Right Mouse / `K` | **Parry** |
| Left Mouse | Hold to charge, release to fire your own orb |
| `Space` | Dash (brief invulnerability) |
| `Q` / `E` | Techniques |
| `Esc` | Pause · `Tab` — loadout |

Gamepad is supported: left stick moves, right stick aims, **RT** fires, **RB** parries, **A** dashes.

---

## Reading the orb

You can tell what an orb will do to you from its **shape**, before you read any colour:

| | |
|---|---|
| **Spiked, red-hot core** | An enemy orb. **This is the one you parry.** The thin outer rim is tinted with the colour of whatever threw it. |
| **Smooth rings + forward arrow** | Yours. It cannot hurt you. Ignore it. |
| **Spiked with a white outline** | A **LIVE** orb — only possible with the *Both Hands* relic. Yours, still damages enemies, and will also kill you. |

Anything spiked can hurt you; anything smooth cannot. Every orb past two exchanges also
carries its rally count, and hostile orbs draw a reticle that tightens as they close on you.

## The mechanic

Pressing parry opens a **short active window**. If an orb enters your reach during it,
you send it back along your aim.

- Parry **early in the window** for a **PERFECT** — bigger growth, extra Ki, a shockwave, and slow motion.
- **Miss** and you're locked in recovery. Parry spam is punished. Read the orb.
- Every exchange raises the **rally counter**. Speed and damage climb with it.
- You **cannot parry your own orbs**, and no orb can be parried twice in quick succession —
  one press, one return.

**Aim is the real decision.** Some enemies return orbs reliably (Mirrorwardens ~96%,
Duelists ~72%); others can't parry at all (Husks, Censers). Build a monstrous rally
against a good returner, then aim the finish at something that can't answer.
A white ring around an enemy means *it intends to return your next orb*.

## Charging

Hold **LMB** to charge a shot. The instant it fills, a white ring closes in — release
inside that ring for a **PERFECT RELEASE**: ×1.6 damage, ×1.35 speed, and the orb starts
the rally two exchanges in. Miss the beat and you simply fire a normal full-charge shot.
There is no penalty for waiting for a safe opening.

## Shields

*Sentinels* and *Wardstones* block ~88% of damage from the front, and show three pips on
the shield arc. An orb carrying a rally of **3 or more** punches straight through, lands in
full, and **shatters the shield permanently**. The rally is the answer to the wall.

---

## Structure

- **4 sectors**, each a branching node map ending in a boss.
- Room types: combat, elite (with a modifier), shop, rest, event, treasure.
- **34 sigils** across 5 rarities — including *Cursed* ones that are genuinely strong and genuinely cost you.
- **12 techniques**, **14 enemy types**, **4 bosses** with multi-phase scripted patterns.
- **6 vessels**, each with a distinct passive that changes how the rally plays.
- Death feeds **Resolve** into the Shrine, which buys permanent upgrades and unlocks vessels.

Progress and settings save to `localStorage`. A run in progress can be resumed from the title.

---

## Layout

```
index.html          markup + screen scaffolding
css/style.css       all interface styling
js/util.js          math, seeded RNG, easing, colour
js/audio.js         fully procedural WebAudio (SFX + generative score) — no asset files
js/input.js         keyboard / mouse / gamepad
js/fx.js            particles, shockwaves, shake, hitstop, cached glow sprites
js/content.js       all game data: vessels, sigils, techniques, enemies, bosses, events
js/entities.js      Orb, Player, Enemy, Boss, Decoy, Pickup
js/arena.js         combat scene: spawning, collision, the parry pipeline, HUD
js/map.js           sector map generation, drawing, room/wave construction
js/ui.js            DOM screens
js/game.js          boot, main loop, run lifecycle, persistence
tools/soak.js       headless simulation harness
serve.py            no-cache static dev server
```

There is no audio or image asset anywhere — every sound is synthesised at runtime and
every visual is drawn to canvas.

---

## Testing

`tools/soak.js` runs the game's logic headlessly (no DOM, no rendering) with a scripted
bot, so stability and performance can be checked without a browser:

```bash
node tools/soak.js                      # full sweep: 6 vessels x 4 sectors x every technique pair
node tools/soak.js --vessel=wraith      # one vessel
node tools/soak.js --watchdog=2000      # abort if any frame exceeds 2000ms
```

It binds **every sigil at once** — the worst case for hook interactions — and exits
non-zero if any frame throws or trips the watchdog. The full sweep simulates 312 rooms.

It also runs deterministic checks and asserts invariants across the whole sweep:

- your own orbs are never parried without *Both Hands*
- no orb is re-parried within 0.30s without an enemy return in between
- a volley-2 orb does **not** break a shield; a volley-3 orb does, in full
- an on-beat release pays out and a late release does not
- shield-break, perfect-release and LIVE-orb paths are all actually exercised

---

## Notes on two things that bit during development

**Orb population is capped.** Split/echo effects (`Fork of the Path`, `Split Palm`,
`Echo Chamber`, Halfheart's passive) multiply orbs per parry, which compounds
exponentially across a long rally. `Arena.spawnOrb` enforces a soft cap on derived orbs
and a hard cap with eviction.

**Glow is baked, not built.** Every glowing object used to construct a
`createRadialGradient` per frame; with a screen full of high-volley orbs that alone
could stall a frame for seconds. `FX.glow` blits a cached per-colour sprite instead —
worst-case draw went from seconds to ~0.7ms at full native resolution.
