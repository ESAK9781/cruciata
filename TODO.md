# Polish pass: responsiveness, walls, performance and spectacle

- [x] Commit a local backup before starting (388f44a).
- [x] Orders respond on the first frame: provisional movement while shared routes compute, an urgent navigation budget, committed player move orders, stall watchdog and wedge recovery.
- [x] Rebuild curtain rendering as projected prisms so diagonal and bastion segments, towers and gates share seams and footprints at all eight headings.
- [x] Find and fix a 10-second freeze (unbounded route smoothing) plus the 100-300 ms hitches from line-of-sight scans, target scans and flee re-planning.
- [x] Add combat/siege spectacle: sparks, cavalry charge, debris, scorch decals, launch plumes, burning structures, arrow art and order-path lines.
- [x] Gameplay: attack alerts with minimap pings and Z, double-click type selection, charge bonus, river bridge kept clear of neutral city walls, castle layout overlaps resolved.
- [x] Repair stale or racy tests; add responsiveness regression coverage.
- [ ] Full chromium suite green after the final change; Firefox spot-check of movement and art specs.

# Consistent projected artwork

## Current art-direction revision

- [x] Rebuild static and animated textures at 3 pixels per world unit, streaming staged PNG pages to keep bake memory bounded.
- [x] Prioritize walking poses, carry tools lowered while walking, and drive stationary harvesting from the work cycle rather than the movement clock.
- [x] Verify live collecting-to-walking transitions and repeat the high-resolution visual audit.
- [x] Seat cavalry riders on bent legs, animate the horse gait independently, and inspect Christian/Islamic close-ups at all eight headings.
- [x] Verify square attached guard-tower footings against straight and diagonal curtains in all eight headings.

- [x] Face architectural buildings forward, lower buildings/trees, remove building circle shadows and restore curtain/tower integration.
- [x] Give every producer a distinct functional silhouette and material textures; strongly separate Christian and Islamic architecture.
- [x] Replace blocky people with detailed shaded human/horse sprites and readable equipment.
- [x] Add separate wood, stone, gold, field/berry harvesting animations for villagers.
- [x] Shorten standards and keep their resting tails clear of the ground.
- [x] Bake static assets and animation tracks into local sprite atlases; runtime drawing must use pre-rendered assets.
- [x] Repeat the 65-view in-game screenshot audit; verify cache/off-camera behavior, update guides, and package the final assets.

- [x] Create `art/consistent-isometric-assets` preserving the existing workspace.
- [x] Replace overhead buildings, troops, caravans, vegetation, resources, ships, rubble and equipment with coherent shaded geometry.
- [x] Integrate depth ordering, visual bounds, portraits, construction and damage states without changing physical footprints.
- [x] Inspect an asset board and live settlements, check crowded rendering, run focused browser checks and package the static game.
- [x] Extend the in-game screenshot audit across assets, factions, damage/construction, siege poses, gates and biomes; fix discovered occlusion defects.
- [x] Measure stationary sprite/cloth reuse and stop cosmetic work outside the camera while keeping gameplay simulation active.

# Siege and expansion work

## Current presentation corrections

- [x] Replace enlarged army flags with transient cloth physics, forked tails, a slim taller staff, and a complete deforming Jerusalem cross.
- [x] Close bastion corner/attachment rendering gaps and darken bastion stone.
- [x] Give enemy buildings distinct Islamic architecture and preserve its style when captured.
- [x] Reduce great engine size, add an elevated round swivel base, ground bombardment and a targeting cancellation action for both siege weapons.
- [x] Bundle Kenney particles and additional recordings, prioritize audible impacts, and draw trails behind projectile heads.
- [x] Replace the upper engine with circular projected machinery, lower its support hoop, and correct sprite/depth clipping.
- [x] Lower ram, ballista and deployed trebuchet frames; share projected materials and manual player deployment behavior.
- [x] Add stronger matching bastion gates and flat continuous curtain seams.
- [x] Scale projectile artwork with arc height and replace noisy landing effects with deep filtered local mixes.
- [x] Profile and optimize combat searches, collision, wall joins, fog, spatial buckets, sleeping cloth, and cached machinery.
- [x] Prioritize player navigation, cancel obsolete searches, return clear routes immediately, and keep arrival slots on connected ground.
- [x] Verify the final cloth, architecture, siege controls, sounds, and particle layering in both browsers; inspect rendered assets and rebuild.

Current verification: Chromium and Firefox passed focused cloth physics/full heraldry, curtain/tower/gate joins, reinforced bastion upgrades, ground targeting and cancellation, audible filtered landing effects, particle ordering, arc scaling, projected machinery bounds and motion, manual player trebuchet deployment, saved bombardment/legacy footprint migration, prioritized/cancelled navigation, narrow clearance, shared company movement through final arrival, enemy expansion, city archers and regional discovery. All six chapters initialize safely. Syntax/formatting and static packaging passed. The crowded Jerusalem profile improved from about 5.17 to 2.21 seconds for ten simulation seconds (502 units, 1617 buildings); hardware-dependent render frames stayed near 16.7 ms. Reproduce with `npm start` and `node scripts/profile-game.js`.

- [x] Use segmented gates and attached wall towers for new settlements and AI defenses; preserve older save footprints.
- [x] Restore the original gatehouse artwork.
- [x] Correct single-unit arrival positions and preserve explicit attack targets.
- [x] Add target acknowledgment visuals and a custom local audio cue.
- [x] Add bastion walls, battering rams, ballistas, and villager-built permanent great siege engines.
- [x] Enlarge campaign enemy capitals without adding starting citizens.
- [x] Add paid enemy expansion foundations, per-base fortification plans, defense responses, and faster invasion recruitment.
- [x] Complete focused Chromium and Firefox verification and final packaging.

Verification: syntax/formatting and static build passed. Focused Chromium and Firefox checks passed for movement, stances, target persistence, siege damage/construction, expansion, repeated invasions, generated gates, timed gate upgrades, and reinforced bastion upgrades. Existing army route-sharing, contextual command, producer rotation, cancellation, and tower combat checks also passed in Chromium.

# Campaign, presentation, and city overhaul

- [x] Extend the escort and supply routes and create forward enemy camps.
- [x] Rebalance objectives and activate real campaign assault waves across difficulty settings.
- [x] Replace caravan and great engine artwork with detailed canvas assets and mechanical animation.
- [x] Increase great engine range, damage, projectile size, impact effects, audio, and selected range overlay.
- [x] Replace rectangular perimeters with layered irregular defenses and enlarge capturable cities.
- [x] Capture cities immediately at the capital and grant large one-time rewards.
- [x] Enlarge army banners, animate wind, and match wall art to thicker physical collision.
- [x] Give winter a large player castle and six surrounding siege camps.
- [x] Expand Jerusalem into fortified districts with three defensive rings and deployed veteran trebuchets.
- [x] Add regional patrols and discovered-target invasions, with separate saved militia exploration.
- [x] Station city archers behind the curtain in Hold stance with fire over the walls.
- [x] Verify routes, objectives, siege effects, city rewards, navigation, and rendered artwork in both browsers.
- [x] Update architecture notes and produce the final static build.

Verification: all 20 campaign-scale checks passed in Chromium and Firefox. Twelve additional focused checks passed for escort route connectivity, all six chapter initializations, saved gate upgrades, explicit target persistence, precise mobile-unit arrival, and villager-built engine bombardment. Earlier focused regressions also passed for diagonal gates, transferred city residents, generated passages, and bastion construction/upgrades. `npm run check` and `npm run build` passed; native caravan/engine/banner artwork was inspected in a rendered preview. Complete chapter playthroughs remain useful for tuning balance.

## Guard tower overlay polish

- [x] Repaint build previews after atlas pages finish decoding.
- [x] Replace attached stone guard tower bodies with circular platforms layered over continuous wall curtains, with a readable archer figure.
- [x] Version and rebake the attached tower atlas artwork; verify preview pixels, wall joins, syntax, and static packaging.

# Colossal siege engine

- [x] Commit everything before starting (3fd8f8f).
- [x] New `colossus` building: huge cost/build time, one per side, 5-villager crew, order-only fire with distance scatter, same reload/damage/flight as the great engine.
- [x] Both sides are warned and shown the site (toast, horn, banner, minimap marker, world beacon, fog reveal) from the moment it is begun.
- [x] Crew UI (Man engine / Release crew, crew counter, build-card rules), scatter circle while targeting, AI build/crew/bombard.
- [x] `tests/colossus.spec.js`; full Chromium suite and docs.

# Colossus polish, construction sites and command tooltips

- [x] Click picking: trees use silhouette boxes (no atlas pixel read), a resource only beats a structure when drawn in front of it, and large structures score by footprint, so the Colossus and trees select with a plain click.
- [x] Colossus: scatter halved (`20 + 0.045 d`), 700-unit minimum range (order refused, ring drawn, AI skips closer targets), darker bastion-stone/dark-timber palette, gilded bands, braziers, struts and pennants.
- [x] Construction: finished art is revealed course by course behind a scaffold with deck, ladder, hoist, material piles and dust (all buildings, walls, gates, engines).
- [x] Training with several producers selected queues one unit at each; the card shows a x-N badge and tooltip.
- [x] Costs and descriptions live in one hover tooltip; selection text auto-fits its panel.
- [x] `tests/selection-sites.spec.js`, updated colossus/group/revision/control-group specs.


# Native Rust port and LAN multiplayer (branch `rust-native`)

- [x] Deterministic core crate with JS parity fixtures (`rust/PORT.md`).
- [x] Command layer, PvP mode, lockstep net crate, saves.
- [x] Native client: atlas renderer, HUD, picking, orders, minimap, fog.
- [ ] Wire menus/store, LAN host/join flow, autosave, results.
- [ ] Terrain/walls/effects art, audio.
- [ ] Installers, CI release matrix, GitHub releases, install page in the web version.
