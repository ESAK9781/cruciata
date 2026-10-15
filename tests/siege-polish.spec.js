const { test, expect } = require("./helpers");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(async () => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}

test("gates close against nearby discovered threats, reopen safely, and preserve manual closure", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let id, enemy;
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.enemy.think = 1e6;
      s.cities = [];
      s.sites = [];
      const gate = {
        ...s.buildings.find((b) => b.kind === "gate"),
        id: 99991,
        team: 0,
        x: 1700,
        y: 2600,
        closed: false,
        progress: 1,
        hp: 4200,
        queue: [],
      };
      id = gate.id;
      s.buildings.push(gate);
      enemy = s.units.find((u) => u.team === 1 && u.type === "sword");
      enemy.x = 1800;
      enemy.y = 2600;
      enemy.hold = true;
      enemy.home = { x: enemy.x, y: enemy.y };
      const observer = s.units.find((u) => u.team === 0 && u.type === "sword");
      observer.x = 1660;
      observer.y = 2600;
      observer.hold = true;
    });
    cruciata.step(0.3);
    const closed = cruciata
      .snapshot()
      .buildings.find((b) => b.id === id).closed;
    cruciata.scenario((s) => {
      s.units.find((u) => u.id === enemy.id).x = 3000;
    });
    cruciata.step(0.3);
    const reopened = !cruciata.snapshot().buildings.find((b) => b.id === id)
      .closed;
    cruciata.scenario((s) => {
      const g = s.buildings.find((b) => b.id === id);
      g.closed = true;
      g.autoClosed = false;
    });
    cruciata.step(0.3);
    return {
      closed,
      reopened,
      manual: cruciata.snapshot().buildings.find((b) => b.id === id).closed,
    };
  });
  expect(result).toEqual({ closed: true, reopened: true, manual: true });
});

test("construction categories include a cheap unarmed long-range lookout and tripled deposits", async ({
  page,
}) => {
  await begin(page);
  await expect(page.locator(".build-category h3")).toHaveText([
    "Settlement",
    "Economy",
    "Military",
    "Fortification",
  ]);
  await expect(page.locator("#build-watchtower")).toHaveAttribute(
    "title",
    /35 wood.*1100/,
  );
  const result = await page.evaluate(() => {
    const s = cruciata.snapshot();
    const reserves = s.nodes.every(
      (n) =>
        n.max === (n.kind === "wood" ? 660 : n.kind === "food" ? 1500 : 3900) &&
        n.remaining === n.max,
    );
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.units = s.units.filter((u) => u.team === 0);
      s.enemy.think = 1e6;
      const tower = {
        ...s.buildings.find((b) => b.kind === "tower"),
        id: 99990,
        kind: "watchtower",
        team: 0,
        x: 4500,
        y: 2600,
        progress: 1,
        hp: 320,
        queue: [],
      };
      s.buildings.push(tower);
    });
    return { reserves, visible: cruciata.vision({ x: 5500, y: 2600 }).visible };
  });
  expect(result).toEqual({ reserves: true, visible: true });
});

test("villagers finish ordinary movement at separate formation slots", async ({
  page,
}) => {
  await begin(page);
  const points = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.sites = [];
      s.cities = [];
      s.enemy.think = 1e6;
      s.units = s.units.filter((u) => u.team === 0 && u.type === "worker");
      s.units.forEach((u, i) => {
        u.x = 1600 + i * 28;
        u.y = 2600;
        u.job = null;
        u.order = null;
      });
    });
    cruciata.camera(1800, 2600);
    return {
      a: cruciata.project(1560, 2550),
      b: cruciata.project(1790, 2660),
      target: cruciata.project(2080, 2600),
    };
  });
  await page.mouse.move(points.a.x, points.a.y);
  await page.mouse.down();
  await page.mouse.move(points.b.x, points.b.y, { steps: 3 });
  await page.mouse.up();
  await page.mouse.click(points.target.x, points.target.y, { button: "right" });
  const result = await page.evaluate(() => {
    const initial = cruciata
      .snapshot()
      .units.map((u) => ({ id: u.id, order: u.order }));
    cruciata.step(12);
    const units = cruciata.snapshot().units;
    return {
      count: initial.length,
      formed: initial.every((u) => u.order?.formation),
      arrived: initial.every((u) => {
        const v = units.find((v) => v.id === u.id);
        return Math.hypot(v.x - u.order.x, v.y - u.order.y) < 8;
      }),
      separate: units.every((u, i) =>
        units.every((v, j) => i === j || Math.hypot(u.x - v.x, u.y - v.y) > 20),
      ),
    };
  });
  expect(result).toEqual({
    count: 6,
    formed: true,
    arrived: true,
    separate: true,
  });
});

test("campaign victory visibly moves its standard and extends a red trail using shared coastal surf", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario(
      (s) => (s.buildings.find((b) => b.id === s.capitals.enemy).hp = 0),
    );
    cruciata.step(0.1);
  });
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "data-transit",
    "moving",
  );
  const before = await page.locator("#army-standard").getAttribute("transform");
  await expect
    .poll(() => page.locator("#army-standard").getAttribute("transform"))
    .not.toBe(before);
  await expect(page.locator(".atlas-lapping")).toHaveCount(5);
  await expect(page.locator("#completed-route")).toHaveAttribute(
    "stroke",
    "#b92f27",
  );
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "data-transit",
    "complete",
    { timeout: 7000 },
  );
  const final = await page.locator("#army-standard").getAttribute("transform");
  await page.reload();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "transform",
    final,
  );
  await expect(page.locator("#chapter-0")).toContainText("Completed");
});

test("opening the local HTML does not produce canvas security errors or forbidden geography fetches", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(
    pathToFileURL(path.resolve(__dirname, "../index.html")).href + "?test",
  );
  await expect(page.locator("#open-campaign")).toBeEnabled();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#army-standard")).toBeVisible();
  await page.locator("#chapter-0").click();
  await page.locator("#overlay button").click();
  expect(
    await page.evaluate(() => ({
      ready: true,
      time: cruciata.snapshot().time,
    })),
  ).toMatchObject({ ready: true });
  expect(errors).toEqual([]);
});

test("regional navigation updates preserve exact collision cells and connectivity", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const Nav = CruciataNavigation,
      n = new Nav(1024, 512, 16),
      reference = new Nav(1024, 512, 16);
    let obstacles = [
      { x: 320, y: 0, w: 40, h: 400 },
      { x: 700, y: 120, w: 120, h: 90 },
    ];
    const free = (x, y) =>
      !obstacles.some(
        (o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h,
      );
    n.rebuild(free);
    const old = obstacles[0];
    obstacles = [{ x: 320, y: 0, w: 40, h: 160 }, obstacles[1]];
    n.rebuild(free, [], [old]);
    reference.rebuild(free);
    const equal =
      n.blocked.every((v, i) => v === reference.blocked[i]) &&
      n.components.every((v, i) => v === reference.components[i]);
    const revision = n.revision;
    n.rebuild(free, [], []);
    return {
      equal,
      unchanged: n.revision === revision,
      route: n.find({ x: 100, y: 240 }, { x: 900, y: 240 }).length > 0,
    };
  });
  expect(result).toEqual({ equal: true, unchanged: true, route: true });
});

test("capturing a neutral outpost converts its residents into playable villagers", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let siteId, ids;
    cruciata.scenario((s) => {
      const site = s.sites.find((site) => site.outpost);
      siteId = site.id;
      const residents = s.units.filter((u) => u.site === siteId),
        troops = s.units
          .filter((u) => u.team === 0 && u.type === "sword")
          .slice(0, 3);
      ids = residents.map((u) => u.id);
      s.units = [...residents, ...troops];
      s.enemy.think = 1e6;
      // Forward-post towers and regional armies would otherwise contest the outpost.
      s.campaignRules = null;
      s.regionalThink = 1e9;
      s.cities = [];
      s.buildings = s.buildings.filter(
        (b) => b.team !== 1 || b.kind === "towncenter",
      );
      troops.forEach((u, i) => {
        u.x = site.x + 70;
        u.y = site.y + (i - 1) * 24;
        u.hold = true;
      });
    });
    cruciata.step(19);
    const s = cruciata.snapshot();
    return {
      count: ids.length,
      captured: s.sites.find((site) => site.id === siteId).captured,
      workers: ids.every((id) => {
        const u = s.units.find((u) => u.id === id);
        return u.team === 0 && u.type === "worker" && !u.home;
      }),
    };
  });
  expect(result).toEqual({ count: 4, captured: true, workers: true });
});

test("extended rock barriers have no enclosed empty tile pockets and local changes avoid whole-map sampling", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const s = cruciata.snapshot();
    let holes = 0;
    for (const d of s.terrainFeatures) {
      const tiles = new Set(d.tiles.map((t) => t.x + "," + t.y)),
        x0 = Math.min(...d.tiles.map((t) => t.x)) - 1,
        x1 = Math.max(...d.tiles.map((t) => t.x)) + 1,
        y0 = Math.min(...d.tiles.map((t) => t.y)) - 1,
        y1 = Math.max(...d.tiles.map((t) => t.y)) + 1,
        seen = new Set([x0 + "," + y0]),
        queue = [{ x: x0, y: y0 }];
      for (let i = 0; i < queue.length; i++)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = queue[i].x + dx,
            y = queue[i].y + dy,
            key = x + "," + y;
          if (
            x < x0 ||
            x > x1 ||
            y < y0 ||
            y > y1 ||
            seen.has(key) ||
            tiles.has(key)
          )
            continue;
          seen.add(key);
          queue.push({ x, y });
        }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (!tiles.has(x + "," + y) && !seen.has(x + "," + y)) holes++;
    }
    const original = CruciataNavigation.prototype.rebuild;
    let calls = 0;
    CruciataNavigation.prototype.rebuild = function (fn, ...args) {
      return original.call(
        this,
        (x, y) => {
          calls++;
          return fn(x, y);
        },
        ...args,
      );
    };
    cruciata.scenario(
      (s) => (s.nodes.find((n) => n.kind === "wood").remaining = 0),
    );
    return {
      holes,
      span: Math.max(...s.terrainFeatures.map((d) => Math.max(d.rx, d.ry) * 2)),
      calls,
    };
  });
  expect(result.holes).toBe(0);
  expect(result.span).toBeGreaterThan(1500);
  expect(result.calls).toBeLessThan(30000);
});

test("resuming an older rock ring seals an inaccessible empty interior without changing its outer footprint", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const cell = 64,
        tiles = [];
      for (let y = 90; y < 93; y++)
        for (let x = 140; x < 143; x++)
          if (x !== 141 || y !== 91) tiles.push({ x, y });
      const mass = {
        kind: "rockmass",
        x: 9056,
        y: 5856,
        rx: 120,
        ry: 120,
        r: 0,
        block: true,
        cell,
        tiles,
        biome: 0,
        seed: 4,
        contours: [
          [
            { x: 8960, y: 5760 },
            { x: 9152, y: 5760 },
            { x: 9152, y: 5952 },
            { x: 8960, y: 5952 },
          ],
          [
            { x: 9024, y: 5824 },
            { x: 9024, y: 5888 },
            { x: 9088, y: 5888 },
            { x: 9088, y: 5824 },
          ],
        ],
      };
      s.terrainFeatures = [mass];
      s.nodes = s.nodes.filter(
        (n) => Math.abs(n.x - mass.x) > 200 || Math.abs(n.y - mass.y) > 200,
      );
      s.paused = true;
    });
    cruciata.save();
    cruciata.resume();
    const d = cruciata.snapshot().terrainFeatures[0];
    return {
      count: d.tiles.length,
      contours: d.contours.length,
      blocked: !cruciata.free({ x: d.x, y: d.y }),
      x: d.x,
      y: d.y,
      rx: d.rx,
      ry: d.ry,
    };
  });
  expect(result).toEqual({
    count: 9,
    contours: 1,
    blocked: true,
    x: 9056,
    y: 5856,
    rx: 120,
    ry: 120,
  });
});
