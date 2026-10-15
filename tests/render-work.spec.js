const { test, expect } = require("./helpers");

test("cached stationary models and sleeping cloth avoid repeated geometry rendering", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const A = CruciataArt,
      c = document.createElement("canvas");
    c.width = c.height = 500;
    const g = c.getContext("2d");
    g.translate(250, 300);
    const b = {
      kind: "house",
      x: 0,
      y: 0,
      w: 64,
      h: 62,
      team: 0,
      hp: 1000,
      progress: 1,
    };
    const u = { type: "sword", x: 0, y: 0, team: 0, angle: 0, moving: false };
    const wagon = { ...u, type: "merchant" },
      siege = { ...u, type: "trebuchet", deployment: "deployed" };
    const engine = {
      kind: "greatengine",
      x: 0,
      y: 0,
      w: 162,
      h: 140,
      hp: 6000,
      progress: 1,
      team: 0,
      lastShot: -100,
    };
    const flag = { ...u, type: "standard" };
    for (let i = 0; i < 6000; i++) A.updateStandard(flag, 1 / 120);
    const draw = (time) => {
      A.structure(g, b, time);
      A.unit(g, u, time);
      A.caravan(g, wagon, time);
      A.siegeMachine(g, siege, time);
      A.structure(g, engine, time);
      A.armyStandard(g, flag);
    };
    for (let i = 0; i < 24; i++) draw(((i / 24) * Math.PI * 2) / 0.7 + 0.00001);
    draw(100);
    const before = A.spriteStats(),
      rasterBefore = CruciataModelRaster.stats();
    for (let i = 0; i < 90; i++) draw(100 + i / 60);
    const after = A.spriteStats(),
      rasterAfter = CruciataModelRaster.stats();
    const siegeBefore = CruciataSiegeArt.cacheStats();
    for (let i = 0; i < 100; i++)
      A.siegeMachine(g, { ...siege, id: 1000 + i }, 200);
    const siegeAfter = CruciataSiegeArt.cacheStats();
    return {
      sleeping: A.standardCloth(flag).sleeping,
      hits: after.hits - before.hits,
      flagHits: after.sleepingFlagHits - before.sleepingFlagHits,
      misses: after.misses - before.misses,
      renders: rasterAfter.renders - rasterBefore.renders,
      sharedSiegeHits: siegeAfter.hits - siegeBefore.hits,
      sharedSiegeMisses: siegeAfter.misses - siegeBefore.misses,
      siegePixels: siegeAfter.pixels,
    };
  });
  expect(result.sleeping).toBe(true);
  expect(result.hits).toBeGreaterThanOrEqual(270);
  expect(result.flagHits).toBe(90);
  expect(result.misses).toBe(0);
  expect(result.renders).toBe(0);
  expect(result.sharedSiegeHits).toBe(100);
  expect(result.sharedSiegeMisses).toBe(0);
  expect(result.siegePixels).toBeLessThanOrEqual(8000000);
});

test("off-camera cosmetic animation stops while soldiers keep moving and resumes finite cloth", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  const result = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    let tracked;
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "sword");
      tracked = {
        ...u,
        id: 99700,
        type: "standard",
        x: 1400,
        y: 2600,
        anim: 0,
        angle: 0,
        order: null,
        target: null,
        stance: "stand-down",
      };
      s.units = [tracked];
      s.buildings = s.buildings.filter((b) => b.kind === "towncenter");
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.enemy.think = 1e9;
      s.campaignRules = null;
      s.cheats = { reveal: true };
    });
    cruciata.camera(1400, 2600);
    CruciataArt.updateStandard(tracked, 1 / 30);
    const cloth = CruciataArt.standardCloth(tracked),
      before = { time: cloth.time, anim: tracked.anim, x: tracked.x };
    cruciata.camera(7000, 7000);
    cruciata.order([tracked.id], { x: 1800, y: 2600 });
    cruciata.step(2);
    const off = {
      time: cloth.time,
      anim: tracked.anim,
      x: tracked.x,
      suspended: cloth.suspended,
      particles: cruciata.snapshot().particles.length,
    };
    cruciata.camera(tracked.x, tracked.y);
    cruciata.step(0.1);
    return {
      before,
      off,
      after: {
        time: cloth.time,
        anim: tracked.anim,
        finite: cloth.points.every(
          (p) =>
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            Number.isFinite(p.z),
        ),
        maxLink: Math.max(
          ...cloth.links.map((l) =>
            Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y, l.a.z - l.b.z),
          ),
        ),
      },
    };
  });
  expect(result.off.x).toBeGreaterThan(result.before.x + 40);
  expect(result.off.anim).toBe(result.before.anim);
  expect(result.off.time).toBe(result.before.time);
  expect(result.off.suspended).toBe(true);
  expect(result.off.particles).toBe(0);
  expect(result.after.anim).toBeGreaterThan(result.off.anim);
  expect(result.after.time).toBeGreaterThan(result.off.time);
  expect(result.after.finite).toBe(true);
  expect(result.after.maxLink).toBeLessThan(30);
});

test("depth-tested roof tiles occlude the underlying masonry across both slopes", async ({
  page,
}) => {
  await page.goto("/?test");
  const colors = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 300;
    const g = c.getContext("2d");
    g.translate(150, 200);
    const m = CruciataArt.projectedModel(g, Math.PI / 6);
    m.box(0, 0, 0, 80, 100, 30, "#d9c59d");
    m.roof(0, 0, 30, 90, 110, 28);
    m.paint();
    return [-22.5, 22.5].flatMap((x) =>
      [-30, 0, 30].map((y) => {
        const p = m.project([x, y, 44]);
        return [
          ...g.getImageData(
            Math.round(p[0] + 150),
            Math.round(p[1] + 200),
            1,
            1,
          ).data,
        ];
      }),
    );
  });
  for (const color of colors) {
    expect(color[3]).toBe(255);
    expect(color[0]).toBeGreaterThan(color[1] * 1.4);
  }
});

test("repeating wheel and caravan poses share sprites across units and animation cycles", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d");
    g.translate(200, 250);
    const machine = {
      type: "ballista",
      team: 0,
      moving: true,
      strike: 0,
      angle: 0.5,
      deployment: "packed",
    };
    CruciataArt.siegeMachine(g, machine, 1, 0.5);
    const before = CruciataSiegeArt.cacheStats();
    CruciataArt.siegeMachine(g, { ...machine, id: 999 }, 1 + 8 / 24, 0.5);
    const after = CruciataSiegeArt.cacheStats();
    const wagon = {
      type: "merchant",
      team: 0,
      moving: true,
      anim: 10,
      angle: 0.5,
    };
    CruciataArt.caravan(g, wagon, 1, 0.5);
    const worldBefore = CruciataArt.spriteStats();
    CruciataArt.caravan(g, { ...wagon, anim: 10 + 10 * Math.PI }, 2, 0.5);
    const worldAfter = CruciataArt.spriteStats();
    return {
      siegeMisses: after.misses - before.misses,
      siegeHits: after.hits - before.hits,
      caravanMisses: worldAfter.misses - worldBefore.misses,
      caravanHits: worldAfter.hits - worldBefore.hits,
    };
  });
  expect(result).toEqual({
    siegeMisses: 0,
    siegeHits: 1,
    caravanMisses: 0,
    caravanHits: 1,
  });
});

test("depth-correct models still render when WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === "webgl" || kind === "webgl2") return null;
      return get.call(this, kind, ...args);
    };
  });
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 300;
    const g = c.getContext("2d");
    g.translate(150, 200);
    const m = CruciataArt.projectedModel(g, Math.PI / 6);
    m.box(0, 0, 0, 80, 100, 30, "#d9c59d");
    m.roof(0, 0, 30, 90, 110, 28);
    m.paint();
    const p = m.project([-22.5, 0, 44]);
    return {
      backend: CruciataModelRaster.stats().backend,
      color: [
        ...g.getImageData(Math.round(p[0] + 150), Math.round(p[1] + 200), 1, 1)
          .data,
      ],
    };
  });
  expect(result.backend).toBe("software");
  expect(result.color[3]).toBe(255);
  expect(result.color[0]).toBeGreaterThan(result.color[1] * 1.4);
});
