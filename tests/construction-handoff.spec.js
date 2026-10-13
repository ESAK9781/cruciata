const { test, expect } = require("./helpers");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}
test("builders continue nearby unfinished buildings after completing a non-depot", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      const template = s.buildings.find((b) => b.kind === "barracks");
      s.nodes = [];
      s.decorations = [];
      s.units = [u];
      s.enemy.think = 1e9;
      u.x = 1500;
      u.y = 2600;
      u.job = { kind: "build", target: 95001 };
      u.buildQueue = [];
      s.buildings.push(
        {
          ...template,
          id: 95001,
          team: 0,
          x: 1544,
          y: 2600,
          w: 80,
          h: 70,
          progress: 0.99,
          hp: 700,
        },
        {
          ...template,
          id: 95002,
          team: 0,
          x: 1740,
          y: 2600,
          w: 80,
          h: 70,
          progress: 0,
          hp: 200,
        },
      );
    });
    cruciata.step(1);
    return cruciata.snapshot();
  });
  expect(result.buildings.find((b) => b.id === 95001).progress).toBe(1);
  expect(result.units[0].job).toMatchObject({ kind: "build", target: 95002 });
});
test("explicit construction queues take priority over nearby automatic projects", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "worker"),
        t = s.buildings.find((b) => b.kind === "barracks");
      s.nodes = [];
      s.decorations = [];
      s.units = [u];
      s.enemy.think = 1e9;
      u.x = 1500;
      u.y = 2600;
      u.job = { kind: "build", target: 95001 };
      u.buildQueue = [95003];
      for (const [id, x, progress] of [
        [95001, 1544, 0.99],
        [95002, 1740, 0],
        [95003, 2100, 0],
      ])
        s.buildings.push({
          ...t,
          id,
          team: 0,
          x,
          y: 2600,
          w: 80,
          h: 70,
          progress,
          hp: 200,
        });
    });
    cruciata.step(1);
    return cruciata.snapshot().units[0];
  });
  expect(result.job.target).toBe(95003);
});
test("wall ends meet blocking terrain while other buildings retain footprint clearance", async ({
  page,
}) => {
  await begin(page);
  const r = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.units = [];
      s.enemy.think = 1e9;
      s.cheats = { reveal: true };
      s.decorations = [{ kind: "rock", x: 1950, y: 2600, r: 50, block: true }];
    });
    return {
      wall: cruciata.site("wall", { x: 1888, y: 2600 }),
      house: cruciata.site("house", { x: 1888, y: 2600 }),
      inside: cruciata.site("wall", { x: 1950, y: 2600 }),
    };
  });
  expect(r).toEqual({ wall: true, house: false, inside: false });
});
test("depot commands assign gathering and preserve the chosen delivery depot", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "worker"),
        t = s.buildings[0],
        node = s.nodes.find((n) => n.kind === "wood");
      s.units = [u];
      u.x = 1550;
      u.y = 2600;
      u.job = null;
      u.order = null;
      s.nodes = [{ ...node, id: 96001, x: 1600, y: 2850, remaining: 660 }];
      s.decorations = [];
      s.enemy.think = 1e9;
      s.buildings.push({
        ...t,
        id: 96002,
        kind: "lumbercamp",
        team: 0,
        x: 1600,
        y: 2600,
        w: 80,
        h: 70,
        progress: 1,
        hp: 900,
        maxHp: 900,
        queue: [],
      });
    }),
  );
  await page.keyboard.press("e");
  const p = await page.evaluate(() => {
    cruciata.camera(1600, 2600);
    return cruciata.project(1600, 2600);
  });
  await page.mouse.click(p.x, p.y, { button: "right" });
  let u = await page.evaluate(() => cruciata.snapshot().units[0]);
  expect(u.job).toMatchObject({
    kind: "gather",
    resource: "wood",
    target: 96001,
    depot: 96002,
  });
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units[0].carry = 16;
      s.units[0].carryType = "wood";
      s.units[0].job.phase = "deliver";
      s.units[0].x = 1530;
      s.units[0].y = 2600;
    }),
  );
  await page.evaluate(() => cruciata.step(1));
  u = await page.evaluate(() => cruciata.snapshot().units[0]);
  expect(u.carry).toBe(0);
  expect(u.job.depot).toBe(96002);
});
