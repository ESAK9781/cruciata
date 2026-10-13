const { test, expect } = require("./helpers");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}

test("troops travel independently and finish their assigned arrival positions", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.nodes = [];
      s.units = s.units.filter((u) => u.team === 0 && u.type !== "worker");

      for (const [i, u] of s.units.entries()) {
        u.x = 1100 + (i % 4) * 24;
        u.y = 2600 + Math.floor(i / 4) * 24;
        u.target = null;
      }
      s.enemy.think = 1e6;
    }),
  );
  await page.keyboard.press("Space");
  const target = await page.evaluate(() => {
    cruciata.camera(1700, 2600);
    return cruciata.project(2000, 2600);
  });
  await page.mouse.click(target.x, target.y, { button: "right" });
  const result = await page.evaluate(() => {
    const original = cruciata
        .snapshot()
        .units.map((u) => ({ id: u.id, order: u.order })),
      samples = [];
    for (let i = 0; i < 35; i++) {
      cruciata.step(1);
      const s = cruciata.snapshot();
      samples.push({
        x: s.units.reduce((a, u) => a + u.x / s.units.length, 0),
        remaining: s.units.filter((u) => u.order).length,
      });
    }
    return { original, samples, end: cruciata.snapshot() };
  });
  for (let i = 3; i < 9; i++)
    expect(result.samples[i].x - result.samples[i - 1].x).toBeGreaterThan(20);
  expect(result.end.units.filter((u) => u.order).length).toBe(0);
  for (const expected of result.original.filter(
    (u) => result.end.units.find((v) => v.id === u.id).type !== "chaplain",
  )) {
    const u = result.end.units.find((u) => u.id === expected.id);
    expect(
      Math.hypot(u.x - expected.order.x, u.y - expected.order.y),
    ).toBeLessThan(12);
  }
});

for (const difficulty of ["easy", "normal", "hard"])
  test(`${difficulty} scouts explore without early raids or offensive companies`, async ({
    page,
  }) => {
    await begin(page);
    await page.evaluate(
      (difficulty) =>
        cruciata.scenario((s) => {
          s.difficulty = difficulty;
        }),
      difficulty,
    );
    await page.evaluate(() => cruciata.step(120));
    const s = await page.evaluate(() => cruciata.snapshot());
    expect(s.enemy.attack).toBe(0);
    expect(s.losses).toBe(0);
    expect(
      s.units
        .filter((u) => u.team === 1 && u.scout)
        .every((u) => !u.target && !u.order?.attack),
    ).toBe(true);
    expect(
      s.buildings.filter((b) => b.team === 0 && b.kind === "tower").length,
    ).toBe(2);
  });

test("debug menu provides powerful production cheats and its flag can disable them", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#open-campaign").click();
  await page.locator("#chapter-0").click();
  await page.locator("#overlay button").click();
  await page.keyboard.press("F2");
  await expect(page.locator("#debug-menu")).toBeVisible();
  await page.locator("[data-cheat=resources]").click();
  expect((await page.evaluate(() => cruciata.snapshot())).wood).toBeGreaterThan(
    10000,
  );
  const count = await page.evaluate(
    () => cruciata.snapshot().units.filter((u) => u.team === 0).length,
  );
  await page.locator("[data-cheat=army]").click();
  expect(
    await page.evaluate(
      () => cruciata.snapshot().units.filter((u) => u.team === 0).length,
    ),
  ).toBe(count + 48);
  await page.locator("[data-cheat=invulnerable]").click();
  await expect(page.locator("[data-cheat=invulnerable]")).toHaveClass(/active/);
  await page.locator("[data-cheat=instant]").click();
  await page.locator("[data-cheat=reveal]").click();
  await page.locator("[data-cheat=speed]").click();
  const s = await page.evaluate(() => cruciata.snapshot());
  expect(s.cheats).toMatchObject({
    invulnerable: true,
    instant: true,
    reveal: true,
    speed: 4,
  });
  await page.locator("#debug-close").click();
  await expect(page.locator("#debug-menu")).not.toBeVisible();
  await page.route("**/game.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "DEBUG_MODE = true",
        "DEBUG_MODE = false",
      ),
    });
  });
  await page.reload();
  await expect(page.locator("#debug-button")).toHaveCount(0);
  await expect(page.locator("#debug-menu")).toHaveCount(0);
  expect(await page.evaluate(() => cruciata.debugMode)).toBe(false);
});

test("close building placement accepts a two-pace gap and rejects overlap", async ({
  page,
}) => {
  await begin(page);
  const sites = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.units = [];
      s.buildings.slice(1).forEach((b) => (b.hp = 0));
    });
    const b = cruciata.snapshot().buildings[0];
    const house = cruciata.snapshot().buildings.find((b) => b.kind === "house");
    const near = { x: b.x + b.w / 2 + house.w / 2 + 2, y: b.y };
    return {
      near,
      allowed: cruciata.site("house", near),
      overlap: cruciata.site("house", { x: near.x - 4, y: near.y }),
    };
  });
  expect(sites.allowed).toBe(true);
  expect(sites.overlap).toBe(false);
});

test("native terrain surf animates while ships retain sharp detailed overhead artwork", async ({
  page,
}) => {
  await begin(page);
  const results = await page.evaluate(() => {
    const paint = (time) => {
      const c = document.createElement("canvas");
      c.width = 600;
      c.height = 300;
      const g = c.getContext("2d");
      g.translate(0, -1500);
      CruciataArt.terrainDetails(
        g,
        { x: 0, y: 1500, w: 600, h: 300 },
        0,
        () => 240,
        () => 300,
        time,
        1150,
        true,
      );
      return c.toDataURL();
    };
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 210;
    CruciataArt.ship(c.getContext("2d"), 60, 90, 0);
    const data = c.getContext("2d").getImageData(0, 0, 120, 210).data,
      colours = new Set();
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return { changed: paint(0) !== paint(3), colours: colours.size };
  });
  expect(results.changed).toBe(true);
  expect(results.colours).toBeGreaterThan(100);
});

test("archers preserve their shooting angle while retreating from melee threats", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.nodes = [];
      const archer = s.units.find((u) => u.team === 0 && u.type === "archer"),
        enemy = s.units.find((u) => u.team === 1 && u.type === "sword");
      s.units = [archer, enemy];
      archer.x = 1200;
      archer.y = 2600;
      archer.cooldown = 0;
      enemy.x = 1250;
      enemy.y = 2600;
      enemy.hold = true;
      s.enemy.think = 1e6;
    }),
  );
  await page.evaluate(() => cruciata.step(0.05));
  const s = await page.evaluate(() => cruciata.snapshot()),
    archer = s.units.find((u) => u.type === "archer");
  expect(archer.strike).toBeGreaterThan(0);
  expect(Math.abs(archer.aimAngle)).toBeLessThan(0.1);
  expect(s.arrows.length).toBeGreaterThan(0);
});
async function world(page, x, y, options = {}) {
  const p = await page.evaluate(({ x, y }) => cruciata.project(x, y), { x, y });
  for (const modifier of options.modifiers || [])
    await page.keyboard.down(modifier);
  await page.mouse.click(p.x, p.y, options);
  for (const modifier of [...(options.modifiers || [])].reverse())
    await page.keyboard.up(modifier);
}
async function rectangle(page, a, b, alt = false) {
  const points = await page.evaluate(
    ({ a, b }) => [cruciata.project(a.x, a.y), cruciata.project(b.x, b.y)],
    { a, b },
  );
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 8 });
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}
async function clearTerrain(page) {
  await page.evaluate(() => {
    cruciata.cheat("resources");
    cruciata.cheat("reveal");
    cruciata.scenario((s) => {
      s.nodes = [];
      s.enemy.think = 1e6;
    });
    cruciata.camera(1350, 2600);
  });
}

test("Shift queues different construction projects in order and builders finish both", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  const worker = await page.evaluate(() => {
    let id;
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      u.x = 1100;
      u.y = 2600;
      u.job = null;
      u.order = null;
      id = u.id;
    });
    return id;
  });
  await world(page, 1100, 2600);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-house").click();
  await world(page, 1248, 2600, { modifiers: ["Shift"] });
  await page.locator("#build-mill").click();
  await world(page, 1408, 2600, { modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  const planned = await page.evaluate(() => cruciata.snapshot()),
    projects = planned.buildings.slice(-2),
    u = planned.units.find((u) => u.id === worker);
  expect(u.job.target).toBe(projects[0].id);
  expect(u.buildQueue).toEqual([projects[1].id]);
  await page.evaluate(() => cruciata.step(100));
  const done = await page.evaluate(() => cruciata.snapshot());
  expect(
    projects.every(
      (b) => done.buildings.find((v) => v.id === b.id).progress === 1,
    ),
  ).toBe(true);
});

test("rectangle selection cancels multiple foundations completely without rubble", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-house").click();
  await world(page, 1248, 2600, { modifiers: ["Shift"] });
  await world(page, 1408, 2600, { modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  const ids = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.slice(-2)
      .map((b) => b.id),
  );
  await rectangle(page, { x: 1200, y: 2550 }, { x: 1460, y: 2650 });
  expect(
    (await page.evaluate(() => cruciata.snapshot())).selectedBuildings,
  ).toEqual(ids);
  await page.locator("#cancel-button").click();
  const s = await page.evaluate(() => cruciata.snapshot());
  expect(s.buildings.some((b) => ids.includes(b.id))).toBe(false);
});

test("bulk selection recruits and cancels a unit from every compatible producer", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-barracks").click();
  await world(page, 1248, 2700, { modifiers: ["Shift"] });
  await world(page, 1408, 2700, { modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    cruciata.cheat("instant");
    cruciata.step(0.05);
    cruciata.cheat("instant");
  });
  await rectangle(page, { x: 1180, y: 2640 }, { x: 1460, y: 2760 });
  await expect(page.locator("#selection-title")).toHaveText(
    "2 selected structures",
  );
  await page.locator("#recruit-sword").click();
  let s = await page.evaluate(() => cruciata.snapshot());
  expect(s.buildings.slice(-2).every((b) => b.queue[0]?.type === "sword")).toBe(
    true,
  );
  await page.locator("#cancel-button").click();
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.buildings.slice(-2).every((b) => b.queue.length === 0)).toBe(true);
});

test("diagonal walls connect physically and Shift continues from the last endpoint", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-wall").click();
  const a = await page.evaluate(() => cruciata.project(1248, 2496)),
    b = await page.evaluate(() => cruciata.project(1408, 2656));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.keyboard.down("Shift");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  let s = await page.evaluate(() => cruciata.snapshot());
  const first = s.buildings.filter((b) => b.team === 0 && b.kind === "wall");
  expect(first.length).toBe(6);
  expect(first.every((b) => Object.keys(b.links).length > 0)).toBe(true);
  expect(await page.evaluate(() => cruciata.free({ x: 1264, y: 2512 }))).toBe(
    false,
  );
  const c = await page.evaluate(() => cruciata.project(1408, 2816));
  await page.mouse.move(c.x, c.y);
  await page.screenshot({ path: "artifacts/wall-waypoint-preview.png" });
  await page.mouse.click(c.x, c.y);
  s = await page.evaluate(() => cruciata.snapshot());
  const walls = s.buildings.filter((b) => b.team === 0 && b.kind === "wall");
  expect(walls.length).toBe(11);
  expect(walls.filter((b) => b.x === 1408 && b.y === 2656).length).toBe(1);
  expect(walls.find((b) => b.x === 1408 && b.y === 2656).links.s).toBeTruthy();
  await page.evaluate(() => {
    cruciata.cheat("instant");
    cruciata.step(0.05);
  });
  await page.screenshot({ path: "artifacts/connected-diagonal-walls.png" });
});

test("workers reserve separate harvesting positions around a shared food patch", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.cheat("reveal");
    cruciata.scenario((s) => {
      const food = s.nodes.find((n) => n.kind === "food");
      s.nodes = [food];
      food.x = 1300;
      food.y = 2600;
      food.remaining = food.max = 500;
      let i = 0;
      for (const u of s.units.filter(
        (u) => u.team === 0 && u.type === "worker",
      )) {
        u.x = 1210 + (i % 3) * 22;
        u.y = 2560 + Math.floor(i / 3) * 40;
        u.job = null;
        u.order = null;
        i++;
      }
      s.enemy.think = 1e6;
    });
    cruciata.camera(1300, 2600);
  });
  await page.keyboard.press("KeyE");
  await world(page, 1300, 2600, { button: "right" });
  await page.evaluate(() => cruciata.step(3));
  const s = await page.evaluate(() => cruciata.snapshot()),
    workers = s.units.filter((u) => u.team === 0 && u.type === "worker");
  expect(workers.every((u) => u.harvestSpot)).toBe(true);
  for (let i = 0; i < workers.length; i++)
    for (let j = i + 1; j < workers.length; j++)
      expect(
        Math.hypot(
          workers[i].harvestSpot.x - workers[j].harvestSpot.x,
          workers[i].harvestSpot.y - workers[j].harvestSpot.y,
        ),
      ).toBeGreaterThan(21);
});

test("auto scout explores together, retreats without fighting, and ends on a manual order", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      let i = 0;
      for (const u of s.units.filter(
        (u) => u.team === 0 && u.type !== "worker",
      )) {
        u.x = 1250 + (i % 4) * 32;
        u.y = 2600 + Math.floor(i / 4) * 32;
        u.order = null;
        u.target = null;
        i++;
      }
      s.enemy.think = 1e6;
    }),
  );
  await page.keyboard.press("Space");
  await page.locator("#scout-button").click();
  await page.evaluate(() => cruciata.step(0.1));
  let s = await page.evaluate(() => cruciata.snapshot()),
    g = s.scoutingGroups[0];
  expect(g.status).toBe("exploring");
  expect(
    new Set(s.units.filter((u) => u.autoScout).map((u) => u.order?.formation))
      .size,
  ).toBe(1);
  expect(await page.evaluate((p) => cruciata.vision(p).explored, g.goal)).toBe(
    false,
  );
  await page.evaluate(() => cruciata.step(8));
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.scoutingGroups[0].id).toBe(g.id);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.autoScout),
        enemy = s.units.find((u) => u.team === 1 && u.type === "sword");
      enemy.x = u.x + 20;
      enemy.y = u.y;
      enemy.home = null;
      enemy.hold = true;
      enemy.target = u.id;
      enemy.manualTarget = true;
      enemy.cooldown = 0;
    }),
  );
  await page.evaluate(() => cruciata.step(1));
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.scoutingGroups[0].status).toBe("withdrawing");
  expect(s.units.filter((u) => u.autoScout).every((u) => !u.target)).toBe(true);
  expect(s.arrows.some((a) => a.team === 0)).toBe(false);
  await page.keyboard.press("KeyH");
  await page.evaluate(() => cruciata.step(0.1));
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.units.some((u) => u.autoScout)).toBe(false);
  expect(s.scoutingGroups.length).toBe(0);
});

test("expended patches draw no remnants and a Jerusalem Cross favicon is bundled", async ({
  page,
}) => {
  await begin(page);
  const empty = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 100;
    const g = c.getContext("2d");
    for (const kind of ["food", "wood", "gold", "stone"])
      CruciataArt.resource(g, { kind, x: 50, y: 50, remaining: 0 }, 0);
    return Array.from(g.getImageData(0, 0, 100, 100).data).every(
      (v) => v === 0,
    );
  });
  expect(empty).toBe(true);
  const icon = page.locator("link[rel=icon]");
  await expect(icon).toHaveAttribute("href", "assets/icons/favicon.svg");
  expect((await page.request.get("assets/icons/favicon.svg")).ok()).toBe(true);
});
for (const level of [0, 1, 2, 3, 4, 5])
  test(`campaign ${level + 1} capital destruction overrides unfinished secondary objectives`, async ({
    page,
  }) => {
    await begin(page);
    await page.evaluate((level) => {
      cruciata.start(level);
      cruciata.scenario((s) => {
        s.buildings.find((b) => b.id === s.capitals.enemy).hp = 0;
        s.stats.gathered.food = 0;
        s.stats.rescued = 0;
        s.occupation = 0;
      });
      cruciata.step(0.05);
    }, level);
    expect((await page.evaluate(() => cruciata.snapshot())).result).toBe(
      "victory",
    );
    await page.evaluate((level) => {
      cruciata.start(level);
      cruciata.scenario((s) => {
        s.buildings[0].hp = 0;
      });
      cruciata.step(0.05);
    }, level);
    expect((await page.evaluate(() => cruciata.snapshot())).result).toBe(
      "defeat",
    );
  });

test("only troop-producing buildings accept rally points and neutral villages explain their role", async ({
  page,
}) => {
  await begin(page);
  const s = await page.evaluate(() => cruciata.snapshot()),
    house = s.buildings.find((b) => b.team === 0 && b.kind === "house");
  await page.evaluate((p) => cruciata.camera(p.x, p.y), house);
  await world(page, house.x, house.y);
  await world(page, house.x + 180, house.y + 140, { button: "right" });
  expect(
    (await page.evaluate(() => cruciata.snapshot())).buildings.find(
      (b) => b.id === house.id,
    ).rally,
  ).toBeNull();
  await page.evaluate(() => cruciata.cheat("reveal"));
  const village = s.buildings.find((b) => b.team === 2 && b.kind === "house");
  await page.evaluate((p) => cruciata.camera(p.x, p.y), village);
  await world(page, village.x, village.y);
  await expect(page.locator("#selection-role")).toContainText(
    "Protected neutral village",
  );
  await expect(page.locator("#selection-role")).toContainText("three soldiers");
});

test("wheel zoom preserves the ground under an off-center cursor", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => cruciata.camera(6000, 4000));
  const box = await page.locator("#game").boundingBox(),
    x = box.x + box.width * 0.73,
    y = box.y + box.height * 0.34;
  const before = await page.evaluate(
    ({ x, y }) => {
      const s = cruciata.snapshot(),
        r = document.getElementById("game").getBoundingClientRect();
      return {
        x: s.view.x + (x - r.left) / s.view.scale,
        y: s.view.y + (y - r.top) / s.view.scale,
      };
    },
    { x, y },
  );
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(60);
  const after = await page.evaluate(
    ({ x, y }) => {
      const s = cruciata.snapshot(),
        r = document.getElementById("game").getBoundingClientRect();
      return {
        x: s.view.x + (x - r.left) / s.view.scale,
        y: s.view.y + (y - r.top) / s.view.scale,
      };
    },
    { x, y },
  );
  expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.1);
});

test("joined rock clusters block their interior and roads use passable terrain", async ({
  page,
}) => {
  await begin(page);
  const checks = await page.evaluate(() => {
    const s = cruciata.snapshot(),
      f = s.terrainFeatures[0],
      tile = f.tiles[0],
      p = { x: (tile.x + 0.5) * f.cell, y: (tile.y + 0.5) * f.cell };
    return {
      size: s.world,
      features: s.terrainFeatures.length,
      span: f.rx * 2,
      blocked: !cruciata.free(p),
      roads: s.roads.length,
      clear: s.roads.every((road) => road.every((p) => cruciata.free(p))),
    };
  });
  expect(checks.size.width).toBe(12800);
  expect(checks.features).toBeGreaterThan(3);
  expect(checks.span).toBeGreaterThan(200);
  expect(checks.blocked).toBe(true);
  expect(checks.roads).toBeGreaterThan(3);
  expect(checks.clear).toBe(true);
});

test("trebuchet deployment is explicit and ground fire produces an arcing shell and impact burst", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "sword");
      u.type = "trebuchet";
      u.deployment = "packed";
      u.x = 1400;
      u.y = 2800;
      u.order = null;
      u.hold = false;
      s.nodes = [];
      s.enemy.think = 1e6;
    });
    cruciata.camera(1650, 2800);
  });
  await world(page, 1400, 2800);
  await page.keyboard.press("KeyF");
  await world(page, 1750, 2800);
  await page.evaluate(() => cruciata.step(3));
  let s = await page.evaluate(() => cruciata.snapshot()),
    u = s.units.find((u) => u.team === 0 && u.type === "trebuchet");
  expect(u.deployment).toBe("packed");
  await page.evaluate(
    (id) =>
      cruciata.scenario((s) => {
        const u = s.units.find((u) => u.id === id);
        u.x = 1400;
        u.y = 2800;
        u.order = null;
        u.cooldown = 0;
      }),
    u.id,
  );
  await page.locator("#deploy-button").click();
  await page.evaluate(() => cruciata.step(6.1));
  await world(page, 1800, 2800, { button: "right" });
  await page.evaluate(() => cruciata.step(1.1));
  s = await page.evaluate(() => cruciata.snapshot());
  u = s.units.find((u) => u.team === 0 && u.type === "trebuchet");
  expect(u.deployment).toBe("deployed");
  expect(Math.abs(u.fireTarget.x - 1800)).toBeLessThan(1);
  expect(Math.abs(u.fireTarget.y - 2800)).toBeLessThan(1);
  expect(s.boulders.length).toBe(1);
  expect(s.boulders[0].t).toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/siege-range-fireball.png" });
  await page.evaluate(() => cruciata.step(2.2));
  s = await page.evaluate(() => cruciata.snapshot());
  expect(
    s.particles.some((p) =>
      ["#ffd778", "#ee8633", "#d0461d"].includes(p.color),
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/siege-impact-burst.png" });
  await page.locator("#deploy-button").click();
  await page.evaluate(() => cruciata.step(4.1));
  expect(
    (await page.evaluate(() => cruciata.snapshot())).units.find(
      (v) => v.id === u.id,
    ).deployment,
  ).toBe("packed");
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 3840, height: 2160 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`command panel stays contained at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await begin(page);
    await page.keyboard.press("Space");
    const layout = await page.evaluate(() => {
      const panel = document
        .querySelector(".command-panel")
        .getBoundingClientRect();
      return {
        overflow:
          document.documentElement.scrollHeight > innerHeight ||
          document.documentElement.scrollWidth > innerWidth,
        buttons: [...document.querySelectorAll(".commands button")]
          .filter((e) => e.getClientRects().length)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.bottom <= panel.bottom + 1 &&
              r.top >= panel.top - 1 &&
              r.left >= panel.left - 1 &&
              r.right <= panel.right + 1
            );
          }),
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.buttons.every(Boolean)).toBe(true);
  });

test("a hundred marching troops reach their independent destinations without slot chasing", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.cheat("army");
    cruciata.cheat("army");
    cruciata.cheat("army");
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.units = s.units.filter(
        (u) => u.team === 0 && u.type !== "worker" && u.type !== "chaplain",
      );
      s.units.forEach((u, i) => {
        u.x = 1200 + (i % 12) * 28;
        u.y = 2700 + Math.floor(i / 12) * 28;
        u.target = null;
        u.order = null;
      });
      s.enemy.think = 1e6;
    });
  });
  await page.keyboard.press("Space");
  const point = await page.evaluate(() => {
    cruciata.camera(2100, 2900);
    return cruciata.project(2600, 2900);
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
  const result = await page.evaluate(() => {
    const orders = cruciata
      .snapshot()
      .units.map((u) => ({ id: u.id, order: u.order }));
    cruciata.step(65);
    return { orders, units: cruciata.snapshot().units };
  });
  expect(result.units.length).toBeGreaterThan(90);
  expect(result.units.filter((u) => u.order).length).toBe(0);
  for (const u of result.units) {
    const goal = result.orders.find((v) => v.id === u.id).order;
    expect(Math.hypot(u.x - goal.x, u.y - goal.y)).toBeLessThan(14);
  }
});

test("recruits share a rally area without overlapping existing troops or each other", async ({
  page,
}) => {
  await begin(page);
  const initial = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      s.units = s.units.filter((u) => u.team === 0);
      const blocker = s.units.find((u) => u.type === "sword");
      blocker.x = 1800;
      blocker.y = 2600;
      blocker.hold = true;
      blocker.order = null;
      const b = s.buildings.find((b) => b.team === 0 && b.kind === "barracks");
      b.rally = { x: 1800, y: 2600 };
      b.queue = Array.from({ length: 8 }, () => ({
        type: "sword",
        time: 0,
        duration: 1,
      }));
    });
    return cruciata.snapshot().units.map((u) => u.id);
  });
  const result = await page.evaluate((initial) => {
    cruciata.step(1.1);
    cruciata.scenario((s) => {
      const incoming = s.units.find(
        (u) => !initial.includes(u.id) && u.team === 0,
      );
      const blocker = s.units.find(
        (u) => initial.includes(u.id) && u.type === "sword",
      );
      blocker.x = incoming.order.x;
      blocker.y = incoming.order.y;
    });
    cruciata.step(35);
    return cruciata.snapshot();
  }, initial);
  const recruits = result.units.filter(
    (u) => !initial.includes(u.id) && u.team === 0,
  );
  expect(recruits.length).toBe(8);
  expect(recruits.every((u) => !u.order)).toBe(true);
  for (const u of recruits) {
    expect(Math.hypot(u.x - 1800, u.y - 2600)).toBeLessThan(180);
    for (const v of result.units.filter((v) => v.team === 0 && v.id !== u.id))
      expect(Math.hypot(u.x - v.x, u.y - v.y)).toBeGreaterThan(25);
  }
});

test("all campaign enemies start together on the far side and forward outposts start neutral", async ({
  page,
}) => {
  await begin(page);
  for (let level = 0; level < 6; level++) {
    const s = await page.evaluate((level) => {
      cruciata.start(level);
      return cruciata.snapshot();
    }, level);
    for (const object of [...s.units, ...s.buildings].filter(
      (o) => o.team === 1,
    ))
      expect(object.x).toBeGreaterThan(s.world.width * 0.65);
    expect(s.enemy.discovered).toBeFalsy();
    for (const b of s.buildings.filter((b) => b.outpost))
      expect(b.team).toBe(2);
    expect(
      s.sites
        .filter((site) => site.outpost)
        .every((site) => site.team === 2 && !site.captured),
    ).toBe(true);
  }
});

test("neutral outposts grant no faction vision and can be secured by either army", async ({
  page,
}) => {
  await begin(page);
  const neutral = await page.evaluate(() => {
    const s = cruciata.snapshot(),
      b = s.buildings.find((b) => b.outpost);
    const player = new CruciataFog(s.world.width, s.world.height, null, 0),
      enemy = new CruciataFog(s.world.width, s.world.height, null, 1);
    player.update([], [b]);
    enemy.update([], [b]);
    return { player: player.sees(b), enemy: enemy.sees(b) };
  });
  expect(neutral).toEqual({ player: false, enemy: false });
  const captured = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      s.units = s.units
        .filter((u) => u.team === 0 && u.type === "sword")
        .slice(0, 3);
      const b = s.buildings.find((b) => b.outpost);
      s.units.forEach((u, i) => {
        u.x = b.x - 110;
        u.y = b.y + (i - 1) * 28;
        u.hold = true;
        u.hp = u.maxHp = 100000;
      });
    });
    cruciata.step(19);
    return cruciata.snapshot();
  });
  expect(captured.buildings.find((b) => b.outpost).team).toBe(0);
  expect(captured.sites.find((s) => s.outpost).captured).toBe(true);
  const enemy = await page.evaluate(() => {
    cruciata.scenario((s) =>
      s.units.forEach((u) => {
        u.team = 1;
        u.target = null;
        u.hold = true;
      }),
    );
    cruciata.step(19);
    return cruciata.snapshot();
  });
  expect(enemy.buildings.find((b) => b.outpost).team).toBe(1);
  expect(enemy.sites.find((s) => s.outpost).captured).toBe(false);
});

test("foundations may be placed in explored fog but grant no vision until complete", async ({
  page,
}) => {
  await begin(page);
  const location = { x: 1800, y: 2600 };
  await page.evaluate(
    (p) =>
      cruciata.scenario((s) => {
        s.nodes = [];
        s.decorations = [];
        s.terrainFeatures = [];
        s.enemy.think = 1e6;
        const u = s.units.find((u) => u.team === 0 && u.type === "worker");
        u.x = p.x;
        u.y = p.y;
      }),
    location,
  );
  expect(await page.evaluate((p) => cruciata.vision(p), location)).toEqual({
    visible: true,
    explored: true,
  });
  await page.evaluate(() =>
    cruciata.scenario((s) =>
      s.units
        .filter((u) => u.team === 0)
        .forEach((u, i) => {
          u.x = 500 + i * 25;
          u.y = 1700;
        }),
    ),
  );
  expect(await page.evaluate((p) => cruciata.vision(p), location)).toEqual({
    visible: false,
    explored: true,
  });
  expect(await page.evaluate((p) => cruciata.site("house", p), location)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => cruciata.site("house", { x: 4500, y: 2600 })),
  ).toBe(false);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-house").click();
  await page.evaluate((p) => cruciata.camera(p.x, p.y), location);
  await world(page, location.x, location.y);
  const state = await page.evaluate(() => {
    cruciata.step(0.1);
    return cruciata.snapshot();
  });
  const foundation = state.buildings.find(
    (b) =>
      b.kind === "house" && Math.hypot(b.x - location.x, b.y - location.y) < 1,
  );
  expect(foundation.progress).toBeLessThan(1);
  expect(await page.evaluate((p) => cruciata.vision(p), location)).toEqual({
    visible: false,
    explored: true,
  });
  const sources = await page.evaluate(() => {
    const fog = new CruciataFog(1000, 1000),
      p = {
        id: 1,
        team: 0,
        hp: 100,
        kind: "tower",
        x: 500,
        y: 500,
        progress: 0.9,
      };
    fog.update([], [p]);
    const incomplete = fog.sees(p);
    p.progress = 1;
    fog.update([], [p]);
    return { incomplete, complete: fog.sees(p) };
  });
  expect(sources).toEqual({ incomplete: false, complete: true });
});

test("archers and deployed trebuchets shoot over intact walls without moving through them", async ({
  page,
}) => {
  await begin(page);
  const ids = await page.evaluate(() => {
    let ids;
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      const a = s.units.find((u) => u.team === 0 && u.type === "archer"),
        e = s.units.find((u) => u.team === 1 && u.type === "sword");
      s.units = [a, e];
      a.x = 1400;
      a.y = 2600;
      a.hold = true;
      a.order = null;
      a.target = e.id;
      a.manualTarget = true;
      a.cooldown = 0;
      e.x = 1600;
      e.y = 2600;
      e.home = { x: 1600, y: 2600 };
      e.hp = e.maxHp = 10000;
      e.hold = true;
      e.order = null;
      e.target = null;
      const template = s.buildings.find((b) => b.kind === "house");
      for (let i = 0; i < 13; i++)
        s.buildings.push({
          ...template,
          id: 90000 + i,
          kind: "wall",
          team: 1,
          x: 1500,
          y: 2408 + i * 32,
          w: 32,
          h: 32,
          r: 16,
          hp: 1200,
          maxHp: 1200,
          queue: [],
        });
      ids = { a: a.id, e: e.id };
    });
    return ids;
  });
  const arrows = await page.evaluate(() => {
    cruciata.step(1.5);
    return cruciata.snapshot();
  });
  expect(arrows.units.find((u) => u.id === ids.e).hp).toBeLessThan(10000);
  expect(arrows.units.find((u) => u.id === ids.a).x).toBe(1400);
  expect(
    arrows.buildings.filter((b) => b.id >= 90000).every((b) => b.hp === 1200),
  ).toBe(true);
  const shells = await page.evaluate((ids) => {
    cruciata.scenario((s) => {
      const a = s.units.find((u) => u.id === ids.a),
        e = s.units.find((u) => u.id === ids.e);
      a.type = "trebuchet";
      a.deployment = "deployed";
      a.hold = false;
      a.cooldown = 0;
      a.target = null;
      a.fireTarget = { x: 1800, y: 2600 };
      e.x = 1800;
      e.home = { x: 1800, y: 2600 };
      e.hp = 10000;
      e.target = null;
    });
    cruciata.step(4);
    return cruciata.snapshot();
  }, ids);
  expect(shells.units.find((u) => u.id === ids.e).hp).toBeLessThan(10000);
  expect(shells.units.find((u) => u.id === ids.a).x).toBe(1400);
  expect(
    shells.buildings.filter((b) => b.id >= 90000).every((b) => b.hp === 1200),
  ).toBe(true);
});

test("villagers finish their local resource cluster then deliver and stop instead of crossing the map", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [
        {
          id: 91001,
          kind: "food",
          x: 1100,
          y: 2400,
          r: 24,
          remaining: 2,
          max: 2,
        },
        {
          id: 91002,
          kind: "food",
          x: 1160,
          y: 2400,
          r: 24,
          remaining: 2,
          max: 2,
        },
        {
          id: 91003,
          kind: "food",
          x: 4000,
          y: 2400,
          r: 24,
          remaining: 50,
          max: 50,
        },
      ];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [u];
      u.x = 4000;
      u.y = 2400;
      u.job = null;
      u.order = null;
      s.buildings[0].x = 900;
      s.buildings[0].y = 2400;
    });
    cruciata.scenario((s) => {
      const u = s.units[0];
      u.x = 1050;
      u.y = 2400;
      u.job = {
        kind: "gather",
        resource: "food",
        target: 91001,
        phase: "approach",
      };
    });
  });
  const s = await page.evaluate(() => {
    cruciata.step(60);
    return cruciata.snapshot();
  });
  expect(s.nodes.find((n) => n.id === 91001).remaining).toBe(0);
  expect(s.nodes.find((n) => n.id === 91002).remaining).toBe(0);
  expect(s.nodes.find((n) => n.id === 91003).remaining).toBe(50);
  expect(s.units[0].job).toBeNull();
  expect(s.units[0].carry).toBe(0);
  expect(s.units[0].x).toBeLessThan(1300);
  expect(s.stats.gathered.food).toBeCloseTo(4, 5);
});

test("farm workers sow exhausted fields and continue harvesting the new crop", async ({
  page,
}) => {
  await begin(page);
  const id = await page.evaluate(() => {
    let id;
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      const b = s.buildings.find((b) => b.team === 0 && b.kind === "house");
      b.kind = "farm";
      b.x = 1300;
      b.y = 2600;
      b.w = 106;
      b.h = 78;
      b.r = 53;
      b.remaining = 0;
      b.max = 2400;
      id = b.id;
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [u];
      u.x = 1300;
      u.y = 2600;
      u.order = null;
      u.job = {
        kind: "gather",
        resource: "food",
        target: b.id,
        phase: "approach",
      };
    });
    return id;
  });
  const sowing = await page.evaluate(() => {
    cruciata.step(2);
    return cruciata.snapshot();
  });
  expect(sowing.units[0].gatherSource).toBe("sowing");
  expect(sowing.buildings.find((b) => b.id === id).remaining).toBe(0);
  const harvest = await page.evaluate(() => {
    cruciata.step(12);
    return cruciata.snapshot();
  });
  expect(harvest.buildings.find((b) => b.id === id).remaining).toBeGreaterThan(
    2300,
  );
  expect(harvest.buildings.find((b) => b.id === id).remaining).toBeLessThan(
    2400,
  );
  expect(harvest.units[0].job.target).toBe(id);
  expect(harvest.units[0].carry).toBeGreaterThan(0);
});

for (const gap of [13, 18, 24])
  test(`physical navigation finds an offset ${gap}-pace passage with a turn`, async ({
    page,
  }) => {
    await begin(page);
    const result = await page.evaluate((gap) => {
      const obstacles = [
        { x: 180, y: 0, w: 120, h: 115 },
        { x: 180, y: 115 + gap, w: 120, h: 385 - gap },
      ];
      const free = (x, y) =>
        x >= 6 &&
        x <= 494 &&
        y >= 6 &&
        y <= 494 &&
        !obstacles.some(
          (b) =>
            x > b.x - 6 &&
            x < b.x + b.w + 6 &&
            y > b.y - 6 &&
            y < b.y + b.h + 6,
        );
      const points = obstacles.flatMap((b) =>
        [-6.25, b.w + 6.25].flatMap((dx) =>
          [-6.25, b.h + 6.25].map((dy) => ({ x: b.x + dx, y: b.y + dy })),
        ),
      );
      const nav = new CruciataNavigation(500, 500);
      nav.rebuild(free, points);
      const start = { x: 80, y: 80 },
        goal = { x: 420, y: 260 },
        route = nav.find(start, goal);
      let prior = start;
      const clear = route.every((p) => {
        const valid = nav.clearLine(prior, p);
        prior = p;
        return valid;
      });
      return { route, clear };
    }, gap);
    expect(result.route.length).toBeGreaterThan(1);
    expect(result.route.at(-1)).toEqual({ x: 420, y: 260 });
    expect(result.clear).toBe(true);
  });

test("physical navigation rejects a gap smaller than the unit collision diameter", async ({
  page,
}) => {
  await begin(page);
  const route = await page.evaluate(() => {
    const free = (x, y) =>
      x >= 6 &&
      x <= 494 &&
      y >= 6 &&
      y <= 494 &&
      !(x > 174 && x < 306 && (y < 121 || y > 119));
    const nav = new CruciataNavigation(500, 500);
    nav.rebuild(free, [
      { x: 173, y: 120 },
      { x: 307, y: 120 },
    ]);
    return nav.find({ x: 80, y: 80 }, { x: 420, y: 260 });
  });
  expect(route).toEqual([]);
});

test("a villager actually walks a thirteen-pace building gap instead of stopping at its entrance", async ({
  page,
}) => {
  await begin(page);
  const id = await page.evaluate(() => {
    let id;
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e6;
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [u];
      id = u.id;
      u.x = 1650;
      u.y = 2200;
      u.job = null;
      u.order = { x: 2050, y: 2650, attack: false };
      const template = s.buildings.find((b) => b.kind === "house");
      s.buildings.push(
        {
          ...template,
          id: 92001,
          x: 1800,
          y: 1200,
          w: 120,
          h: 2400,
          r: 1200,
          queue: [],
        },
        {
          ...template,
          id: 92002,
          x: 1800,
          y: (2413 + 8800) / 2,
          w: 120,
          h: 8800 - 2413,
          r: 2000,
          queue: [],
        },
      );
    });
    return id;
  });
  const u = await page.evaluate((id) => {
    cruciata.step(30);
    return cruciata.snapshot().units.find((u) => u.id === id);
  }, id);
  expect(u.order).toBeNull();
  expect(Math.hypot(u.x - 2050, u.y - 2650)).toBeLessThan(7);
});

test("campaign victory returns to the atlas, advances the army banner and survives reload", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.buildings.find((b) => b.id === s.capitals.enemy).hp = 0;
    });
    cruciata.step(0.1);
  });
  await expect(page.locator("#front-menu")).toBeVisible();
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  await expect(page.locator("#chapter-1")).toBeEnabled();
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "data-next-level",
    "1",
  );
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "data-transit",
    "complete",
    { timeout: 7000 },
  );
  const banner = await page.locator("#army-standard").getAttribute("transform");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cruciata-campaign-v1")),
  );
  expect(saved.completed).toContain(0);
  expect(saved.unlocked).toBe(1);
  await page.reload();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "transform",
    banner,
  );
  await expect(page.locator(".atlas-wave")).toHaveCount(5);
  await expect(page.locator(".atlas-relief")).toBeAttached();
  await page.locator("#chapter-1").click();
  await page.locator("#overlay button").click();
  await page.evaluate(() => cruciata.save());
  await page.reload();
  await page.locator("#resume-campaign").click();
  await page.locator("#overlay button").click();
  expect((await page.evaluate(() => cruciata.snapshot())).level).toBe(1);
});

test("regional golden grass bends around troops and the other biomes have reactive cover", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const cover = cruciata.snapshot().groundCover;
    const images = [];
    for (const type of ["golden", "reeds", "brush", "snow"]) {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 180;
      const g = canvas.getContext("2d");
      const patch = {
        x: 120,
        y: 100,
        rx: 100,
        ry: 70,
        type,
        stems: Array.from({ length: 80 }, (_, i) => ({
          x: 35 + (i % 12) * 15,
          y: 45 + Math.floor(i / 12) * 15,
          height: 18,
          phase: i * 0.3,
          shade: i % 3,
        })),
      };
      CruciataArt.groundCover(g, patch, [], 0);
      const idle = canvas.toDataURL();
      g.clearRect(0, 0, 240, 180);
      CruciataArt.groundCover(
        g,
        patch,
        [{ x: 120, y: 100, angle: 0, id: 1 }],
        0,
      );
      images.push(idle !== canvas.toDataURL());
    }
    return {
      regions: cover.length,
      golden: cover.every((p) => p.type === "golden" && p.stems.length > 30),
      images,
    };
  });
  expect(result.regions).toBeGreaterThan(20);
  expect(result.golden).toBe(true);
  expect(result.images.every(Boolean)).toBe(true);
});

test("production campaign records completion and automatically saves the newly begun chapter", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#open-campaign").click();
  await page.locator("#chapter-0").click();
  await page.locator("#overlay button").click();
  await page.evaluate(() => cruciata.cheat("victory"));
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  expect(
    await page.evaluate(() => {
      localStorage.setItem(
        "cruciata-checkpoint-v2",
        JSON.stringify({ version: 2, state: { level: 0 } }),
      );
      return cruciata.resume(null);
    }),
  ).toBe(false);
  await page.evaluate(() => localStorage.removeItem("cruciata-empire-v2"));
  await page.reload();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  await page.locator("#chapter-1").click();
  await page.locator("#overlay button").click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cruciata-checkpoint-v3")),
  );
  expect(saved.state.level).toBe(1);
  expect(saved.state.groundCover).toBeUndefined();
  await page.reload();
  await page.locator("#resume-campaign").click();
  await page.locator("#overlay button").click();
  expect((await page.evaluate(() => cruciata.snapshot())).level).toBe(1);
});

test("gate placement rotates its footprint, stays closed, and saves its orientation", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-gate").click();
  await expect(page.locator("#rotate-placement")).toBeVisible();
  await page.keyboard.press("r");
  await world(page, 1450, 2600);
  let gates = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.kind === "gate" && b.team === 0),
  );
  expect(gates).toHaveLength(1);
  expect(gates[0]).toMatchObject({
    rotation: 90,
    w: 42,
    h: 74,
    maxHp: 4200,
    closed: true,
  });
  await page.locator("#build-gate").click();
  await page.locator("#rotate-placement").click();
  await page.locator("#rotate-placement").click();
  await world(page, 1570, 2600);
  gates = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.kind === "gate" && b.team === 0),
  );
  expect(gates[1]).toMatchObject({ rotation: 0, w: 74, h: 42 });
  const id = gates[0].id;
  await page.evaluate((id) => {
    cruciata.scenario((s) => {
      const b = s.buildings.find((b) => b.id === id);
      b.progress = 1;
      b.hp = b.maxHp;
    });
  }, id);
  expect(await page.evaluate(() => cruciata.free({ x: 1450, y: 2630 }))).toBe(
    false,
  );
  await world(page, 1450, 2600);
  await page.evaluate(() => cruciata.gate());
  expect(await page.evaluate(() => cruciata.free({ x: 1450, y: 2630 }))).toBe(
    true,
  );
  await page.evaluate(() => cruciata.save());
  await page.reload();
  expect(await page.evaluate(() => cruciata.resume())).toBe(true);
  gates = await page.evaluate(() =>
    cruciata
      .snapshot()
      .buildings.filter((b) => b.kind === "gate" && b.team === 0),
  );
  expect(gates[0]).toMatchObject({ rotation: 90, w: 42, h: 74, closed: false });
});

test("reinforced walls survive ordinary attacks but take substantial siege damage", async ({
  page,
}) => {
  await begin(page);
  await clearTerrain(page);
  await page.locator("#settlement-tab").click();
  await page.locator("#build-wall").click();
  await world(page, 1500, 2600);
  const id = await page.evaluate(() => {
    let id;
    cruciata.scenario((s) => {
      const wall = s.buildings.find((b) => b.kind === "wall" && b.team === 0);
      id = wall.id;
      wall.team = 1;
      wall.progress = 1;
      wall.hp = wall.maxHp;
      const u = s.units.find((u) => u.type === "sword" && u.team === 0);
      s.units = [u];
      u.x = 1470;
      u.y = 2600;
      u.hold = true;
      u.target = id;
      u.manualTarget = true;
      u.cooldown = 0;
    });
    return id;
  });
  let result = await page.evaluate((id) => {
    cruciata.step(4);
    return cruciata.snapshot().buildings.find((b) => b.id === id);
  }, id);
  expect(result.maxHp).toBe(3200);
  const ordinary = 3200 - result.hp;
  expect(ordinary).toBeGreaterThan(0);
  expect(ordinary).toBeLessThan(20);
  await page.evaluate(
    (id) =>
      cruciata.scenario((s) => {
        const u = s.units[0];
        u.type = "trebuchet";
        u.x = 1100;
        u.y = 2600;
        u.target = null;
        u.hold = false;
        u.deployment = "deployed";
        u.cooldown = 0;
        u.fireTarget = { x: 1500, y: 2600 };
        const b = s.buildings.find((b) => b.id === id);
        b.hp = b.maxHp;
      }),
    id,
  );
  result = await page.evaluate((id) => {
    cruciata.step(4);
    return cruciata.snapshot().buildings.find((b) => b.id === id);
  }, id);
  expect(3200 - result.hp).toBeGreaterThan(ordinary * 15);
  expect(result.hp).toBeGreaterThan(0);
});

for (const levels of [
  [0, 1],
  [2, 3],
  [4, 5],
])
  test(`starting layouts have valid buildings and exterior troops in chapters ${levels.join(",")}`, async ({
    page,
  }) => {
    await page.goto("/?test");
    const errors = await page.evaluate((levels) => {
      const errors = [];
      document.getElementById("front-menu").hidden = true;
      for (const level of levels) {
        cruciata.start(level);
        const s = cruciata.snapshot();
        for (const [i, b] of s.buildings.entries()) {
          for (const other of s.buildings.slice(i + 1))
            if (
              Math.abs(b.x - other.x) < (b.w + other.w) / 2 - 0.01 &&
              Math.abs(b.y - other.y) < (b.h + other.h) / 2 - 0.01
            )
              errors.push(`chapter ${level}: ${b.kind} overlaps ${other.kind}`);
          for (const dx of [-b.w / 2, 0, b.w / 2])
            for (const dy of [-b.h / 2, 0, b.h / 2]) {
              const x = b.x + dx,
                y = b.y + dy;
              if (
                x < 24 ||
                y < 24 ||
                x > s.world.width - 24 ||
                y > s.world.height - 24
              )
                errors.push(`chapter ${level}: bounds`);
            }
        }
        for (const u of s.units.filter(
          (u) => u.team !== 2 && u.type !== "worker",
        )) {
          if (!cruciata.free(u))
            errors.push(`chapter ${level}: blocked troop ${u.id}`);
          if (
            s.buildings.some(
              (b) =>
                Math.abs(u.x - b.x) < b.w / 2 + 12 &&
                Math.abs(u.y - b.y) < b.h / 2 + 12,
            )
          )
            errors.push(`chapter ${level}: interior troop ${u.id}`);
          if (u.team === 1 && u.x < s.world.width * 0.6)
            errors.push(`chapter ${level}: forward enemy`);
        }
      }
      return errors;
    }, levels);
    expect(errors).toEqual([]);
  });

test("developed quickmatch settlements avoid overlapping buildings and muster outside", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-0").click();
  await page.locator("#preset-empire").click();
  await page.locator("#quick-form button[type=submit]").click();
  const result = await page.evaluate(() => {
    const s = cruciata.snapshot(),
      errors = [];
    for (const [i, b] of s.buildings.entries())
      for (const other of s.buildings.slice(i + 1))
        if (
          Math.abs(b.x - other.x) < (b.w + other.w) / 2 - 0.01 &&
          Math.abs(b.y - other.y) < (b.h + other.h) / 2 - 0.01
        )
          errors.push([b.id, other.id]);
    for (const u of s.units.filter((u) => u.type !== "worker" && u.team !== 2))
      if (
        !cruciata.free(u) ||
        s.buildings.some(
          (b) =>
            Math.abs(u.x - b.x) < b.w / 2 + 12 &&
            Math.abs(u.y - b.y) < b.h / 2 + 12,
        )
      )
        errors.push([u.id]);
    return errors;
  });
  expect(result).toEqual([]);
});

test("main menu covers the first frame even while game scripts are delayed", async ({
  page,
}) => {
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/game.js", async (route) => {
    await delayed;
    await route.continue();
  });
  await page.goto("/?test", { waitUntil: "commit" });
  try {
    await expect(page.locator("#front-menu")).toBeVisible();
    await expect(page.locator("#front-menu h1")).toHaveText(
      "The road to Jerusalem",
    );
    expect(
      await page.evaluate(
        () =>
          document
            .elementFromPoint(innerWidth / 2, innerHeight / 2)
            .closest("#front-menu") !== null,
      ),
    ).toBe(true);
    await expect(page.locator("#open-campaign")).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator("#open-campaign")).toBeEnabled();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#chapter-0")).toBeVisible();
});

test("rock clusters expose a joined stone rim with a continuous black center", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const f = cruciata
        .snapshot()
        .terrainFeatures.find((f) => f.kind === "rockmass"),
      tiles = new Set(f.tiles.map((t) => t.x + "," + t.y));
    const tile =
      f.tiles.find((t) =>
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].every(([dx, dy]) => tiles.has(t.x + dx + "," + (t.y + dy))),
      ) || f.tiles[0];
    const p = { x: (tile.x + 0.5) * f.cell, y: (tile.y + 0.5) * f.cell },
      c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d");
    g.translate(200 - p.x, 200 - p.y);
    CruciataArt.rockMass(g, f);
    const pixel = Array.from(g.getImageData(200, 200, 1, 1).data);
    return {
      pixel,
      contours: f.contours.length,
      tiles: f.tiles.length,
      blocked: !cruciata.free(p),
    };
  });
  expect(result.pixel[0]).toBeLessThan(20);
  expect(result.pixel[1]).toBeLessThan(20);
  expect(result.pixel[2]).toBeLessThan(20);
  expect(result.pixel[3]).toBe(255);
  expect(result.tiles).toBeGreaterThan(20);
  expect(result.blocked).toBe(true);
});

for (const level of [0, 1])
  test(`natural terrain and roads stay out of water in chapter ${level}`, async ({
    page,
  }) => {
    await begin(page);
    const result = await page.evaluate((level) => {
      cruciata.start(level);
      const s = cruciata.snapshot(),
        errors = [];
      for (const n of s.nodes)
        if (!cruciata.land(n, n.kind === "wood" ? 52 : 35))
          errors.push("resource " + n.id);
      for (const mass of s.terrainFeatures)
        for (const t of mass.tiles)
          for (const dx of [0, mass.cell])
            for (const dy of [0, mass.cell])
              if (
                !cruciata.land(
                  { x: t.x * mass.cell + dx, y: t.y * mass.cell + dy },
                  12,
                )
              )
                errors.push("rock edge");
      for (const road of s.roads)
        for (let i = 1; i < road.length; i++) {
          const a = road[i - 1],
            b = road[i],
            steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
          for (let j = 0; j <= steps; j++)
            if (
              !cruciata.land(
                {
                  x: a.x + ((b.x - a.x) * j) / steps,
                  y: a.y + ((b.y - a.y) * j) / steps,
                },
                20,
                true,
              )
            )
              errors.push("road");
        }
      return errors;
    }, level);
    expect(result).toEqual([]);
  });

test("fortified cities defend locally and transfer their surviving garrison and buildings on capture", async ({
  page,
}) => {
  await begin(page);
  const before = await page.evaluate(() => {
    let result;
    cruciata.scenario((s) => {
      const city = s.cities[0];
      s.enemy.think = 1e6;
      const guards = s.units.filter((u) => u.city === city.id),
        troops = s.units
          .filter((u) => u.team === 0 && u.type === "sword")
          .slice(0, 3);
      s.units = [...guards, ...troops];
      for (const [i, u] of troops.entries()) {
        u.x = city.x + 70;
        u.y = city.y + (i - 1) * 24;
        u.hp = u.maxHp = 10000;
        u.hold = true;
        u.target = null;
        u.order = null;
      }
      for (const [i, u] of guards.entries()) {
        const a = (i * Math.PI * 2) / guards.length;
        u.x = city.x + Math.cos(a) * 220;
        u.y = city.y + Math.sin(a) * 220;
        u.home = { x: u.x, y: u.y };
        u.hold = true;
        u.target = null;
      }
      result = {
        city: city.id,
        guardIds: guards.map((u) => u.id),
        buildingIds: s.buildings
          .filter((b) => b.city === city.id)
          .map((b) => b.id),
      };
    });
    return result;
  });
  const after = await page.evaluate(() => {
    cruciata.step(13);
    return cruciata.snapshot();
  });
  expect(after.cities.find((c) => c.id === before.city).captured).toBe(true);
  expect(
    after.units.filter((u) => u.city === before.city && u.type === "worker"),
  ).toHaveLength(6);
  expect(
    before.guardIds.every(
      (id) => after.units.find((u) => u.id === id).team === 0,
    ),
  ).toBe(true);
  expect(
    before.buildingIds.every(
      (id) => after.buildings.find((b) => b.id === id).team === 0,
    ),
  ).toBe(true);
  expect(
    after.units
      .filter((u) => before.guardIds.includes(u.id))
      .every((u) => !u.cityDefender),
  ).toBe(true);
  expect(
    after.buildings
      .filter((b) => b.city === before.city && b.kind === "gate")
      .every((b) => !b.closed),
  ).toBe(true);
});

test("enemy builds paid connected defenses with real builders and gates react to discovered threats", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.time = 60;
      s.enemy.think = 0;
      s.enemy.resources = {
        food: 10000,
        wood: 10000,
        gold: 10000,
        stone: 10000,
      };
      const base = s.buildings.find((b) => b.id === s.capitals.enemy);
      const template = s.buildings.find(
        (b) => b.kind === "house" && b.team === 1,
      );
      for (const [i, kind] of [
        "lumbercamp",
        "miningcamp",
        "mill",
        "farm",
        "stable",
        "chapel",
        "siegeworkshop",
      ].entries())
        s.buildings.push({
          ...template,
          id: 99000 + i,
          kind,
          x: base.x + 80 + (i % 3) * 90,
          y: base.y - 180 - Math.floor(i / 3) * 100,
          remaining: 2400,
          max: 2400,
        });
      for (const u of s.units.filter(
        (u) => u.team === 1 && u.type === "worker",
      )) {
        u.job = null;
        u.order = null;
      }
    }),
  );
  const result = await page.evaluate(() => {
    cruciata.step(0.1);
    return cruciata.snapshot();
  });
  expect(
    result.enemy.fortification.plots.filter((p) => p.kind === "wall").length,
  ).toBeGreaterThan(30);
  const defence = result.buildings.filter((b) => b.defence);
  expect(defence.length).toBeGreaterThan(0);
  expect(defence.every((b) => b.progress < 1)).toBe(true);
  expect(
    result.units.some(
      (u) =>
        u.team === 1 &&
        u.job?.kind === "build" &&
        defence.some((b) => b.id === u.job.target),
    ),
  ).toBe(true);
  expect(result.enemy.paid.stone).toBeGreaterThan(0);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const gate = s.buildings.find((b) => b.defence && b.kind === "gate");
      gate.progress = 1;
      gate.hp = gate.maxHp;
      const u = s.units.find((u) => u.team === 0 && u.type === "sword");
      u.x = gate.x - 100;
      u.y = gate.y;
      u.hp = 10000;
      u.hold = true;
    }),
  );
  const closed = await page.evaluate(() => {
    cruciata.step(0.6);
    return cruciata
      .snapshot()
      .buildings.find((b) => b.defence && b.kind === "gate").closed;
  });
  expect(closed).toBe(true);
});

test("saved rock-cluster footprints survive resume and restored roads remain passable", async ({
  page,
}) => {
  await begin(page);
  const before = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.paused = true;
    });
    const s = cruciata.snapshot();
    cruciata.save();
    return s.terrainFeatures;
  });
  const after = await page.evaluate(() => {
    cruciata.resume();
    const s = cruciata.snapshot();
    return {
      features: s.terrainFeatures,
      clear: s.roads.every((road) => road.every((p) => cruciata.free(p))),
    };
  });
  expect(after.features).toEqual(before);
  expect(after.clear).toBe(true);
});
