# Native Rust port of Cruciata

Goal: a native desktop game (no web view, no JS) with the same behaviour as the
web game in `../src`, plus automatic LAN PvP. Everything is tested against the
JS implementation ("differential testing").

## Layout

- `crates/core`   deterministic simulation (no I/O): numeric helpers that are
  bit-identical to V8 (`js`, `fdlibm`), data tables, world generation,
  navigation, fog, simulation, AI, campaign rules, saves.
- `crates/net`    LAN discovery and lockstep transport (std networking).
- `crates/app`    window, rendering, UI, audio, menus.
- `tools/*.js`    scripts that run the JS game in Playwright and write fixtures
  into `fixtures/` (never edit fixtures by hand).
- `fixtures/`     reference output produced by the JS game.

## Rules for porting

1. Port line by line; keep names (`snake_case` of the JS names), operation
   order and floating-point expression shape identical, so results are
   bit-identical. Never "simplify" arithmetic.
2. Use `js::{sin,cos,atan2,hypot,round,clamp}`; never `f64::sin` etc.
3. `Math.random()` in simulation code goes through `State::rng` (a stream that
   the JS harness replaces with the identical generator for comparisons).
   Cosmetic randomness (particles, blood) is not part of the state hash.
4. Object references in JS are ids in Rust. Entities live in `Vec`s ordered
   exactly like the JS arrays (iteration order matters for parity).
5. State serialises to the same JSON schema as `cruciata.snapshot()`, so JS saves
   load in Rust and Rust states can be diffed with JS states.
6. Every ported system gets a parity test before moving on.

## Status

See the checklist at the bottom; update it as work lands.

- [x] V8-exact `sin`/`cos`/`atan2`/`hypot`/`round`, mulberry32 (`tests: js::tests`)
- [ ] data tables (TYPES, BUILDINGS, LEVELS, TECHS)
- [ ] world generation + level setup (`startLevel`)
- [ ] navigation, quadtree, fog
- [ ] simulation (`update`), orders, workers, combat, siege, AI, campaigns
- [ ] saves (JSON, JS-compatible)
- [ ] native renderer (tiny-skia + baked atlas), UI, audio, menus
- [ ] LAN multiplayer (discovery + lockstep)
- [ ] installers, GitHub releases, install page
