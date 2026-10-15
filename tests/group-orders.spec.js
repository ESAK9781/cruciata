const { test, expect } = require("./helpers");

async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.supply({ stone: 1000, wood: 1000 });
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
    });
    cruciata.camera(1600, 2600);
  });
}
async function select(page, x, y, shift = false) {
  const p = await page.evaluate(({ x, y }) => cruciata.project(x, y), { x, y });
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up("Shift");
}

test("large separated companies share routes and start together", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = Array.from({ length: 80 }, (_, i) => ({
        ...template,
        id: 99000 + i,
        x: 1100 + (i % 8) * 26,
        y: 2400 + Math.floor((i % 40) / 8) * 26 + Math.floor(i / 40) * 600,
        order: null,
        target: null,
        stance: "stand-down",
        path: [],
      }));
      // A long obstacle forces center-to-center routes around its ends.
      s.buildings.push({
        ...s.buildings[0],
        id: 99990,
        kind: "house",
        team: 2,
        x: 2100,
        y: 2600,
        w: 100,
        h: 1000,
        progress: 1,
        hp: 10000,
        queue: [],
      });
    });
    const before = cruciata.snapshot();
    cruciata.order(
      before.units.map((u) => u.id),
      { x: 3500, y: 2600 },
    );
    let first = null;
    for (let i = 0; i < 80; i++) {
      cruciata.step(0.1);
      const s = cruciata.snapshot();
      if (!first && s.formations.every((f) => f.routeReady)) first = s;
    }
    const after = cruciata.snapshot();
    cruciata.step(120);
    return { before, first, after, arrived: cruciata.snapshot() };
  });
  expect(result.after.formations).toHaveLength(2);
  expect(result.first).not.toBeNull();
  expect(result.first.formations.every((f) => f.path.length > 1)).toBe(true);
  expect(
    result.after.navigation.searches - result.before.navigation.searches,
  ).toBeLessThan(12);
  expect(
    result.after.units.filter(
      (u) =>
        Math.hypot(
          u.x - result.before.units.find((v) => v.id === u.id).x,
          u.y - result.before.units.find((v) => v.id === u.id).y,
        ) > 20,
    ),
  ).toHaveLength(80);
  expect(result.arrived.units.filter((u) => u.order)).toHaveLength(0);
});

test("hotbar follows selected unit and building capabilities", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const soldier = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = [
        { ...soldier, x: 1400, y: 2600 },
        {
          ...soldier,
          id: 99910,
          type: "trebuchet",
          x: 1550,
          y: 2600,
          deployment: "packed",
        },
        { ...soldier, id: 99911, type: "worker", x: 1700, y: 2600 },
      ];
    }),
  );
  await select(page, 1400, 2600);
  await expect(page.locator("#stance-fight")).toBeVisible();
  await expect(page.locator("#deploy-button")).toBeHidden();
  await expect(page.locator("#destroy-button")).toBeHidden();
  await select(page, 1550, 2600);
  await expect(page.locator("#deploy-button")).toBeVisible();
  await select(page, 1700, 2600);
  await expect(page.locator("#stance-fight")).toBeHidden();
  await expect(page.locator("#bless-button")).toBeHidden();
  await expect(page.locator("#scout-button")).toBeHidden();
  await expect(page.locator("#deploy-button")).toBeHidden();
  await expect(
    page.locator("#unit-stance, #hold-button, #attack-button, #build-gate"),
  ).toHaveCount(0);
});

test("multi-building training and demolition perform one action per click", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.supply({ food: 10000, gold: 10000 });
    cruciata.scenario((s) => {
      s.units = [];
      const template = s.buildings[0];
      for (let i = 0; i < 2; i++)
        s.buildings.push({
          ...template,
          id: 99920 + i,
          kind: "barracks",
          x: 1400 + i * 170,
          y: 2600,
          w: 100,
          h: 100,
          progress: 1,
          hp: 1000,
          maxHp: 1000,
          queue: [],
          capital: false,
        });
    });
  });
  await select(page, 1400, 2600);
  await select(page, 1570, 2600, true);
  await expect(page.locator("#selection-title")).toHaveText(
    "2 selected structures",
  );
  await page.locator("#recruit-sword").click();
  let queues = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.id >= 99920)
      .map((b) => b.queue.length),
  );
  expect(queues).toEqual([1, 0]);
  await page.locator("#recruit-sword").click();
  queues = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.id >= 99920)
      .map((b) => b.queue.length),
  );
  expect(queues).toEqual([1, 1]);
  await page.locator("#cancel-button").click();
  queues = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.id >= 99920)
      .map((b) => b.queue.length),
  );
  expect(queues).toEqual([0, 1]);
  await page.locator("#destroy-button").click();
  expect(
    await page.evaluate(
      () =>
        cruciata.snapshot().buildings.filter((b) => b.id >= 99920 && b.hp > 0)
          .length,
    ),
  ).toBe(1);
});

test("mixed producers combine training and rotate past full queues", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.supply({ food: 10000, gold: 10000, wood: 10000 });
    cruciata.scenario((s) => {
      s.units = [];
      for (let i = 0; i < 4; i++)
        s.buildings.push({
          ...s.buildings[0],
          id: 99820 + i,
          kind: i === 3 ? "stable" : "barracks",
          x: 1300 + i * 140,
          y: 2600,
          w: 100,
          h: 100,
          progress: 1,
          hp: 1000,
          maxHp: 1000,
          capital: false,
          queue: [],
        });
    });
  });
  for (let i = 0; i < 4; i++) await select(page, 1300 + i * 140, 2600, i > 0);
  await expect(page.locator("#recruit-sword")).toBeVisible();
  await expect(page.locator("#recruit-knight")).toBeVisible();
  await page.locator("#recruit-sword").click();
  await page.locator("#recruit-sword").click();
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const b = s.buildings.find((b) => b.id === 99821);
      b.queue = Array.from({ length: 8 }, () => ({
        kind: "unit",
        type: "sword",
        time: 0,
        duration: 1000,
        cost: { food: 1 },
      }));
    }),
  );
  await page.locator("#recruit-sword").click();
  expect(
    await page.evaluate(() =>
      cruciata
        .snapshot()
        .buildings.filter((b) => b.id >= 99820 && b.id <= 99823)
        .map((b) => b.queue.length),
    ),
  ).toEqual([1, 8, 1, 0]);
  await page.locator("#recruit-knight").click();
  expect(
    await page.evaluate(
      () =>
        cruciata.snapshot().buildings.find((b) => b.id === 99823).queue[0].type,
    ),
  ).toBe("knight");
});

test("corners, foundations, and hostile structures cannot convert or expose training", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units = [];
      for (const [i, x, y] of [
        [0, 1400, 2600],
        [1, 1432, 2600],
        [2, 1432, 2632],
      ])
        s.buildings.push({
          id: 99840 + i,
          kind: "wall",
          team: 0,
          x,
          y,
          w: 32,
          h: 32,
          r: 23,
          progress: 1,
          hp: 3200,
          maxHp: 3200,
          wallAngle: 0,
          queue: [],
        });
      s.buildings.push({
        ...s.buildings[0],
        id: 99850,
        kind: "barracks",
        team: 0,
        x: 1600,
        y: 2600,
        w: 100,
        h: 100,
        progress: 0.5,
        hp: 1000,
        queue: [],
      });
      s.buildings.push({
        ...s.buildings[0],
        id: 99851,
        kind: "barracks",
        team: 1,
        x: 1760,
        y: 2600,
        w: 100,
        h: 100,
        progress: 1,
        hp: 1000,
        queue: [],
      });
    }),
  );
  await select(page, 1432, 2600);
  await expect(page.locator("#upgrade-gate-button")).toBeHidden();
  await select(page, 1400, 2600);
  await expect(page.locator("#upgrade-gate-button")).toBeHidden();
  await select(page, 1600, 2600);
  await expect(page.locator("#recruit-sword")).toBeHidden();
  await expect(page.locator("#research-tab")).toBeHidden();
  await select(page, 1760, 2600);
  await expect(page.locator("#recruit-sword")).toBeHidden();
  await expect(page.locator("#destroy-button")).toBeHidden();
});

test("gate upgrades reserve both walls, cancel from either section, and resume saved progress", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units = [];
      for (let i = 0; i < 4; i++)
        s.buildings.push({
          id: 99700 + i,
          kind: "wall",
          team: 0,
          x: 1400 + i * 32,
          y: 2600,
          w: 32,
          h: 32,
          r: 23,
          wallAngle: 0,
          progress: 1,
          hp: 3200,
          maxHp: 3200,
          queue: [],
          spent: { stone: 12, wood: 3 },
        });
    }),
  );
  await select(page, 1432, 2600);
  const before = await page.evaluate(() => cruciata.snapshot().resources);
  await page.locator("#upgrade-gate-button").click();
  let state = await page.evaluate(() => {
    cruciata.step(5);
    return cruciata.snapshot();
  });
  const owner = state.buildings.find(
    (b) => b.queue[0]?.kind === "building-upgrade",
  );
  expect(owner.kind).toBe("wall");
  expect(owner.queue[0]).toMatchObject({
    targetKind: "gate",
    duration: 25,
    cost: { stone: 86, wood: 49 },
  });
  expect(owner.queue[0].time).toBeGreaterThan(4);
  const partner = state.buildings.find(
    (b) => b.id === owner.queue[0].partnerId,
  );
  expect(partner.upgradeOwner).toBe(owner.id);
  await select(page, partner.x, partner.y);
  await expect(page.locator("#queue-detail")).toContainText(
    "Gatehouse upgrade",
  );
  await expect(page.locator("#upgrade-tower-button")).toBeHidden();
  await page.locator("#cancel-button").click();
  state = await page.evaluate(() => cruciata.snapshot());
  expect(state.resources.stone).toBe(before.stone);
  expect(state.resources.wood).toBe(before.wood);
  expect(
    state.buildings.find((b) => b.id === partner.id).upgradeOwner,
  ).toBeUndefined();
  await select(page, 1432, 2600);
  await page.locator("#upgrade-gate-button").click();
  await page.evaluate(() => {
    cruciata.step(7);
    cruciata.save();
  });
  await page.reload();
  expect(await page.evaluate(() => cruciata.resume())).toBe(true);
  state = await page.evaluate(() => cruciata.snapshot());
  expect(
    state.buildings.find((b) => b.queue[0]?.targetKind === "gate").queue[0]
      .time,
  ).toBeGreaterThan(6);
  await page.evaluate(() => {
    cruciata.scenario((s) => (s.paused = false));
    cruciata.step(18.1);
  });
  state = await page.evaluate(() => cruciata.snapshot());
  expect(
    state.buildings.filter((b) => b.team === 0 && b.gateSegments),
  ).toHaveLength(1);
  expect(state.units).toHaveLength(0);
});

test("guard tower wall upgrades take time, rotate, preserve joins, and fire", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const foe =
        s.units.find((u) => u.team === 1 && u.type === "sword") ||
        s.units.find((u) => u.type === "sword");
      s.units = [
        {
          ...foe,
          id: 99780,
          team: 1,
          x: 1700,
          y: 2600,
          hp: 10000,
          maxHp: 10000,
          stance: "stand-down",
          hold: false,
          target: null,
          order: null,
        },
      ];
      for (let i = 0; i < 4; i++)
        s.buildings.push({
          id: 99750 + i,
          kind: "wall",
          team: 0,
          x: 1400 + i * 32,
          y: 2600,
          w: 32,
          h: 32,
          r: 23,
          wallAngle: 0,
          progress: 1,
          hp: i === 1 ? 1600 : 3200,
          maxHp: 3200,
          queue: [],
          spent: { stone: 12, wood: 3 },
        });
    }),
  );
  await select(page, 1432, 2600);
  await select(page, 1464, 2600, true);
  await page.locator("#upgrade-tower-button").click();
  let state = await page.evaluate(() => cruciata.snapshot());
  expect(state.buildings.find((b) => b.id === 99751).queue[0]).toMatchObject({
    kind: "building-upgrade",
    targetKind: "tower",
    duration: 30,
  });
  expect(state.buildings.find((b) => b.id === 99752).queue).toHaveLength(0);
  await page.locator("#upgrade-tower-button").click();
  await page.evaluate(() => cruciata.step(29));
  state = await page.evaluate(() => cruciata.snapshot());
  expect(
    state.buildings
      .filter((b) => [99751, 99752].includes(b.id))
      .every((b) => b.kind === "wall"),
  ).toBe(true);
  await page.evaluate(() => cruciata.step(6));
  state = await page.evaluate(() => cruciata.snapshot());
  const towers = state.buildings.filter((b) => [99751, 99752].includes(b.id));
  expect(
    towers.every(
      (b) => b.kind === "tower" && b.wallAttachment && b.queue.length === 0,
    ),
  ).toBe(true);
  expect(towers[0].hp).toBe(1600);
  expect(towers[0].maxHp).toBe(3200);
  expect(state.buildings.find((b) => b.id === 99750).links.e).toBeDefined();
  expect(state.buildings.find((b) => b.id === 99753).links.w).toBeDefined();
  expect(state.units[0].hp).toBeLessThan(10000);
  await page.evaluate(() => cruciata.save());
  await page.reload();
  expect(await page.evaluate(() => cruciata.resume())).toBe(true);
  expect(
    await page.evaluate(
      () =>
        cruciata.snapshot().buildings.find((b) => b.id === 99751)
          .wallAttachment,
    ),
  ).toBeDefined();
});

for (const diagonal of [false, true])
  test(`${diagonal ? "diagonal" : "straight"} wall gates preserve connections, collision and saves`, async ({
    page,
  }) => {
    await begin(page);
    await page.evaluate(
      (diagonal) =>
        cruciata.scenario((s) => {
          s.units = [];
          for (let i = 0; i < 4; i++)
            s.buildings.push({
              id: 99930 + i,
              kind: "wall",
              team: 0,
              x: 1400 + i * 32,
              y: 2600 + (diagonal ? i * 32 : 0),
              w: 32,
              h: 32,
              r: 23,
              progress: 1,
              hp: 3200,
              maxHp: 3200,
              wallAngle: diagonal ? Math.PI / 4 : 0,
              queue: [],
              spent: { stone: 12, wood: 3 },
            });
        }),
      diagonal,
    );
    await select(page, 1432, 2600 + (diagonal ? 32 : 0));
    await expect(page.locator("#upgrade-gate-button")).toBeVisible();
    await page.locator("#upgrade-gate-button").click();
    await page.evaluate(() => cruciata.step(25.1));
    const gate = await page.evaluate(() =>
      cruciata.snapshot().buildings.find((b) => b.team === 0 && b.gateSegments),
    );
    expect(gate.gateSegments).toHaveLength(2);
    // Full former curtain centerline remains blocked when closed.
    const closed = await page.evaluate(
      (gate) => gate.gateSegments.map((p) => cruciata.free(p)),
      gate,
    );
    expect(closed).toEqual([false, false]);
    const remaining = await page.evaluate(() =>
      cruciata
        .snapshot()
        .buildings.filter((b) => b.id >= 99930 && b.kind === "wall"),
    );
    expect(remaining.every((b) => Object.keys(b.links).length > 0)).toBe(true);
    await page.locator("#gate-button").click();
    await page.evaluate(() => cruciata.step(0.1));
    expect(await page.evaluate((p) => cruciata.free(p), gate)).toBe(true);
    await page.evaluate(() => cruciata.save());
    await page.reload();
    expect(await page.evaluate(() => cruciata.resume())).toBe(true);
    expect(
      await page.evaluate(
        () =>
          cruciata
            .snapshot()
            .buildings.find((b) => b.team === 0 && b.gateSegments)?.closed,
      ),
    ).toBe(false);
  });
