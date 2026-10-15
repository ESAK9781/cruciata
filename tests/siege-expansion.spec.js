const { test, expect } = require("./helpers");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
    });
  });
}
test("explicit attacks keep a moving target despite closer enemies and lost vision", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const soldier = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = [
        { ...soldier, id: 99001, x: 1300, y: 2600, order: null, target: null },
        {
          ...soldier,
          id: 99002,
          team: 1,
          x: 1550,
          y: 2600,
          hp: 10000,
          maxHp: 10000,
        },
        {
          ...soldier,
          id: 99003,
          team: 1,
          x: 1330,
          y: 2640,
          hp: 10000,
          maxHp: 10000,
        },
      ];
    });
    cruciata.order([99001], { x: 1550, y: 2600 });
    cruciata.scenario((s) => {
      s.units.find((u) => u.id === 99002).x = 2200;
      s.cheats = {};
    });
    cruciata.step(4);
    const locked = cruciata.snapshot().units.find((u) => u.id === 99001);
    cruciata.order([99001], { x: 1200, y: 2800 });
    return {
      locked,
      changed: cruciata.snapshot().units.find((u) => u.id === 99001),
    };
  });
  expect(result.locked.target).toBe(99002);
  expect(result.locked.manualTarget).toBe(true);
  expect(result.changed.manualTarget).toBe(false);
});
test("single unit movement has no rear or cavalry slot offset", async ({
  page,
}) => {
  await begin(page);
  const results = await page.evaluate(() => {
    const results = [];
    for (const type of [
      "sword",
      "archer",
      "knight",
      "chaplain",
      "trebuchet",
      "ram",
      "ballista",
    ]) {
      cruciata.scenario((s) => {
        const template = s.units.find((u) => u.team === 0) || s.units[0];
        s.units = [
          {
            ...template,
            id: 99001,
            type,
            team: 0,
            x: 1200,
            y: 2600,
            stance: "stand-down",
            deployment: "packed",
            job: null,
            order: null,
            target: null,
            path: [],
          },
        ];
      });
      cruciata.order([99001], { x: 1450, y: 2600 });
      cruciata.step(15);
      const u = cruciata.snapshot().units[0];
      results.push({
        type,
        d: Math.hypot(u.x - 1450, u.y - 2600),
        order: u.order,
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result.d, result.type).toBeLessThan(8);
    expect(result.order, result.type).toBeNull();
  }
});
test("campaign capital has bastions and segmented gates without extra citizens", async ({
  page,
}) => {
  await page.goto("/?test");
  const s = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    return cruciata.snapshot();
  });
  expect(
    s.units.filter((u) => u.team === 1 && u.type === "worker"),
  ).toHaveLength(6);
  expect(
    s.buildings.filter((b) => b.team === 1 && b.fortified).length,
  ).toBeGreaterThan(180);
  expect(
    s.buildings
      .filter((b) => b.team === 1 && b.kind === "gate")
      .every((b) => b.gateSegments?.length === 2),
  ).toBe(true);
});

test("villagers construct a permanent engine that bombards fortified walls", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.supply({ wood: 5000, stone: 5000, gold: 5000 });
    cruciata.scenario((s) => {
      s.techs = { engineworks: true };
      const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [
        { ...worker, x: 1250, y: 2600, job: null, order: null },
        { ...worker, id: 99008, x: 2050, y: 2600, job: null, order: null },
      ];
      const template = s.buildings[0];
      s.buildings.push({
        ...template,
        id: 99009,
        kind: "wall",
        team: 1,
        x: 2150,
        y: 2600,
        w: 32,
        h: 32,
        wallAngle: 0,
        hp: 11000,
        maxHp: 11000,
        fortified: true,
        queue: [],
      });
    });
    cruciata.camera(1600, 2600);
  });
  const worker = await page.evaluate(() => cruciata.project(1250, 2600));
  await page.mouse.click(worker.x, worker.y);
  await page.locator("#build-greatengine").click();
  const p = await page.evaluate(() => cruciata.project(1500, 2600));
  await page.mouse.click(p.x, p.y);
  const result = await page.evaluate(() => {
    cruciata.step(210);
    return cruciata.snapshot();
  });
  const engine = result.buildings.find(
    (b) => b.kind === "greatengine" && b.team === 0,
  );
  expect(engine).toBeDefined();
  expect(engine.progress, JSON.stringify(result.units)).toBe(1);
  expect(result.buildings.find((b) => b.id === 99009).hp).toBeLessThan(11000);
});

test("enemy spends resources on an explored expansion and fortifies multiple bases", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const base = s.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      );
      const worker = s.units.find((u) => u.team === 1 && u.type === "worker");
      s.units = Array.from({ length: 8 }, (_, i) => ({
        ...worker,
        id: 99100 + i,
        x: i === 0 ? base.x - 1900 : base.x + 180 + (i % 3) * 25,
        y: base.y + 120,
        job: null,
        order: null,
        buildQueue: [],
        fleeUntil: 0,
      }));
      s.nodes = [
        {
          id: 99200,
          kind: "gold",
          x: base.x - 1900,
          y: base.y + 100,
          r: 23,
          remaining: 10000,
          max: 10000,
        },
      ];
      s.time = 200;
      s.enemy.think = 0;
      s.enemy.resources = {
        food: 10000,
        wood: 10000,
        gold: 10000,
        stone: 10000,
      };
    });
    cruciata.step(0.1);
    return cruciata.snapshot();
  });
  const expansion = result.buildings.find(
    (b) => b.team === 1 && b.kind === "towncenter" && b.progress < 1,
  );
  expect(expansion).toBeDefined();
  expect(
    result.units.some(
      (u) => u.job?.kind === "build" && u.job.target === expansion.id,
    ),
  ).toBe(true);
  expect(result.enemy.resources.wood).toBeLessThan(10000);
});

test("rams and ballistas inflict siege damage rather than ordinary masonry damage", async ({
  page,
}) => {
  await begin(page);
  const results = await page.evaluate(() => {
    const results = [];
    for (const type of ["ram", "ballista"]) {
      cruciata.scenario((s) => {
        const template = s.units.find((u) => u.team === 0);
        s.units = [
          {
            ...template,
            id: 99001,
            type,
            x: 1300,
            y: 2600,
            hp: 2000,
            maxHp: 2000,
            job: null,
            order: null,
            target: null,
            stance: "fight",
            cooldown: 0,
            path: [],
          },
        ];
        s.buildings = s.buildings.filter((b) => b.id !== 99009);
        s.buildings.push({
          ...s.buildings[0],
          id: 99009,
          kind: "wall",
          team: 1,
          x: 1600,
          y: 2600,
          w: 32,
          h: 32,
          wallAngle: 0,
          hp: 11000,
          maxHp: 11000,
          fortified: true,
          queue: [],
        });
      });
      cruciata.order([99001], { x: 1600, y: 2600 });
      cruciata.step(30);
      results.push({
        type,
        hp: cruciata.snapshot().buildings.find((b) => b.id === 99009).hp,
      });
    }
    return results;
  });
  for (const result of results)
    expect(result.hp, result.type).toBeLessThan(10500);
});

test("enemy launches successive invasion armies with shared routes", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const base = s.buildings.find(
        (b) => b.team === 1 && b.kind === "towncenter",
      );
      const capital = s.buildings.find((b) => b.id === s.capitals.player);
      const sword = s.units.find((u) => u.team === 1 && u.type === "sword");
      const worker = s.units.find((u) => u.team === 1 && u.type === "worker");
      s.units = Array.from({ length: 30 }, (_, i) => ({
        ...sword,
        id: 99300 + i,
        x: base.x - 180 + (i % 6) * 30,
        y: base.y + 180 + Math.floor(i / 6) * 30,
        order: null,
        target: null,
        squad: null,
        scout: false,
        garrisonBase: null,
        path: [],
      }));
      s.units.push({
        ...worker,
        id: 99400,
        x: capital.x + 180,
        y: capital.y,
        job: null,
        order: null,
      });
      s.squads = [];
      s.formations = [];
      s.time = 500;
      s.enemy.think = 0;
      s.enemy.attack = 0;
    });
    cruciata.step(0.1);
    const first = cruciata.snapshot();
    cruciata.scenario((s) => {
      const base = s.buildings.find(
        (b) => b.team === 1 && b.kind === "towncenter",
      );
      const sword = s.units.find((u) => u.type === "sword");
      for (let i = 0; i < 30; i++)
        s.units.push({
          ...sword,
          id: 99500 + i,
          x: base.x - 180 + (i % 6) * 30,
          y: base.y + 350 + Math.floor(i / 6) * 30,
          order: null,
          target: null,
          path: [],
          garrisonBase: null,
        });
      s.time += 66;
      s.enemy.think = 0;
    });
    cruciata.step(0.1);
    return { first, second: cruciata.snapshot() };
  });
  expect(result.first.formations).toHaveLength(1);
  expect(result.first.formations[0].members).toHaveLength(24);
  expect(result.first.formations[0].sharedRoute).toBe(true);
  expect(result.second.formations).toHaveLength(2);
  expect(result.second.formations.every((f) => f.sharedRoute)).toBe(true);
});

test("generated segmented gates block their full passage only while closed", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let gateId;
    cruciata.scenario((s) => {
      s.units = [];
      const gate = s.buildings.find((b) => b.team === 1 && b.gateSegments);
      gateId = gate.id;
      gate.closed = true;
    });
    const closed = cruciata.snapshot().buildings.find((b) => b.id === gateId);
    const blocked = cruciata.free(closed);
    cruciata.scenario((s) => {
      s.buildings.find((b) => b.id === gateId).closed = false;
    });
    return { blocked, open: cruciata.free(closed) };
  });
  expect(result.blocked).toBe(false);
  expect(result.open).toBe(true);
});

test("bastion construction pays its cost and gate upgrades retain reinforced health", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.supply({ stone: 5000, wood: 5000 });
    cruciata.scenario((s) => {
      const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [{ ...worker, x: 1250, y: 2600, job: null, order: null }];
    });
    cruciata.camera(1600, 2600);
  });
  const worker = await page.evaluate(() => cruciata.project(1250, 2600));
  await page.mouse.click(worker.x, worker.y);
  const before = await page.evaluate(() => cruciata.snapshot().resources);
  await page.locator("#build-bastionwall").click();
  const points = await page.evaluate(() => [
    cruciata.project(1440, 2592),
    cruciata.project(1504, 2592),
  ]);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 5 });
  await page.mouse.up();
  const planned = await page.evaluate(() => cruciata.snapshot());
  const walls = planned.buildings.filter(
    (b) => b.team === 0 && b.fortified && b.kind === "wall",
  );
  expect(walls).toHaveLength(3);
  expect(before.stone - planned.resources.stone).toBe(3 * 48);
  expect(before.wood - planned.resources.wood).toBe(3 * 12);
  await page.evaluate(() => cruciata.step(65));
  const complete = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter(
        (b) => b.team === 0 && b.fortified && b.kind === "wall",
      ),
  );
  expect(complete.every((b) => b.progress === 1 && b.maxHp === 11000)).toBe(
    true,
  );
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units = [];
    }),
  );
  const p = await page.evaluate((p) => cruciata.project(p.x, p.y), complete[1]);
  await page.mouse.click(p.x, p.y);
  await page.locator("#upgrade-gate-button").click();
  const item = await page.evaluate(
    () =>
      cruciata
        .snapshot()
        .buildings.find(
          (b) => b.team === 0 && b.queue[0]?.targetKind === "gate",
        ).queue[0],
  );
  expect(item.cost).toEqual({ stone: 164, wood: 96 });
  expect(item.duration).toBe(40);
  await page.evaluate(() => cruciata.step(40.1));
  const gate = await page.evaluate(() =>
    cruciata.snapshot().buildings.find((b) => b.team === 0 && b.gateSegments),
  );
  expect(gate.maxHp).toBe(18000);
  expect(gate.bastionGate).toBe(true);
});
