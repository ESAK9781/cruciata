/* Reproducible visible/idle/moving/off-camera render workload; npm start first. */
const { chromium } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    await page.goto("http://127.0.0.1:3000/?test");
    await page.locator("#open-campaign").click();
    const result = await page.evaluate(async () => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(0);
      let state;
      cruciata.scenario((s) => {
        state = s;
        const u = s.units.find((u) => u.team === 0 && u.type === "sword"),
          b = s.buildings[0];
        s.units = Array.from({ length: 80 }, (_, i) => ({
          ...u,
          id: 99000 + i,
          x: 1270 + (i % 10) * 36,
          y: 2360 + Math.floor(i / 10) * 35,
          angle: -0.6,
          visualAngle: -0.6,
          order: null,
          target: null,
          moving: false,
          strike: 0,
          rank: i % 3,
        }));
        for (const [i, type] of [
          "ram",
          "ram",
          "ram",
          "ram",
          "ballista",
          "ballista",
          "ballista",
          "ballista",
          "ballista",
          "ballista",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "trebuchet",
          "merchant",
          "merchant",
        ].entries())
          s.units.push({
            ...u,
            id: 99200 + i,
            type,
            x: 1100 + (i % 10) * 90,
            y: 2740 + Math.floor(i / 10) * 110,
            angle: -0.6,
            visualAngle: -0.6,
            order: null,
            target: null,
            moving: false,
            strike: 0,
            deployment: "deployed",
            deployTimer: 0,
          });
        for (let i = 0; i < 4; i++) {
          const flag = {
            ...u,
            id: 99400 + i,
            type: "standard",
            x: 1400 + i * 50,
            y: 2630,
            angle: -0.6,
            order: null,
            target: null,
            moving: false,
            strike: 0,
          };
          s.units.push(flag);
          for (let j = 0; j < 6000; j++)
            CruciataArt.updateStandard(flag, 1 / 120);
        }
        s.buildings = [
          {
            ...b,
            id: 99600,
            kind: "greatengine",
            x: 1200,
            y: 2630,
            w: 162,
            h: 140,
            team: 0,
            hp: 6000,
            maxHp: 6000,
            progress: 1,
            lastShot: -100,
            aimAngle: -0.6,
            queue: [],
          },
          {
            ...b,
            id: 99601,
            kind: "greatengine",
            x: 1810,
            y: 2630,
            w: 162,
            h: 140,
            team: 0,
            hp: 6000,
            maxHp: 6000,
            progress: 1,
            lastShot: -100,
            aimAngle: -0.6,
            queue: [],
          },
        ];
        s.nodes = [];
        s.decorations = [];
        s.cities = [];
        s.sites = [];
        s.roads = [];
        s.campaignRules = null;
        s.enemy.think = 1e9;
        s.mode = "quickmatch";
        s.cheats = { reveal: true };
        s.paused = true;
        s.time = 100;
      });
      let rasterMs = 0;
      const original = CruciataModelRaster.paint;
      CruciataModelRaster.paint = (...args) => {
        const start = performance.now();
        const result = original(...args);
        rasterMs += performance.now() - start;
        return result;
      };
      async function sample(mode) {
        cruciata.camera(
          mode === "off-camera" ? 7000 : 1500,
          mode === "off-camera" ? 7000 : 2600,
        );
        for (const u of state.units) {
          u.moving = mode === "animated" && u.type !== "standard";
          u.strike =
            mode === "animated" &&
            ["ram", "ballista", "trebuchet"].includes(u.type)
              ? 0.3
              : 0;
        }
        for (const b of state.buildings)
          b.lastShot = mode === "animated" ? state.time : -100;
        const frames = [];
        let previous = 0,
          before,
          modelBefore,
          timeBefore;
        for (let i = 0; i < 150; i++)
          await new Promise((resolve) =>
            requestAnimationFrame((now) => {
              if (i === 15) {
                before = {
                  models: CruciataModelRaster.stats().renders,
                  world: CruciataArt.spriteStats(),
                  siege: CruciataSiegeArt.cacheStats(),
                  atlas: CruciataAtlas.stats(),
                };
                timeBefore = rasterMs;
                modelBefore = performance.now();
              }
              if (i > 15) frames.push(now - previous);
              previous = now;
              state.time += 1 / 60;
              for (const u of state.units) if (u.moving) u.anim += 1 / 6;
              resolve();
            }),
          );
        const after = {
          models: CruciataModelRaster.stats().renders,
          world: CruciataArt.spriteStats(),
          siege: CruciataSiegeArt.cacheStats(),
          atlas: CruciataAtlas.stats(),
        };
        frames.sort((a, b) => a - b);
        return {
          mode,
          frames: frames.length,
          medianMs: frames[Math.floor(frames.length * 0.5)],
          p95Ms: frames[Math.floor(frames.length * 0.95)],
          geometryRenders: after.models - before.models,
          geometryCpuMs: rasterMs - timeBefore,
          worldCacheHits: after.world.hits - before.world.hits,
          siegeCacheHits: after.siege.hits - before.siege.hits,
          atlasHits: after.atlas.hits - before.atlas.hits,
          atlasMisses: after.atlas.misses - before.atlas.misses,
          atlasPendingFrames:
            after.atlas.pendingFrames - before.atlas.pendingFrames,
          elapsedMs: performance.now() - modelBefore,
        };
      }
      const idle = await sample("idle"),
        animated = await sample("animated"),
        offCamera = await sample("off-camera");
      return {
        raster: CruciataModelRaster.stats(),
        units: state.units.length,
        engines: state.buildings.length,
        idle,
        animated,
        offCamera,
        worldCache: CruciataArt.spriteStats(),
        siegeCache: CruciataSiegeArt.cacheStats(),
        atlas: CruciataAtlas.stats(),
      };
    });
    const target = path.join(__dirname, "../artifacts/render-profile.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
