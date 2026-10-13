# cruciata

A static, stylized overhead RTS about a fictional pilgrim host during the First Crusade. Six campaign chapters combine settlement building, an escorted river crossing, a winter defense, village protection, wall breaches, and the occupation of Jerusalem. Original canvas artwork, Jerusalem Cross standards, mission briefings, Catholic imagery, and sourced Latin scripture establish the atmosphere.

## Run and deploy

Play at [esak9781.github.io/cruciata](https://esak9781.github.io/cruciata/). Source: [ESAK9781/cruciata](https://github.com/ESAK9781/cruciata).

Run `npm ci` and `npm start`, then open `http://localhost:3000`. Run `npm run build` to create the complete static site in `dist/`. Upload that folder to any static host; no backend, account, database, or external font is required. Paths also work under a GitHub Pages repository subpath.

The included `.github/workflows/pages.yml` checks source, builds, and publishes `dist/`. Browser tests run locally, outside the deployment workflow. In GitHub repository Settings / Pages, choose GitHub Actions as the source. The workflow runs on main/master or manually.

## Campaign and quickmatch

Every page opening lands on the main menu. The campaign atlas spaces nearby waypoints along a stylized route over Natural Earth land/coastline data, with completed and available chapters marked separately. The battlefields and campaign narrative are fictional. Chapters begin with a short mission briefing; illustrated cutscenes have been removed.

The main menu is part of the initial HTML and covers the battlefield before scripts load, including on slow connections. Its controls become available when initialization finishes.

Quickmatch has exactly three independent local save slots. Create a session through its setup menu, use Frontier, Siege, Scarcity, or Empire presets, or choose map size, resource frequency, starting stores, soldiers, army composition, villagers, developed or basic structures, biome, seed, and difficulty. Maps range from 12800 by 8800 to 19200 by 12800. Both settlements receive the same chosen starting conditions. Generated terrain and nonlocal resource clusters repeat for a given seed.

Easy, Normal, and Hard change the enemy's planning interval, worker targets, scouting, assault size, and retreat decisions. The opponent pays the same costs, trains through the same queues, constructs with villagers, gathers finite deposits, observes its own fog of war, and only chooses discovered attack targets. It receives no free reinforcement waves or automatic income. Higher ranks and faith blessings follow the same mechanics for both armies. Enemy healers, guard variations, and prayer houses use their own names and crescent heraldry.

## Controls and economy

- Left click selects units, buildings, and finite resource patches. Shift-click adds units or structures. Drag over structures to select several; Alt-drag prioritizes structures when troops share the rectangle. Left-drag selects troops. With no units or buildings selected, right-drag pans the map.
- Right click commands selected troops, assigns villagers to gathering, construction, or repairs, or sets a selected production building's rally banner.
- WASD or arrows pan; wheel zooms. The interface fills the available screen without a maximum page width or browser scrolling.
- Rotate a gate before placing it with R or the Rotate gate button. Its footprint, preview, construction, and saved orientation turn together. Gates start closed and can be opened after construction.
- Space selects soldiers; E selects villagers; V selects an idle villager; Q centers the settlement.
- F then click orders a fighting advance. H holds. G scouts as a company, explores unknown land, and withdraws without fighting; manual movement, attack, hold, or deployment orders end auto scouting. B spends 30 faith to bless selected soldiers. T sets up or packs trebuchets. X cancels. Escape pauses or cancels an active command.
- Ctrl+1 through Ctrl+9 save control groups; 1 through 9 recall them. Shift+1 through Shift+7 queue infantry, archers, cavalry, chaplains, villagers, standards, and trebuchets.

Plan a foundation through Build without selecting a villager; its cost is paid immediately. Right-click it with villagers to assign construction. Hold Shift while placing another foundation or commanding villagers to a project to queue construction behind their current project. Scaffolds, rising masonry, cranes, and material piles show progress. Completed depot builders automatically seek their depot's resource. Damage causes progressive cracks, roof breaches, smoke, fire, and rubble.

Curtain walls remain cheap and quick to build, but have 3200 health; gatehouses have 4200. Reinforced masonry absorbs most ordinary weapon damage, particularly arrows. Trebuchets deal increased damage against fortifications, making siege engines and defended breaches central to assaults. Archers and trebuchets can fire over intact walls.

Villagers harvest food, timber, gold, and stone, carry supplies, and credit them only at a suitable depot. Town centers accept all resources; mills accept food; lumber camps accept wood; mining camps accept gold and stone. Local depots shorten delivery trips. Grain fields hold 2400 food and support up to five workers inside their passable footprint. Deposits deplete. Clicking a patch shows its total and remaining stock; Clear patch assigns selected or idle villagers to remove an obstruction without recovering its resources.

Houses provide twelve population and town centers thirty-two, up to 260 per army. Faster training and lower soldier costs support larger armies. Infantry protects the front; archers maintain distance; cavalry seeks vulnerable opponents; chaplains heal and retreat; standards strengthen nearby allies. Troops move independently and form into role-based arrival positions if the destination is safe. Combat takes priority over forming up.

Select a barracks, stable, chapel, or siege workshop to see its training and unit-variation upgrades. Swordsmen become Templars and then Veteran Templars; other combat roles have corresponding two-stage variations. An upgrade improves every existing unit of that base type and every future recruit, adding 25 percent health and damage per rank. There is no resource trading or global generic research menu.

Curtain walls block passage and must be destroyed. Gatehouses can open or close their gap. Drag to lay horizontal, vertical, or diagonal curtain walls with automatic corner joints and exposed-edge crenellations. Hold Shift when releasing to retain the endpoint and add a connected waypoint. Each tile-sized segment costs 12 stone and 3 wood and takes four seconds of construction. Builders continue along assigned wall lines. Trebuchets need six seconds to set up and four to pack, fire between 180 and 690 paces, and cause heavy area damage to both enemy and allied units. Keep infantry out of the impact zone.

## Local saves, sound, and presentation

Campaign progress, preferences, and full active matches use browser local storage. Campaign and three quickmatch sessions are separate. Autosaves occur every twenty simulation seconds and when leaving a live game; the menu never replaces an existing battle with its preview. Saves are specific to the browser and website origin. Manual Save is available in the header. Version-two campaign checkpoints migrate on resume, preserving the company and stores while adding the enemy economy and finite fields; the old checkpoint remains as a backup.

Four user-supplied MP3s play as a quiet shuffled background playlist independent of gameplay. Each track plays once per bag with no adjacent repeat across bags and gentle fades. Music and effects have separate persisted volume controls; Next track is available. Kenney CC0 recordings provide restrained combat, gathering, construction, and interface sounds. Playback starts after interaction and pauses while the tab is hidden. Original prompts remain in [MUSIC_PROMPTS.md](MUSIC_PROMPTS.md); sources and licenses are in [CREDITS.md](CREDITS.md).

Units and structures use original overhead assets with ranked armor, shields, religious standards, worker tools, scaffolding, and damage states. Dense forest canopies cover their navigation exclusion area. Harvesting, construction, blessing, impact, and blood particles emphasize actions. Stylized battlefield casualties and heavier siege gore can be disabled in Settings. Game text cannot be accidentally highlighted; setup inputs remain editable.

## Verification

Run `npm run check` and `npm test` after installing Chromium and Firefox with `npx playwright install chromium firefox`. The current suite checks menu transitions, production-save preservation, all six campaigns, quickmatch slots and seeds, both economies and resource conservation, formations and healer behavior, construction assignment, finite fields and clearing, unit upgrades, walls and gates, siege setup and friendly fire, fog, minimap dragging, independent audio controls and actual audio decoding, five viewport sizes including 4K and mobile, and static deployment at root and repository subpaths.

Diagnostic simulation controls are available only under `/?test`; production rejects their mutations. Visual-review screenshots are saved in `artifacts/`. Previous-version tests are archived there for reference; the active suite exercises the current rules.

The `DEBUG_MODE` flag near the top of `game.js` is currently `true`. Debug in the header or F2 opens playtesting cheats: resources, 48 troops, healing, invulnerability, instant construction/training, map reveal, 4x speed, removal of enemy combat troops, and victory. Set the flag to `false` to remove the menu and disable cheats. Cinematics have been removed; campaign chapters use a short mission briefing. Enemy scouts avoid combat, and offensive companies wait at least five/four/three minutes on Easy/Normal/Hard before launching against discovered locations.

Every campaign can also end immediately through capital destruction: losing your town center is defeat; destroying the opposing capital or main citadel is victory regardless of secondary objectives. Neutral villages are protected from attacks and are claimed by bringing at least three soldiers close. Buildings without troop production cannot set rally points. Cancelled foundations vanish; destroyed buildings leave detailed rubble. Resources and rocks form clusters, exhausted patches disappear, and impassable rock masses break up open terrain. Roads connect actual settlements along passable routes. Water ripples animate along ocean shores and rivers, grass bends around moving troops, and mouse-wheel zoom preserves the ground under the cursor.

Starting enemy troops and owned fortifications are grouped on the far side of each map. Coastal and bridge outposts begin neutral, with no faction vision. Either army can capture an uncontested site with three soldiers over eighteen seconds. Foundations can be planned anywhere already explored, but unfinished construction provides no vision.

Starting structures are checked for overlapping footprints, map boundaries, and impassable ground before terrain resources are generated. Soldiers muster in spaced ranks just outside their settlement, facing toward the opponent; villagers also start on clear ground.

Procedural rock clusters form impassable masses with automatically joined outer edges and a single black interior. Only exposed boundaries receive stone detail; internal tile seams disappear. Mountains and their elevation renderer have been removed. Natural features are checked against water using their full footprint. Roads use a separate route planner with clearance for their painted width and are clipped to land and valid bridges.

The enemy invests in city walls, four usable gates, approach towers, and fortification repairs. Construction uses explored ground, real villagers, ordinary build times, and paid resources. Gates stay open for its economy and close when its own vision discovers an approaching threat.

Two independent fortified cities are siege objectives in new campaign and quickmatch maps. Their gold standards identify defensive garrisons; they never launch raids. Breach the walls and hold the marked center with at least three soldiers for twelve seconds, without hostile troops nearby. Every surviving city building and unit joins the player, and its gates open. The center is protected from demolition so it remains capturable; city capture does not replace the main capital victory condition.

Archer arrows and trebuchet fire pass over walls; walls still block troop movement. Villagers exhaust only the connected patch cluster they were assigned, deliver their final load, and stop instead of seeking a distant deposit. Exhausted grain fields are automatically replanted by their assigned workers (eight worker-seconds) before harvesting resumes.

Navigation uses the same six-pace collision radius as movement, a finer sixteen-pace grid, and exact obstacle-edge routes for narrow passages between grid points. Units finish corner waypoints before turning, so they do not cut into tight entrances.

Golden grass grows in small meadow regions and bends around moving troops. River valleys add reeds, arid ground adds dry brush and dust, and winter patches react with disturbed snow. These effects do not block movement. Campaign victories return directly to the atlas, where the waving army standard advances toward the next chapter. Completion and unlocks are recorded separately from active battle checkpoints. Local tests run at reduced priority with an eight-second rest between cases; run only the relevant test files or use Playwright `--grep` for a focused batch.
