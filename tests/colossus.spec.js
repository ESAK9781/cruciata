const { test, expect } = require("./helpers");

async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
    });
  }, level);
  await page.setViewportSize({ width: 1440, height: 900 });
}

// A finished player Colossus with `crew` villagers already at its winches.
async function colossus(page, crew, extra = {}) {
  await page.evaluate(
    ({ crew, extra }) => {
      cruciata.scenario((s) => {
        const template = JSON.parse(JSON.stringify(s.buildings[0])),
          worker = JSON.parse(
            JSON.stringify(
              s.units.find((u) => u.team === 0 && u.type === "worker"),
            ),
          );
        if (crew)
          s.units = s.units.filter((u) => u.team !== 0 || u.type !== "worker");
        s.buildings.push({
          ...template,
          id: 99500,
          kind: "colossus",
          team: 0,
          x: 1500,
          y: 2600,
          w: 320,
          h: 276,
          r: 160,
          hp: 16000,
          maxHp: 16000,
          progress: 1,
          guardCooldown: 0,
          queue: [],
          rally: null,
          ...extra,
        });
        for (let i = 0; i < crew; i++)
          s.units.push({
            ...worker,
            id: 99600 + i,
            x: 1500 + Math.cos(i * 1.3) * 190,
            y: 2600 + Math.sin(i * 1.3) * 160,
            job: { kind: "crew", target: 99500 },
            order: null,
            buildQueue: [],
            fleeUntil: 0,
          });
      });
    },
    { crew, extra },
  );
}

// Runs the simulation and returns the time of every Colossus shot.
async function shots(page, seconds) {
  return page.evaluate((seconds) => {
    const S = cruciata.internals().state,
      out = [];
    let seen = 0;
    for (let i = 0; i < seconds * 30; i++) {
      cruciata.step(1 / 30);
      const mine = S.boulders.filter((b) => b.source === 99500);
      for (const b of mine)
        if (!b.counted) {
          b.counted = true;
          out.push({
            t: S.time,
            tx: b.tx,
            ty: b.ty,
            damage: b.damage,
            r: b.r,
            heavy: b.heavy,
            duration: b.duration,
          });
        }
      seen = out.length;
    }
    return out;
  }, seconds);
}

test("the build menu states the colossus cost, crew need, warning and range rules", async ({
  page,
}) => {
  await begin(page);
  const card = page.locator("#build-colossus");
  await page.locator("#settlement-tab").click();
  await expect(card).toBeVisible();
  await expect(card).toContainText("One per side");
  await expect(card).toContainText("6000 wood");
  const title = await card.getAttribute("title");
  expect(title).toContain("5 villagers");
  expect(title).toContain("Unlimited range");
  expect(title).toContain("told");
});

test("only one colossus per side, even while it is a foundation", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.supply({ wood: 9000, stone: 9000, gold: 9000 });
    cruciata.scenario((s) => {
      const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [{ ...worker, x: 1250, y: 2600, job: null, order: null }];
    });
    cruciata.camera(1500, 2600);
  });
  await page.locator("#settlement-tab").click();
  const worker = await page.evaluate(() => cruciata.project(1250, 2600));
  await page.mouse.click(worker.x, worker.y);
  await page.locator("#build-colossus").click();
  const spot = await page.evaluate(() => cruciata.project(1600, 2600));
  await page.mouse.click(spot.x, spot.y);
  const after = await page.evaluate(() => {
    const S = cruciata.internals().state;
    return {
      colossi: S.buildings.filter((b) => b.kind === "colossus").length,
      wood: S.resources.wood,
      site: cruciata.site("colossus", { x: 2600, y: 3200 }),
    };
  });
  expect(after.colossi).toBe(1);
  expect(after.wood).toBeLessThan(9000 - 5000);
  expect(after.site).toBe(false);
  await expect(page.locator("#build-colossus")).toBeDisabled();
});

test("without five villagers working it the colossus neither reloads nor fires", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 4, { fireTarget: { x: 4000, y: 2600 } });
  expect(await shots(page, 25)).toHaveLength(0);
  const crew = await page.evaluate(
    () => cruciata.internals().state.buildings.find((b) => b.id === 99500).crew,
  );
  expect(crew).toBeLessThan(5);
});

test("a full crew fires only at the ordered point, with the great engine's reload, damage and flight", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5, { fireTarget: { x: 4000, y: 2600 } });
  const fired = await shots(page, 45);
  expect(fired.length).toBeGreaterThanOrEqual(2);
  for (const s of fired) {
    expect(s.damage).toBe(650);
    expect(s.r).toBe(230);
    expect(s.heavy).toBe(true);
    // Same flight model as the great engine.
    expect(s.duration).toBeGreaterThan(3.6 + 2400 / 1500 - 0.5);
  }
  expect(fired[1].t - fired[0].t).toBeGreaterThan(17.8);
  expect(fired[1].t - fired[0].t).toBeLessThan(18.5);
  const crew = await page.evaluate(
    () => cruciata.internals().state.buildings.find((b) => b.id === 99500).crew,
  );
  expect(crew).toBe(5);
});

test("it never fires without orders, even with enemies in plain view", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 99501,
        kind: "house",
        team: 1,
        x: 2300,
        y: 2600,
        w: 50,
        h: 50,
        hp: 4000,
        maxHp: 4000,
        progress: 1,
        queue: [],
      });
    });
  });
  expect(await shots(page, 40)).toHaveLength(0);
});

test("range is unlimited but accuracy falls with distance", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5);
  const run = async (target) => {
    await page.evaluate((target) => {
      const b = cruciata
        .internals()
        .state.buildings.find((x) => x.id === 99500);
      b.fireTarget = target;
      b.guardCooldown = 0;
    }, target);
    return shots(page, 6);
  };
  const near = await run({ x: 2300, y: 2600 });
  const far = await run({ x: 7000, y: 7000 });
  expect(near.length).toBeGreaterThan(0);
  expect(far.length).toBeGreaterThan(0);
  const miss = (s, t) => Math.hypot(s.tx - t.x, s.ty - t.y);
  const dNear = Math.hypot(800, 0),
    dFar = Math.hypot(5500, 4400);
  const rNear = 40 + dNear * 0.09,
    rFar = 40 + dFar * 0.09;
  expect(miss(near[0], { x: 2300, y: 2600 })).toBeLessThanOrEqual(rNear + 1);
  expect(miss(far[0], { x: 7000, y: 7000 })).toBeLessThanOrEqual(rFar + 1);
  expect(rFar).toBeGreaterThan(rNear * 3);
  expect(far[0].duration).toBeGreaterThan(near[0].duration + 2);
});

test("shots really scatter: repeated volleys land in different places inside the disc", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5, { fireTarget: { x: 5000, y: 5000 } });
  const landed = await page.evaluate(() => {
    const b = cruciata.internals().state.buildings.find((x) => x.id === 99500);
    const out = [];
    for (let i = 0; i < 20; i++) {
      b.guardCooldown = 0;
      for (let k = 0; k < 40 && b.guardCooldown === 0; k++)
        cruciata.step(1 / 30);
      const s = cruciata.internals().state.boulders.at(-1);
      if (s) out.push([s.tx, s.ty]);
      cruciata.internals().state.boulders.length = 0;
    }
    return out;
  });
  expect(new Set(landed.map((p) => p.join(","))).size).toBeGreaterThan(10);
});

test("selecting the colossus explains the crew rule, and Man engine sends five villagers", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 0);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const worker = s.units.find((u) => u.team === 0 && u.type === "worker");
      for (let i = 0; i < 7; i++)
        s.units.push({
          ...JSON.parse(JSON.stringify(worker)),
          id: 99700 + i,
          x: 1000 + i * 30,
          y: 2900,
          job: null,
          order: null,
        });
    });
    cruciata.camera(1500, 2500);
  });
  await page.waitForTimeout(150);
  const p = await page.evaluate(() => cruciata.project(1500, 2500));
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#selection-title")).toContainText("Colossal");
  const role = page.locator("#selection-role");
  await expect(role).toContainText("5 villagers");
  const help = await role.getAttribute("title");
  expect(help).toContain("never fires on its own");
  expect(help).toContain("scatter");
  expect(help).toContain("Unlimited range");
  await expect(page.locator("#crew-button")).toBeVisible();
  await expect(page.locator("#release-crew-button")).toBeVisible();
  await page.locator("#crew-button").click();
  await page.evaluate(() => cruciata.step(25));
  await expect(role).toContainText("Crew 5/5");
  const working = await page.evaluate(
    () =>
      cruciata
        .internals()
        .state.units.filter(
          (u) => u.job?.kind === "crew" && u.working && u.team === 0,
        ).length,
  );
  expect(working).toBe(5);
  await page.locator("#release-crew-button").click();
  const left = await page.evaluate(
    () =>
      cruciata.internals().state.units.filter((u) => u.job?.kind === "crew")
        .length,
  );
  expect(left).toBe(0);
});

test("right-clicking a ground point with the colossus selected orders a bombardment anywhere", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5);
  await page.evaluate(() => cruciata.camera(1500, 2500));
  await page.waitForTimeout(150);
  const p = await page.evaluate(() => cruciata.project(1500, 2500));
  await page.mouse.click(p.x, p.y);
  const target = await page.evaluate(() => cruciata.project(1900, 2650));
  await page.mouse.click(target.x, target.y, { button: "right" });
  const order = await page.evaluate(
    () =>
      cruciata.internals().state.buildings.find((b) => b.id === 99500)
        .fireTarget,
  );
  expect(order).toBeTruthy();
  expect(Math.abs(order.x - 1900)).toBeLessThan(40);
  await expect(page.locator("#cancel-targeting-button")).toBeEnabled();
  await page.locator("#cancel-targeting-button").click();
  const cleared = await page.evaluate(
    () =>
      cruciata.internals().state.buildings.find((b) => b.id === 99500)
        .fireTarget,
  );
  expect(cleared).toBeNull();
});

test("the other side is warned and shown the site the moment a colossus is begun", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.cheats = { reveal: false };
    });
  });
  const before = await page.evaluate(() =>
    cruciata.vision({ x: 6200, y: 6200 }),
  );
  expect(before.visible).toBe(false);
  await expect(page.locator("#colossus-banner")).toBeHidden();
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 99800,
        kind: "colossus",
        team: 1,
        x: 6200,
        y: 6200,
        w: 320,
        h: 276,
        r: 160,
        hp: 3000,
        maxHp: 16000,
        progress: 0.2,
        queue: [],
      });
    });
    cruciata.step(0.5);
  });
  const after = await page.evaluate(() =>
    cruciata.vision({ x: 6200, y: 6200 }),
  );
  expect(after.visible).toBe(true);
  await page.evaluate(() => cruciata.liveFrame(2));
  await expect(page.locator("#colossus-banner")).toBeVisible();
  await expect(page.locator("#colossus-banner")).toContainText("20%");
  await page.locator("#colossus-banner").click();
  const cam = await page.evaluate(() => cruciata.snapshot().camera);
  expect(Math.hypot(cam.x - 6200, cam.y - 6200)).toBeLessThan(400);
});

test("the enemy announces its own colossus when it begins one, and builds, mans and fires it", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.cheats = { reveal: false };
      const base = s.buildings.find(
        (b) => b.kind === "towncenter" && b.team === 1,
      );
      const worker = s.units.find((u) => u.team === 1 && u.type === "worker");
      for (let i = 0; i < 14; i++)
        s.units.push({
          ...JSON.parse(JSON.stringify(worker)),
          id: 99900 + i,
          x: base.x + 120 + (i % 5) * 28,
          y: base.y + 150 + Math.floor(i / 5) * 28,
          job: null,
          order: null,
          buildQueue: [],
          fleeUntil: 0,
        });
      s.enemy.resources = {
        food: 9000,
        wood: 9000,
        stone: 9000,
        gold: 9000,
      };
      s.time = 900;
      s.enemy.think = 0;
    });
    cruciata.step(3);
  });
  const begun = await page.evaluate(() => {
    const S = cruciata.internals().state;
    return S.buildings.filter((b) => b.kind === "colossus" && b.team === 1);
  });
  expect(begun).toHaveLength(1);
  await expect(page.locator("#toast")).toContainText("enemy has begun");
  await page.evaluate(() => cruciata.liveFrame(2));
  await expect(page.locator("#colossus-banner")).toBeVisible();
  // Villagers finish it and five of them man it.
  const done = await page.evaluate(() => {
    const S = cruciata.internals().state;
    for (
      let i = 0;
      i < 40 &&
      !S.buildings.find(
        (b) => b.kind === "colossus" && b.team === 1 && b.progress >= 1,
      );
      i++
    ) {
      S.enemy.think = Math.min(S.enemy.think, 1);
      cruciata.step(10);
    }
    cruciata.step(40);
    const b = S.buildings.find((b) => b.kind === "colossus" && b.team === 1);
    return {
      progress: b.progress,
      crew: S.units.filter(
        (u) => u.team === 1 && u.job?.kind === "crew" && u.job.target === b.id,
      ).length,
      count: S.buildings.filter((x) => x.kind === "colossus" && x.team === 1)
        .length,
    };
  });
  expect(done.progress).toBe(1);
  expect(done.crew).toBe(5);
  expect(done.count).toBe(1);
});

test("a colossus shot flies, lands and damages exactly like a great engine blast", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5, { fireTarget: { x: 2300, y: 2600 } });
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 99501,
        kind: "house",
        team: 1,
        x: 2300,
        y: 2600,
        w: 200,
        h: 200,
        r: 100,
        hp: 9000,
        maxHp: 9000,
        progress: 1,
        queue: [],
      });
    });
  });
  const hp = await page.evaluate(() => {
    for (let i = 0; i < 20; i++) cruciata.step(2);
    return cruciata.internals().state.buildings.find((b) => b.id === 99501).hp;
  });
  expect(hp).toBeLessThan(9000);
});

test("the colossus is drawn at full size, finished and as a foundation", async ({
  page,
}) => {
  await begin(page);
  await colossus(page, 5);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const template = JSON.parse(JSON.stringify(s.buildings[0]));
      s.buildings.push({
        ...template,
        id: 99502,
        kind: "colossus",
        team: 1,
        x: 2300,
        y: 3400,
        w: 320,
        h: 276,
        r: 160,
        hp: 5000,
        maxHp: 16000,
        progress: 0.5,
        queue: [],
      });
    });
    cruciata.camera(1900, 3000);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForTimeout(400);
  await page.evaluate(() => cruciata.liveFrame(5));
  expect(errors).toEqual([]);
  const shot = await page.screenshot();
  expect(shot.length).toBeGreaterThan(5000);
});
