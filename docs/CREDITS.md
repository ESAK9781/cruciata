# Asset credits

Sound recordings by **Kenney**, used under **Creative Commons CC0**:

- [RPG Audio](https://kenney.nl/assets/rpg-audio): wood chopping, cloth handling, coins, weapon handling, and wooden mechanisms.
- [Impact Sounds](https://kenney.nl/assets/impact-sounds): metal combat, mining, construction, siege impacts, and bells.
- [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds): selected explosion recordings for siege shell impacts; electronic weapon effects are not used.
- [Interface Sounds](https://kenney.nl/assets/interface-sounds): interface clicks and confirmations.

Original license files are included alongside the selected OGG recordings in `assets/audio/`. Siege impacts have priority over quiet work sounds and use a longer hearing range. `great-landing.wav` and `trebuchet-landing.wav` are original local mixes derived from Kenney's `lowFrequency_explosion_001.ogg`, pitched down and low-pass filtered, with a smooth bass decay. Siege sounds contain no generated noise layer; launches use mechanical recordings, and attack acknowledgments use a locally synthesized musical cue. Effects volume and mute remain independent of music.

[Particle Pack](https://kenney.nl/assets/particle-pack) by **Kenney**, **CC0**, supplies six transparent smoke, dirt, spark, light, and flame textures bundled in `assets/particles/` with the original license. Canvas tinting matches the battlefield palette. These particles are used for siege trails, landing debris, construction sparks, destruction dust and moving troops; projectile heads render above the trails. No runtime downloads are required.

Battlefield artwork and resource icons are original game assets. `src/settlement-art.js` supplies forward-facing Christian masonry/timber/gables and Islamic plaster courtyard compounds, patterned tile, pointed arches, domes and minarets. `src/people-art.js` paints detailed curved figures and resource-specific harvesting tracks; `src/siege-art.js` supplies mechanical animation masters. `src/isometric-art.js` supplies vegetation, resources, props and shared composition. `scripts/bake-art.js` creates trimmed, deduplicated local PNG sprite pages, including animation poses. `scripts/generate-resource-icons.js` creates the matching SVG HUD icons. The game requires no third-party renderer or external download. Surface textures, water and billboard particles complement the sprites.

Background music recordings supplied by the user are bundled in `assets/music/`:

- Midday at the Oasis
- Lanterns by the Slope
- Shadows in the Stone Courtyard
- Iter Nostrum

They play as one shuffled playlist, independently of gameplay. Each recording plays once per shuffle cycle; the last recording cannot immediately repeat when a new cycle starts. Default music volume is 20%; sound effects default to 65%. Both controls persist in browser storage. Original generation prompts are retained in `MUSIC_PROMPTS.md`.

Campaign atlas geography is derived from Natural Earth's 1:50m land and coastline layers, clipped to the eastern Mediterranean and stored locally in `assets/maps/levant-coast.js`. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) place these data in the public domain. The source GeoJSON is maintained in the [Natural Earth vector repository](https://github.com/nvkelso/natural-earth-vector). The coastal outline is geographical; chapter positions are spaced along a stylized route for clarity. Battlefields and the campaign narrative are fictional.

Latin scripture excerpts use the Holy See's Nova Vulgata: [Matthew 5:9](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_nt_evang-matthaeum_lt.html), "Beati pacifici, quoniam filii Dei vocabuntur," and [Psalm 127:1](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_vt_psalmorum_lt.html), "Nisi Dominus aedificaverit domum." English scene translations are brief original renderings. The Nova Vulgata is a modern Latin edition used here for verified wording, not a claim about the precise edition read by fictional medieval characters.
