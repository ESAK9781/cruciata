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
    });
  }, level);
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function addUnit(page, type, x, y, id = 961000) {
  await page.evaluate(
    ({ type, x, y, id }) => {
      cruciata.scenario((s) => {
        const u = JSON.parse(
          JSON.stringify(
            s.units.find((v) => v.team === 0 && v.type === "sword"),
          ),
        );
        Object.assign(u, {
          id,
          type,
          x,
          y,
          order: null,
          path: [],
          target: null,
          job: null,
        });
        s.units.push(u);
      });
      cruciata.camera(x, y);
    },
    { type, x, y, id },
  );
  await page.waitForTimeout(120);
}

test("each soldier is drawn as three loosely cohesive figures that follow its single body", async ({
  page,
}) => {
  await begin(page);
  await addUnit(page, "sword", 1400, 2300);
  const result = await page.evaluate(() => {
    const I = cruciata.internals();
    const u = I.state.units.find((v) => v.id === 961000);
    cruciata.order([961000], { x: 1900, y: 2300 });
    let worst = 0,
      tight = 1e9;
    for (let i = 0; i < 150; i++) {
      cruciata.liveFrame(1);
      cruciata.camera(u.x, u.y);
      const figs = I.clusterOf(u).figs;
      for (const f of figs)
        worst = Math.max(worst, Math.hypot(f.x - u.x, f.y - u.y));
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 3; b++)
          if (i > 20)
            tight = Math.min(
              tight,
              Math.hypot(figs[a].x - figs[b].x, figs[a].y - figs[b].y),
            );
    }
    return {
      count: I.clusterOf(u).figs.length,
      worst,
      tight,
      moved: u.x - 1400,
    };
  });
  expect(result.count).toBe(3);
  expect(result.moved).toBeGreaterThan(200);
  expect(result.worst).toBeLessThan(36);
  expect(result.tight).toBeGreaterThan(2);
});

test("clusters add figures only: one health pool, one collision body", async ({
  page,
}) => {
  await begin(page);
  await addUnit(page, "knight", 1400, 2300);
  await page.waitForTimeout(300);
  const stats = await page.evaluate(() => {
    const I = cruciata.internals();
    return {
      figures: I.renderStats.figures,
      units: I.state.units.filter((u) => u.id === 961000).length,
      hp: I.state.units.find((u) => u.id === 961000).hp,
    };
  });
  expect(stats.units).toBe(1);
  expect(stats.hp).toBeGreaterThan(0);
  expect(stats.figures).toBeGreaterThanOrEqual(3);
});

test("animation stops when the view is too small to show it", async ({
  page,
}) => {
  await begin(page);
  await addUnit(page, "sword", 1400, 2300);
  const run = async () =>
    page.evaluate(() => {
      const u = cruciata.internals().state.units.find((v) => v.id === 961000);
      u.order = null;
      cruciata.order([961000], { x: u.x + 600, y: u.y });
      const before = u.anim;
      for (let i = 0; i < 40; i++) cruciata.liveFrame(1);
      return {
        moved: u.anim - before,
        motion: cruciata.internals().motionVisible(),
      };
    });
  const near = await run();
  expect(near.motion).toBe(true);
  expect(near.moved).toBeGreaterThan(1);
  await page.mouse.move(700, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(150);
  const far = await run();
  expect(far.motion).toBe(false);
  expect(far.moved).toBe(0);
});

test("a rally point shows when only the rally, not its building, is in view", async ({
  page,
}) => {
  await begin(page);
  const setup = await page.evaluate(() => {
    const S = cruciata.internals().state;
    const barracks = S.buildings.find(
      (b) => b.team === 0 && b.kind === "barracks",
    );
    let out = null;
    cruciata.scenario((s) => {
      const b = s.buildings.find((x) => x.id === barracks.id);
      b.rally = { x: b.x + 1500, y: b.y };
      out = { id: b.id, rx: b.rally.x, ry: b.rally.y };
    });
    return out;
  });
  await page.evaluate((id) => {
    const b = cruciata.internals().state.buildings.find((x) => x.id === id);
    cruciata.camera(b.x, b.y);
  }, setup.id);
  await page.waitForTimeout(100);
  const click = await page.evaluate((id) => {
    const b = cruciata.internals().state.buildings.find((x) => x.id === id);
    return cruciata.project(b.x, b.y);
  }, setup.id);
  await page.mouse.click(click.x, click.y);
  await page.evaluate(({ rx, ry }) => cruciata.camera(rx, ry), setup);
  await page.waitForTimeout(300);
  const lines = await page.evaluate(
    () => cruciata.internals().renderStats.rallyLines,
  );
  expect(lines).toBeGreaterThan(0);
});

test("order lines show for troops that are off-screen but marching toward the view", async ({
  page,
}) => {
  await begin(page);
  await addUnit(page, "sword", 1400, 2300);
  await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    const p = cruciata.project(u.x, u.y);
    window.__p = p;
  });
  const p = await page.evaluate(() => window.__p);
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    cruciata.order([961000], { x: u.x + 2500, y: u.y });
    cruciata.camera(u.x + 2500, u.y);
  });
  await page.waitForTimeout(300);
  const lines = await page.evaluate(
    () => cruciata.internals().renderStats.orderLines,
  );
  expect(lines).toBeGreaterThan(0);
});

test("siege engines link to targets on screen while they are off-screen", async ({
  page,
}) => {
  await begin(page);
  await addUnit(page, "trebuchet", 1400, 2300);
  await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    u.deployment = "deployed";
    u.fireTarget = { x: u.x + 600, y: u.y };
  });
  const p = await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    return cruciata.project(u.x, u.y);
  });
  await page.mouse.click(p.x, p.y);
  await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    cruciata.camera(u.x + 3000, u.y);
  });
  await page.waitForTimeout(200);
  const before = await page.evaluate(
    () => cruciata.internals().renderStats.siegeLinks,
  );
  expect(before).toBe(0);
  // The target is on screen and the engine is not (it is 600 units to the west).
  await page.evaluate(() => {
    const u = cruciata.internals().state.units.find((v) => v.id === 961000);
    cruciata.camera(u.fireTarget.x + 520, u.fireTarget.y);
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const I = cruciata.internals();
    const u = I.state.units.find((v) => v.id === 961000);
    return {
      links: I.renderStats.siegeLinks,
      selected: cruciata.snapshot().selected.includes(u.id),
    };
  });
  expect(after.selected).toBe(true);
  expect(after.links).toBeGreaterThan(0);
});

test("a siege projectile in flight gives its side ordinary sight", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.cheats = { reveal: false };
      s.enemy.think = 1e9;
    });
  });
  const result = await page.evaluate(() => {
    const spot = { x: 6200, y: 6200 };
    const before = cruciata.vision(spot).visible;
    cruciata.scenario((s) => {
      s.boulders.push({
        x: 5500,
        y: 6200,
        sx: 5500,
        sy: 6200,
        tx: 7000,
        ty: 6200,
        t: 0,
        duration: 3,
        team: 0,
        damage: 0,
        r: 10,
        heavy: false,
      });
    });
    for (let i = 0; i < 40; i++) cruciata.step(1 / 30);
    const b = cruciata.snapshot().boulders[0];
    return {
      before,
      during: b
        ? cruciata.vision({ x: b.x, y: b.y }).visible
        : cruciata.vision({ x: 5500 + 1500 * (40 / 90), y: 6200 }).visible,
    };
  });
  expect(result.before).toBe(false);
  expect(result.during).toBe(true);
});

async function engine(page, stance) {
  return page.evaluate((stance) => {
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 981000,
        kind: "greatengine",
        team: 0,
        x: 1200,
        y: 2400,
        w: 120,
        h: 120,
        r: 60,
        hp: 5000,
        maxHp: 5000,
        progress: 1,
        guardCooldown: 0,
        queue: [],
        stance,
      });
      s.buildings.push({
        ...template,
        id: 981001,
        kind: "house",
        team: 1,
        x: 2300,
        y: 2400,
        w: 50,
        h: 50,
        hp: 5000,
        maxHp: 5000,
        progress: 1,
        queue: [],
      });
    });
    // A scout keeps the target in allied sight.
    cruciata.scenario((s) => {
      const scout = JSON.parse(
        JSON.stringify(s.units.find((v) => v.team === 0 && v.type === "sword")),
      );
      Object.assign(scout, {
        id: 981002,
        x: 2150,
        y: 2400,
        order: null,
        path: [],
        stance: "stand-down",
      });
      s.units.push(scout);
    });
    for (let i = 0; i < 25 * 30; i++) cruciata.step(1 / 30);
    const b = cruciata.internals().state.buildings.find((x) => x.id === 981000);
    return { shot: !!b.lastShot };
  }, stance);
}

test("great engines fire at will in the default stance", async ({ page }) => {
  await begin(page);
  expect((await engine(page, undefined)).shot).toBe(true);
});

test("a great engine standing down does not fire, and Hold fires only at ordered targets", async ({
  page,
}) => {
  await begin(page);
  expect((await engine(page, "stand-down")).shot).toBe(false);
  await begin(page);
  expect((await engine(page, "hold")).shot).toBe(false);
});
