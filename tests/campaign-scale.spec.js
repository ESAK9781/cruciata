const { test, expect } = require("./helpers");
async function start(page, level = 0, difficulty = "normal") {
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  await page.evaluate(
    ({ level, difficulty }) => {
      document.getElementById("front-menu").hidden = true;
      document.getElementById("campaign-difficulty").value = difficulty;
      cruciata.start(level);
    },
    { level, difficulty },
  );
}
test("escort crosses most of the map through guarded territory and launches real opposition", async ({
  page,
}) => {
  await start(page, 1);
  const initial = await page.evaluate(() => cruciata.snapshot());
  const caravan = initial.units.find((u) => u.type === "pilgrim");
  const length = caravan.route.reduce(
    (n, p, i) =>
      n +
      (i
        ? Math.hypot(p.x - caravan.route[i - 1].x, p.y - caravan.route[i - 1].y)
        : 0),
    0,
  );
  expect(length).toBeGreaterThan(initial.world.width * 0.8);
  const reachable = await page.evaluate(() => {
    const wagon = cruciata.snapshot().units.find((u) => u.type === "pilgrim");
    return wagon.route
      .slice(1)
      .map((p, i) => cruciata.route(wagon.route[i], p).length);
  });
  expect(
    reachable.every((n) => n > 0),
    JSON.stringify(reachable),
  ).toBe(true);
  expect(initial.campaignRules.posts).toHaveLength(4);
  for (const post of initial.campaignRules.posts)
    expect(
      initial.units.filter(
        (u) =>
          u.campaignPost === post.id &&
          Math.hypot(u.x - post.x, u.y - post.y) < 650,
      ).length,
    ).toBeGreaterThanOrEqual(6);
  const after = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.enemy.think = 1e9;
      s.waveTimer = 0;
    });
    cruciata.step(0.1);
    return cruciata.snapshot();
  });
  expect(after.campaignRules.attacks).toBeGreaterThan(0);
  expect(after.formations.filter((f) => f.sharedRoute).length).toBeGreaterThan(
    0,
  );
});
test("difficulties change campaign duration and the size of regional opposition", async ({
  page,
}) => {
  const results = [];
  for (const difficulty of ["easy", "normal", "hard"]) {
    await start(page, 2, difficulty);
    results.push(await page.evaluate(() => cruciata.snapshot()));
  }
  expect(results[0].campaignRules.survival).toBeGreaterThan(360);
  expect(results[2].campaignRules.survival).toBeGreaterThan(
    results[1].campaignRules.survival,
  );
  expect(results[2].units.filter((u) => u.campaignPost).length).toBeGreaterThan(
    results[0].units.filter((u) => u.campaignPost).length,
  );
  expect(results[2].campaignRules.interval).toBeLessThan(
    results[0].campaignRules.interval,
  );
});
test("large layered cities capture on capital contact and grant their treasury once", async ({
  page,
}) => {
  await start(page);
  const before = await page.evaluate(() => cruciata.snapshot());
  const city = before.cities[0],
    capital = before.buildings.find((b) => b.id === city.center);
  expect(capital.w).toBeGreaterThan(250);
  expect(
    before.units.filter((u) => u.city === city.id && u.cityDefender).length,
  ).toBeGreaterThanOrEqual(70);
  expect(
    new Set(
      before.buildings
        .filter((b) => b.city === city.id && b.kind === "wall")
        .map((b) => b.defenceLayer),
    ).size,
  ).toBe(2);
  const result = await page.evaluate((cityId) => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.enemy.think = 1e9;
      s.campaignRules = null;
      const city = s.cities.find((c) => c.id === cityId),
        b = s.buildings.find((b) => b.id === city.center),
        soldier = s.units.find((u) => u.team === 0 && u.type === "sword");
      Object.assign(soldier, {
        x: b.x + b.w / 2 + 20,
        y: b.y,
        stance: "stand-down",
        order: null,
        target: null,
      });
    });
    const resources = cruciata.snapshot().resources;
    cruciata.step(0.1);
    const captured = cruciata.snapshot();
    cruciata.step(0.1);
    return { resources, captured, again: cruciata.snapshot() };
  }, city.id);
  expect(result.captured.cities.find((c) => c.id === city.id).captured).toBe(
    true,
  );
  expect(result.captured.resources.gold - result.resources.gold).toBe(2200);
  expect(result.again.resources.gold).toBe(result.captured.resources.gold);
  expect(
    result.captured.buildings
      .filter((b) => b.city === city.id && b.hp > 0)
      .every((b) => b.team === 0),
  ).toBe(true);
});
test("great engines send massive long-range shells with impact damage and camera shake", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.units = [];
      s.campaignRules = null;
      s.enemy.think = 1e9;
      const template = s.buildings[0];
      s.buildings.push({
        ...template,
        id: 99901,
        kind: "greatengine",
        team: 0,
        x: 2000,
        y: 2600,
        w: 232,
        h: 200,
        hp: 6000,
        maxHp: 6000,
        queue: [],
        guardCooldown: 0,
        attackTarget: 99902,
        aimAngle: 0,
      });
      s.buildings.push({
        ...template,
        id: 99902,
        kind: "wall",
        team: 1,
        x: 4000,
        y: 2600,
        w: 32,
        h: 32,
        wallAngle: 0,
        fortified: true,
        hp: 11000,
        maxHp: 11000,
        queue: [],
      });
    });
    cruciata.camera(4000, 2600);
    cruciata.step(0.1);
    const fired = cruciata.snapshot();
    cruciata.step(fired.boulders[0].duration);
    return { fired, impact: cruciata.snapshot() };
  });
  expect(result.fired.boulders[0].heavy).toBe(true);
  expect(result.fired.boulders[0].r).toBeGreaterThan(200);
  expect(result.impact.buildings.find((b) => b.id === 99902).hp).toBeLessThan(
    9500,
  );
  expect(result.impact.screenShake).toBeGreaterThan(0);
  expect(result.impact.rings.some((r) => r.r > 400)).toBe(true);
});
test("new canvas machines, caravan motion and wind animate with detailed materials", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    const paint = (kind, time) => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 400;
      const g = c.getContext("2d");
      if (kind === "engine")
        CruciataArt.structure(
          g,
          {
            kind: "greatengine",
            x: 200,
            y: 200,
            team: 0,
            hp: 6000,
            progress: 1,
            lastShot: 0,
          },
          time,
        );
      else {
        g.translate(200, 200);
        if (kind === "wagon")
          CruciataArt.caravan(
            g,
            { type: "pilgrim", moving: true, id: 1 },
            time,
            0,
          );
        else CruciataArt.banner(g, 0, 0, 0, time, 2.8);
      }
      return c.toDataURL();
    };
    return {
      engine: paint("engine", 0) !== paint("engine", 0.3),
      wagon: paint("wagon", 0) !== paint("wagon", 0.2),
      flag: paint("flag", 0) !== paint("flag", 2),
    };
  });
  expect(result).toEqual({ engine: true, wagon: true, flag: true });
});

test("winter begins inside a large castle with six surrounding siege camps", async ({
  page,
}) => {
  await start(page, 2);
  const before = await page.evaluate(() => cruciata.snapshot());
  const castle = before.buildings.find((b) => b.id === before.capitals.player);
  expect(castle.castle).toBe(true);
  expect(castle.w).toBeGreaterThan(200);
  expect(
    before.buildings.filter((b) => b.team === 0 && b.kind === "wall").length,
  ).toBeGreaterThan(140);
  expect(before.campaignRules.posts).toHaveLength(6);
  expect(before.campaignRules.posts.some((p) => p.x < castle.x)).toBe(true);
  expect(before.campaignRules.posts.some((p) => p.x > castle.x)).toBe(true);
  expect(before.campaignRules.posts.some((p) => p.y < castle.y)).toBe(true);
  expect(before.campaignRules.posts.some((p) => p.y > castle.y)).toBe(true);
  const after = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.enemy.think = 1e9;
      s.waveTimer = 0;
    });
    cruciata.step(0.1);
    return cruciata.snapshot();
  });
  expect(after.campaignRules.attacks).toBe(6);
  expect(
    after.formations.filter((f) => f.sharedRoute).length,
  ).toBeGreaterThanOrEqual(6);
});
test("Jerusalem occupies the back of the map with three rings and deployed engines", async ({
  page,
}) => {
  await start(page, 5);
  const s = await page.evaluate(() => cruciata.snapshot());
  const walls = s.buildings.filter((b) => b.team === 1 && b.kind === "wall");
  expect(new Set(walls.map((b) => b.defenceLayer)).size).toBe(3);
  expect(
    Math.max(...walls.map((b) => b.y)) - Math.min(...walls.map((b) => b.y)),
  ).toBeGreaterThan(s.world.height * 0.65);
  expect(
    Math.max(...walls.map((b) => b.x)) - Math.min(...walls.map((b) => b.x)),
  ).toBeGreaterThan(s.world.width * 0.2);
  expect(
    s.units.filter(
      (u) => u.team === 1 && u.fixedDefense && u.deployment === "deployed",
    ),
  ).toHaveLength(12);
  expect(
    s.units.filter((u) => u.team === 1 && u.type === "worker"),
  ).toHaveLength(6);
  expect(s.campaignRules.posts).toHaveLength(6);
});
test("regional armies patrol unknown territory and invade only discovered player settlements", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const soldier = s.units.find((u) => u.team === 1 && u.type === "sword"),
        template = s.buildings[0];
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.campaignRules = null;
      s.enemy.think = 1e9;
      s.regionalThink = 0;
      s.time = 120;
      s.buildings.push({
        ...template,
        id: 99001,
        team: 1,
        x: 2200,
        y: 2600,
        queue: [],
      });
      s.units = Array.from({ length: 24 }, (_, i) => ({
        ...soldier,
        id: 99100 + i,
        x: 2150 + (i % 6) * 35,
        y: 2750 + Math.floor(i / 6) * 35,
        order: null,
        pendingOrder: null,
        path: [],
        target: null,
        campaignPost: null,
        garrisonBase: null,
        regionalMission: null,
        hp: 130,
        maxHp: 130,
      }));
      s.regions = {
        99001: {
          patrolAt: 0,
          invasionAt: 0,
          phase: 0,
          patrols: 0,
          invasions: 0,
        },
      };
    });
    cruciata.step(0.1);
    const unknown = cruciata.snapshot();
    cruciata.scenario((s) => {
      s.regionalThink = 0;
      s.regions[99001].invasionAt = 0;
      s.regions[99001].patrolAt = 1e9;
      s.buildings.push({
        ...s.buildings[0],
        id: 99002,
        kind: "house",
        team: 0,
        x: 2600,
        y: 2600,
        w: 50,
        h: 50,
        queue: [],
      });
      for (const u of s.units) {
        u.order = null;
        u.pendingOrder = null;
        u.regionalMission = null;
        u.target = null;
      }
    });
    cruciata.step(0.1);
    return { unknown, known: cruciata.snapshot() };
  });
  expect(result.unknown.regions[99001].patrols).toBe(1);
  expect(result.unknown.regions[99001].invasions).toBe(0);
  expect(result.known.regions[99001].invasions).toBe(1);
});

test("thick bastion gate openings remain connected to physical navigation", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    let gate;
    cruciata.scenario((s) => {
      s.units = [];
      s.nodes = [];
      s.decorations = [];
      s.campaignRules = null;
      s.cities = [];
      for (const b of s.buildings.filter(
        (b) => b.kind === "gate" && b.team === 1,
      ))
        b.closed = true;
      gate = s.buildings.find(
        (b) => b.team === 1 && b.gateSegments && b.defenceLayer === 0,
      );
    });
    const a = {
        x: gate.x - Math.sin(gate.gateAngle) * 85,
        y: gate.y + Math.cos(gate.gateAngle) * 85,
      },
      b = {
        x: gate.x + Math.sin(gate.gateAngle) * 85,
        y: gate.y - Math.cos(gate.gateAngle) * 85,
      };
    const blocked = cruciata.route(a, b);
    cruciata.scenario((s) => {
      s.buildings.find((b) => b.id === gate.id).closed = false;
    });
    return { blocked, open: cruciata.route(a, b) };
  });
  expect(result.blocked).toHaveLength(0);
  expect(result.open.length).toBeGreaterThan(0);
});

test("city archers hold behind the curtain and shoot approaching troops over it", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    const initial = cruciata.snapshot(),
      city = initial.cities[0],
      archers = initial.units.filter(
        (u) => u.city === city.id && u.type === "archer" && u.curtainGuard,
      ),
      archer = archers[0];
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.campaignRules = null;
      s.enemy.think = 1e9;
      s.regionalThink = 1e9;
      const template = s.units.find((u) => u.team === 0 && u.type === "sword"),
        a = Math.atan2(archer.y - city.y, archer.x - city.x);
      s.units = [
        { ...archer, cooldown: 0, order: null, target: null },
        {
          ...template,
          id: 99701,
          x: archer.x + Math.cos(a) * 160,
          y: archer.y + Math.sin(a) * 160,
          hp: 10000,
          maxHp: 10000,
          stance: "stand-down",
          order: null,
          target: null,
        },
      ];
    });
    cruciata.step(0.1);
    return { archers, after: cruciata.snapshot() };
  });
  expect(result.archers.length).toBeGreaterThan(15);
  expect(result.archers.every((u) => u.hold && u.stance === "hold")).toBe(true);
  expect(
    result.after.arrows.some((a) => a.team === 3 && a.target === 99701),
  ).toBe(true);
});
