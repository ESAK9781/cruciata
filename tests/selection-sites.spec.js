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
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("trees are picked by their whole silhouette, not just the trunk", async ({
  page,
}) => {
  await begin(page);
  const hits = await page.evaluate(() => {
    const A = window.CruciataArt,
      tree = { kind: "wood", x: 100, y: 100, r: 24, remaining: 100 };
    return [
      A.hitResource(tree, { x: 100, y: 100 }),
      A.hitResource(tree, { x: 100, y: 20 }),
      A.hitResource(tree, { x: 125, y: 40 }),
      A.hitResource(tree, { x: 100, y: -20 }),
      A.hitResource(tree, { x: 190, y: 100 }),
      A.hitResource(tree, { x: 100, y: 200 }),
    ];
  });
  expect(hits).toEqual([true, true, true, false, false, false]);
});

test("a plain click selects the colossus even with a tree standing behind it", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 99500,
        kind: "colossus",
        team: 0,
        x: 1500,
        y: 2600,
        w: 320,
        h: 276,
        hp: 16000,
        maxHp: 16000,
        progress: 1,
        queue: [],
        rally: null,
      });
      s.nodes.push({
        id: 99700,
        kind: "wood",
        x: 1560,
        y: 2490,
        r: 24,
        remaining: 400,
        max: 400,
      });
    });
    cruciata.camera(1500, 2500);
  });
  for (const [dx, dy] of [
    [0, 0],
    [-120, -30],
    [165, 20],
    [60, -140],
  ]) {
    const p = await page.evaluate(
      ([x, y]) => cruciata.project(x, y),
      [1500 + dx, 2600 + dy],
    );
    const empty = await page.evaluate(() => cruciata.project(1000, 2400));
    await page.mouse.click(empty.x, empty.y);
    expect(
      await page.evaluate(() => cruciata.snapshot().selectedBuilding),
    ).toBeNull();
    await page.mouse.click(p.x, p.y);
    expect(
      await page.evaluate(() => cruciata.snapshot().selectedBuilding),
    ).toBe(99500);
  }
});

test("construction sites draw at every stage without errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const t = JSON.parse(JSON.stringify(s.buildings[0]));
      let id = 98000,
        i = 0;
      for (const kind of [
        "house",
        "barracks",
        "wall",
        "greatengine",
        "colossus",
      ])
        for (const progress of [0.02, 0.3, 0.6, 0.95])
          s.buildings.push({
            ...t,
            id: id++,
            kind,
            team: 0,
            x: 1000 + (i % 4) * 300,
            y: 2000 + Math.floor(i++ / 4) * 300,
            w: kind === "colossus" ? 320 : 90,
            h: kind === "colossus" ? 276 : 90,
            hp: 400,
            maxHp: 1000,
            progress,
            queue: [],
          });
    });
    cruciata.camera(1500, 2400);
  });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => cruciata.liveFrame(3));
    await page.waitForTimeout(200);
  }
  expect(errors).toEqual([]);
});
