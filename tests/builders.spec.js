const { test, expect } = require("./helpers");

async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.cheat?.("resources");
  }, level);
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function screenOf(page, x, y) {
  await page.evaluate(({ x, y }) => cruciata.camera(x, y), { x, y });
  await page.waitForTimeout(80);
  return page.evaluate(({ x, y }) => cruciata.project(x, y), { x, y });
}

test("villagers finish a dragged wall with diagonal corners", async ({
  page,
}) => {
  await begin(page);
  const base = await page.evaluate(() => {
    const t = cruciata
      .internals()
      .state.buildings.find((b) => b.team === 0 && b.kind === "towncenter");
    return { x: t.x, y: t.y };
  });
  await screenOf(page, base.x, base.y);
  await page.click("#workers-button");
  const a = await page.evaluate(
    ({ x, y }) => cruciata.project(x - 250, y + 150),
    base,
  );
  const b = await page.evaluate(
    ({ x, y }) => cruciata.project(x + 10, y + 310),
    base,
  );
  await page.click("#build-wall");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, a.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const result = await page.evaluate(() => {
    const walls = () =>
      cruciata
        .internals()
        .state.buildings.filter(
          (w) => w.team === 0 && w.kind === "wall" && w.hp > 0,
        );
    const planned = walls().length;
    let seconds = null;
    for (let i = 0; i < 150 * 30; i++) {
      cruciata.liveFrame(1);
      if (i % 30 === 0 && walls().every((w) => w.progress >= 1)) {
        seconds = i / 30;
        break;
      }
    }
    return { planned, seconds };
  });
  expect(result.planned).toBeGreaterThan(3);
  expect(result.seconds).not.toBeNull();
});

test("right-click sends villagers to an unfinished wall section and to a tree", async ({
  page,
}) => {
  await begin(page);
  const setup = await page.evaluate(() => {
    const s = cruciata.internals().state;
    const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
    const tree = s.nodes.find((n) => n.kind === "wood" && n.remaining > 0);
    cruciata.scenario((st) => {
      const w = st.units.find((u) => u.id === worker.id);
      const wall = {
        id: 880001,
        kind: "wall",
        team: 0,
        x: Math.round((w.x + 160) / 32) * 32,
        y: Math.round((w.y + 96) / 32) * 32,
        w: 32,
        h: 32,
        hp: 20,
        maxHp: 2200,
        progress: 0.1,
        wallAngle: Math.PI / 4,
        queue: [],
        links: {},
      };
      st.buildings.push(wall);
    });
    return { id: worker.id, tree: { id: tree.id, x: tree.x, y: tree.y } };
  });
  const wall = await page.evaluate(() =>
    cruciata.internals().state.buildings.find((b) => b.id === 880001),
  );
  // Select the worker by clicking it, then right-click the wall's diagonal body.
  const worker = await page.evaluate((id) => {
    const u = cruciata.internals().state.units.find((u) => u.id === id);
    return { x: u.x, y: u.y };
  }, setup.id);
  const w = await screenOf(page, worker.x, worker.y);
  await page.mouse.click(w.x, w.y);
  expect(await page.evaluate(() => cruciata.snapshot().selected)).toContain(
    setup.id,
  );
  const target = await page.evaluate(
    ({ x, y }) => cruciata.project(x + 23, y + 23),
    wall,
  );
  await page.mouse.click(target.x, target.y, { button: "right" });
  const job = await page.evaluate(
    (id) => cruciata.internals().state.units.find((u) => u.id === id).job,
    setup.id,
  );
  expect(job?.kind).toBe("build");
  expect(job?.target).toBe(880001);

  const tree = await screenOf(page, setup.tree.x, setup.tree.y);
  await page.mouse.click(tree.x, tree.y, { button: "right" });
  const gather = await page.evaluate(
    (id) => cruciata.internals().state.units.find((u) => u.id === id).job,
    setup.id,
  );
  expect(gather?.kind).toBe("gather");
  expect(gather?.target).toBe(setup.tree.id);
});

test("a slightly shaky click still selects a unit when the view is zoomed out", async ({
  page,
}) => {
  await begin(page);
  const sword = await page.evaluate(() => {
    const u = cruciata
      .internals()
      .state.units.find((u) => u.team === 0 && u.type === "sword");
    return { id: u.id, x: u.x, y: u.y };
  });
  const p = await screenOf(page, sword.x, sword.y);
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  const q = await page.evaluate(({ x, y }) => cruciata.project(x, y), sword);
  const far = await page.evaluate(
    ({ x, y }) => cruciata.project(x + 100, y),
    sword,
  );
  const scale = (far.x - q.x) / 100;
  expect(scale).toBeLessThan(0.75);
  // Press on the body, above the unit's ground point, so a box would miss it.
  await page.mouse.move(q.x, q.y - 8);
  await page.mouse.down();
  await page.mouse.move(q.x + 5, q.y - 4);
  await page.mouse.up();
  expect(await page.evaluate(() => cruciata.snapshot().selected)).toContain(
    sword.id,
  );
});
