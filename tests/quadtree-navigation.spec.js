const { test, expect } = require("./helpers");

async function begin(page, level) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
  }, level);
}

test("open ground costs far fewer navigation nodes than a uniform grid", async ({
  page,
}) => {
  await begin(page, 3);
  const stats = await page.evaluate(() => {
    const nav = cruciata.internals().nav;
    let free = 0;
    for (const v of nav.blocked) if (!v) free++;
    return { leaves: nav.leafTotal, free };
  });
  expect(stats.leaves).toBeGreaterThan(0);
  expect(stats.leaves).toBeLessThan(stats.free * 0.1);
});

test("quadtree routes are physically clear, no longer than grid routes, and use fewer waypoints", async ({
  page,
}) => {
  await begin(page, 5);
  const result = await page.evaluate(() => {
    const nav = cruciata.internals().nav;
    let seed = 777;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pick = () => {
      for (let i = 0; i < 500; i++) {
        const p = {
          x: 200 + rnd() * (nav.width - 400),
          y: 200 + rnd() * (nav.height - 400),
        };
        if (nav.pointFree(p.x, p.y) && nav.physicalFree(p.x, p.y)) return p;
      }
    };
    const pairs = [];
    while (pairs.length < 40) pairs.push([pick(), pick()]);
    const measure = (leaves) => {
      nav.useLeaves = leaves;
      nav.pathCache.clear();
      let invalid = 0,
        length = 0,
        points = 0,
        found = 0;
      for (const [a, b] of pairs) {
        const sc = nav.nearest(a.x, a.y),
          ec = nav.nearest(b.x, b.y);
        if (
          nav.components[sc.y * nav.cols + sc.x] !==
          nav.components[ec.y * nav.cols + ec.x]
        )
          continue;
        const path = nav.findRoute(a, b, false);
        if (!path.length) continue;
        found++;
        let prev = a;
        for (const p of path) {
          if (!nav.clearLine(prev, p)) invalid++;
          length += Math.hypot(p.x - prev.x, p.y - prev.y);
          prev = p;
        }
        points += path.length;
      }
      return { invalid, length, points, found };
    };
    const grid = measure(false),
      tree = measure(true);
    nav.useLeaves = true;
    return { grid, tree };
  });
  expect(result.tree.found).toBe(result.grid.found);
  expect(result.tree.invalid).toBe(0);
  expect(result.tree.length).toBeLessThan(result.grid.length * 1.03);
  expect(result.tree.points).toBeLessThan(result.grid.points);
});

test("routes still detour around a wall built across open ground", async ({
  page,
}) => {
  await begin(page, 0);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.buildings.push({
        ...s.buildings[0],
        id: 998001,
        kind: "house",
        team: 2,
        x: 2000,
        y: 2400,
        w: 60,
        h: 900,
        progress: 1,
        hp: 9999,
        queue: [],
      });
      s.navDirty = true;
    });
    cruciata.step(2);
    const nav = cruciata.internals().nav;
    const path = nav.findRoute(
      { x: 1500, y: 2400 },
      { x: 2600, y: 2400 },
      false,
    );
    let prev = { x: 1500, y: 2400 },
      ok = true,
      length = 0;
    for (const p of path) {
      if (!nav.clearLine(prev, p)) ok = false;
      length += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return { count: path.length, ok, length };
  });
  expect(result.count).toBeGreaterThan(1);
  expect(result.ok).toBe(true);
  expect(result.length).toBeGreaterThan(1100);
});

test("the unit quadtree answers the same queries as a brute-force scan", async ({
  page,
}) => {
  await begin(page, 5);
  const mismatches = await page.evaluate(() => {
    const I = cruciata.internals();
    cruciata.step(1);
    const units = I.state.units.filter((u) => u.hp > 0);
    let bad = 0;
    for (let i = 0; i < 60; i++) {
      const u = units[(i * 7) % units.length];
      for (const r of [40, 140, 420]) {
        const a = I.nearby(u, r)
          .map((o) => o.id)
          .sort((x, y) => x - y);
        const b = units
          .filter((o) => Math.hypot(o.x - u.x, o.y - u.y) < r)
          .map((o) => o.id)
          .sort((x, y) => x - y);
        if (JSON.stringify(a) !== JSON.stringify(b)) bad++;
      }
    }
    return bad;
  });
  expect(mismatches).toBe(0);
});
