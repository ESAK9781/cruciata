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
- [x] data tables, world generation (all six chapters exact), navigation, quadtree, fog
- [x] simulation (`update`), workers, combat, siege, AI, campaigns (long-run AI is statistical, not exact)
- [x] player commands (`commands.rs`, `orders.rs`, `lockstep::PlayerCommand`); parity: orders, recruit, house placement (`tests/commands_parity.rs`)
- [x] PvP flag (`Settings::pvp`), `state_hash`, determinism test (`tests/determinism.rs`)
- [x] saves (`save.rs`, web-compatible JSON; `tests/save_roundtrip.rs`)
- [x] LAN: `crates/net` discovery, TCP link, lockstep, handshake (`tests/lan.rs`)
- [x] native client `crates/app`: atlas sprites, HUD, input, minimap, fog, menus, saves/autosave, campaign progress, LAN host/join, results, audio
- [x] baked terrain, runtime curtain walls and gatehouses, scaffolds, corpses/gore, impact smoke
- [ ] still approximated: rocks/cliffs, ground cover, roads, Colossus (stand-in from great-engine frames), construction-site reveal details, ships/waves, particles/debris
- [ ] installers, GitHub Actions matrix, releases, web install page
- [x] parity: research, wall lines, gate/tower upgrades, demolish, scout (`tests/commands2_parity.rs`)
