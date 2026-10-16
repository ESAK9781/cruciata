const { test, expect } = require("./helpers");

async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.scenario((s) => {
      s.enemy.think = 1e9;
    });
  }, level);
}

test("destroying the enemy capital is not enough: soldiers must stand on its ruins", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const S = cruciata.internals().state;
    let ruin;
    cruciata.scenario((s) => {
      const capital = s.buildings.find((b) => b.id === s.capitals.enemy);
      ruin = { x: capital.x, y: capital.y };
      capital.hp = 0;
      // Nobody of ours is near the ruins yet; engines and villagers do not count.
      s.units = s.units.filter((u) => u.team === 0);
      for (const u of s.units) {
        u.x = 400;
        u.y = 400;
      }
      const engine = { ...s.units[0], id: 99800, type: "trebuchet" };
      engine.x = ruin.x;
      engine.y = ruin.y + 20;
      s.units.push(engine);
    });
    cruciata.step(1);
    const waiting = cruciata.snapshot().result;
    cruciata.scenario((s) => {
      const soldier = s.units.find((u) => u.team === 0 && u.type === "sword");
      soldier.x = ruin.x + 30;
      soldier.y = ruin.y + 30;
    });
    cruciata.step(1);
    return { waiting, after: cruciata.snapshot().result };
  });
  expect(result.waiting).toBeFalsy();
  expect(result.after).toBe("victory");
});

test("a crew of builders spreads around a building instead of queueing on one side", async ({
  page,
}) => {
  await begin(page);
  const sides = await page.evaluate(() => {
    let target;
    cruciata.scenario((s) => {
      s.nodes = [];
      const home = s.buildings.find((b) => b.team === 0);
      const template = JSON.parse(
        JSON.stringify(
          s.buildings.find((b) => b.kind === "barracks" && b.team === 0) ||
            home,
        ),
      );
      target = {
        ...template,
        id: 99900,
        kind: "barracks",
        team: 0,
        x: home.x + 500,
        y: home.y + 500,
        w: 96,
        h: 84,
        r: 48,
        progress: 0.02,
        hp: 20,
        queue: [],
      };
      s.buildings.push(target);
      const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
      const crew = Array.from({ length: 16 }, (_, i) => ({
        ...JSON.parse(JSON.stringify(worker)),
        id: 99910 + i,
        x: target.x - 300,
        y: target.y,
        job: { kind: "build", target: target.id },
        order: null,
        buildQueue: [],
      }));
      s.units = s.units.filter((u) => u.team !== 0).concat(crew);
    });
    for (let i = 0; i < 12; i++) cruciata.step(1);
    const S = cruciata.internals().state;
    const b = S.buildings.find((x) => x.id === 99900);
    const quadrants = new Set(
      S.units
        .filter((u) => u.id >= 99910 && u.id < 99930)
        .map((u) =>
          Math.floor(
            (Math.atan2(u.y - b.y, u.x - b.x) + Math.PI) / (Math.PI / 2),
          ),
        ),
    );
    return quadrants.size;
  });
  expect(sides).toBeGreaterThanOrEqual(3);
});

test("rim trees carry a reserve so the whole forest can be harvested", async ({
  page,
}) => {
  await page.goto("/?test");
  const stats = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    const S = cruciata.internals().state;
    const rim = S.nodes.filter((n) => n.kind === "wood" && n.reserve > 0);
    return { rim: rim.length };
  });
  expect(stats.rim).toBeGreaterThan(0);
});
