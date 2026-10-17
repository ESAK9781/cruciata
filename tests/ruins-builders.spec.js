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

test("cutting a forest's edge trees removes their tile and exposes the ones behind", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const S = cruciata.internals().state;
    const rim = S.nodes.find((n) => n.kind === "wood" && n.grove !== undefined);
    const mass = S.terrainFeatures[rim.grove];
    const before = mass.tiles.length;
    const [tx, ty] = rim.tile;
    cruciata.scenario((s) => {
      const siblings = s.nodes.filter(
        (n) => n.grove === rim.grove && n.tile[0] === tx && n.tile[1] === ty,
      );
      for (const n of siblings) n.remaining = 1;
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [u];
      for (const n of siblings) {
        Object.assign(u, {
          x: n.x,
          y: n.y + 30,
          order: null,
          job: {
            kind: "gather",
            resource: "wood",
            target: n.id,
            phase: "approach",
          },
        });
        cruciata.step(3);
      }
    });
    const gone = !mass.tiles.some((t) => t.x === tx && t.y === ty);
    return { before, after: mass.tiles.length, gone };
  });
  expect(result.gone).toBe(true);
  expect(result.after).toBe(result.before - 1);
});

test("a falling building shatters into shards that land and fade, leaving the rubble", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(async () => {
    const I = cruciata.internals();
    const b = I.state.buildings.find(
      (x) => x.team === 0 && x.kind === "barracks" && x.progress >= 1,
    );
    cruciata.camera(b.x, b.y);
    cruciata.liveFrame(2);
    I.damage(b, 1e9, { id: -1, team: 1 }, true);
    for (let i = 0; i < 3; i++)
      await new Promise((r) => requestAnimationFrame(r));
    const spawned = I.shards().length;
    const start = I.shards()[0] && { z: I.shards()[0].z, x: I.shards()[0].x };
    cruciata.step(1.2);
    const midAir = I.shards().some((s) => s.land < 0);
    cruciata.step(8);
    const landedAll = I.shards().every((s) => s.land >= 0);
    cruciata.step(8);
    return { spawned, midAir, landedAll, left: I.shards().length, hp: b.hp };
  });
  expect(result.hp).toBe(0);
  expect(result.spawned).toBeGreaterThan(20);
  expect(result.left).toBe(0);
});
