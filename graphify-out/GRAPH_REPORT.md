# Graph Report - Deadman volley test  (2026-07-26)

## Corpus Check
- 14 files · ~45,692 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 333 nodes · 599 edges · 14 communities (10 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6ff60985`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- audio.js
- Enemy
- Arena
- ui.js
- fx.js
- game.js
- util.js
- soak.js
- input.js
- Player
- DEADMAN VOLLEY
- map.js
- NoCacheHandler

## God Nodes (most connected - your core abstractions)
1. `Arena` - 38 edges
2. `tone()` - 36 edges
3. `now()` - 26 edges
4. `noise()` - 21 edges
5. `Enemy` - 14 edges
6. `Player` - 13 edges
7. `Boss` - 11 edges
8. `show()` - 11 edges
9. `init()` - 11 edges
10. `DEADMAN VOLLEY` - 11 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (14 total, 4 thin omitted)

### Community 0 - "audio.js"
Cohesion: 0.11
Nodes (47): boss_die(), boss_intro(), charge_full(), charge_perfect(), charge_start(), danger(), dash(), death() (+39 more)

### Community 1 - "Enemy"
Cohesion: 0.06
Nodes (5): Boss, Decoy, Enemy, Orb, Pickup

### Community 3 - "ui.js"
Cohesion: 0.15
Nodes (30): bindTip(), click(), fitCards(), genericCard(), hideOverlay(), hideTooltip(), init(), isVesselUnlocked() (+22 more)

### Community 4 - "fx.js"
Cohesion: 0.09
Nodes (11): burst(), chroma(), chromatic(), glow(), glowSprite(), hitstop(), impact(), particle() (+3 more)

### Community 5 - "game.js"
Cohesion: 0.15
Nodes (26): afterBoss(), boot(), checkUnlocks(), drawAmbient(), grantSigil(), loadJSON(), loop(), makeAmbient() (+18 more)

### Community 6 - "util.js"
Cohesion: 0.13
Nodes (11): angDiff(), angLerp(), clamp(), hexToRgb(), inv(), lerp(), map(), mixHex() (+3 more)

### Community 7 - "soak.js"
Cohesion: 0.11
Nodes (19): ALL_SIGILS, ALL_TECHS, args, buildStats(), fakeNode(), fs, installBot(), main() (+11 more)

### Community 8 - "input.js"
Cohesion: 0.13
Nodes (4): act(), clearAll(), endFrame(), moveVec()

### Community 10 - "DEADMAN VOLLEY"
Cohesion: 0.17
Nodes (11): Charging, Controls, DEADMAN VOLLEY, Layout, Notes on two things that bit during development, Play it, Reading the orb, Shields (+3 more)

## Knowledge Gaps
- **22 isolated node(s):** `fs`, `path`, `vm`, `ROOT`, `args` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Player` connect `Player` to `Enemy`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `fs`, `path`, `vm` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `audio.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10633484162895927 - nodes in this community are weakly interconnected._
- **Should `Enemy` be split into smaller, more focused modules?**
  _Cohesion score 0.06448202959830866 - nodes in this community are weakly interconnected._
- **Should `Arena` be split into smaller, more focused modules?**
  _Cohesion score 0.1141025641025641 - nodes in this community are weakly interconnected._
- **Should `fx.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08866995073891626 - nodes in this community are weakly interconnected._
- **Should `util.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12681159420289856 - nodes in this community are weakly interconnected._