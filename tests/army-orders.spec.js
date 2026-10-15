const { test, expect } = require("./helpers");

async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      s.nodes = [];
      s.decorations = [];
    });
  }, level);
}

async function addArmy(page, count, at, type = "sword") {
  return page.evaluate(
    ({ count, at, type }) => {
      const ids = [];
      cruciata.scenario((s) => {
        const template = JSON.parse(
          JSON.stringify(
            s.units.find((u) => u.team === 0 && u.type === "sword"),
          ),
        );
        for (let i = 0; i < count; i++) {
          const u = JSON.parse(JSON.stringify(template));
          Object.assign(u, {
            id: 960000 + i,
            type,
            x: at.x + (i % 12) * 30,
            y: at.y + Math.floor(i / 12) * 30,
            order: null,
            path: [],
            target: null,
            job: null,
            stance: "fight",
          });
          s.units.push(u);
          ids.push(u.id);
        }
      });
      return ids;
    },
    { count, at, type },
  );
}

test("a large army marches off together instead of piling onto its own origin", async ({
  page,
}) => {
  await begin(page);
  const ids = await addArmy(page, 120, { x: 1000, y: 2300 });
  const result = await page.evaluate((ids) => {
    cruciata.order(ids, { x: 3400, y: 2300 });
    let worstOverlap = 0,
      worstBackward = 0;
    for (let i = 0; i < 6 * 30; i++) {
      cruciata.liveFrame(1);
      if (i % 10) continue;
      const us = cruciata
        .internals()
        .state.units.filter((u) => ids.includes(u.id));
      let overlap = 0,
        backward = 0;
      for (let a = 0; a < us.length; a++) {
        if ((us[a].vx || 0) < -25) backward++;
        for (let b = a + 1; b < us.length; b++)
          if (Math.hypot(us[a].x - us[b].x, us[a].y - us[b].y) < 14) overlap++;
      }
      worstOverlap = Math.max(worstOverlap, overlap);
      worstBackward = Math.max(worstBackward, backward);
    }
    return { worstOverlap, worstBackward };
  }, ids);
  expect(result.worstOverlap).toBeLessThan(20);
  expect(result.worstBackward).toBeLessThan(15);
});

test("attack mode gives every soldier the identical point and no formation slot", async ({
  page,
}) => {
  await begin(page);
  const ids = await addArmy(page, 60, { x: 1000, y: 2300 });
  const orders = await page.evaluate((ids) => {
    cruciata.order(ids, { x: 2600, y: 2300 }, true);
    return cruciata
      .internals()
      .state.units.filter((u) => ids.includes(u.id))
      .map((u) => ({
        x: u.order.x,
        y: u.order.y,
        swarm: u.order.swarm,
        attack: u.order.attack,
      }));
  }, ids);
  expect(new Set(orders.map((o) => o.x + "," + o.y)).size).toBe(1);
  expect(orders.every((o) => o.swarm && o.attack)).toBe(true);
});

test("attack mode ignores the formation but still arrives as a loose, non-stacked crowd", async ({
  page,
}) => {
  await begin(page);
  const ids = await addArmy(page, 60, { x: 1000, y: 2300 });
  const target = { x: 2600, y: 2300 };
  const final = await page.evaluate(
    ({ ids, target }) => {
      cruciata.order(ids, target, true);
      for (let i = 0; i < 50 * 30; i++) cruciata.liveFrame(1);
      return cruciata
        .internals()
        .state.units.filter((u) => ids.includes(u.id))
        .map((u) => ({ x: u.x, y: u.y, order: !!u.order }));
    },
    { ids, target },
  );
  const reach = 14 * Math.sqrt(60) * 3;
  expect(
    final.every((u) => Math.hypot(u.x - target.x, u.y - target.y) < reach),
  ).toBe(true);
  expect(final.filter((u) => u.order).length).toBe(0);
  // Spread out around the point rather than stacked on it.
  let nearest = 0;
  for (const a of final) {
    let best = 1e9;
    for (const b of final)
      if (a !== b) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
    nearest += best;
  }
  expect(nearest / final.length).toBeGreaterThan(14);
});

test("attack mode into a walled enemy compound breaches the walls", async ({
  page,
}) => {
  await begin(page);
  const ids = await addArmy(page, 40, { x: 900, y: 2300 });
  const result = await page.evaluate((ids) => {
    const centre = { x: 2300, y: 2400 };
    cruciata.scenario((s) => {
      const template = s.buildings[0];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        s.buildings.push({
          ...JSON.parse(JSON.stringify(template)),
          id: 970000 + i,
          kind: "wall",
          team: 1,
          x: Math.round(centre.x + Math.cos(a) * 200),
          y: Math.round(centre.y + Math.sin(a) * 200),
          w: 32,
          h: 32,
          wallAngle: a + Math.PI / 2,
          hp: 900,
          maxHp: 900,
          progress: 1,
          queue: [],
          links: {},
          defence: true,
        });
      }
      s.navDirty = true;
    });
    cruciata.step(2);
    cruciata.order(ids, centre, true);
    for (let i = 0; i < 90 * 30; i++) cruciata.liveFrame(1);
    const S = cruciata.internals().state;
    const walls = S.buildings.filter((b) => b.id >= 970000 && b.id < 970040);
    const damaged = walls.filter((w) => w.hp < w.maxHp).length;
    const us = S.units.filter((u) => ids.includes(u.id) && u.hp > 0);
    const near = us.filter(
      (u) => Math.hypot(u.x - centre.x, u.y - centre.y) < 420,
    ).length;
    return { damaged, near, alive: us.length };
  }, ids);
  expect(result.damaged).toBeGreaterThan(0);
  expect(result.near).toBeGreaterThan(result.alive * 0.5);
});
