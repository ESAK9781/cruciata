const { test, expect } = require("./helpers");
async function load(page) {
  await page.goto("/?test");
  expect(await page.evaluate(() => CruciataArt.assetReady)).toBe(true);
}
test("realism assets decode and animated direction, construction, and deployment remain distinct", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await load(page);
  const checks = await page.evaluate(() => {
    const art = CruciataArt,
      assets = Object.keys(art.realisticAssets.images),
      bounds = Object.fromEntries(
        Object.entries(art.realisticAssets.bounds).map(([name, cells]) => [
          name,
          cells.length,
        ]),
      );
    const c = document.createElement("canvas");
    c.width = c.height = 180;
    const g = c.getContext("2d");
    const hash = (draw) => {
      g.clearRect(0, 0, 180, 180);
      g.save();
      g.translate(90, 90);
      draw();
      g.restore();
      return c.toDataURL();
    };
    const u = {
      id: 1,
      type: "sword",
      team: 0,
      angle: 0,
      moving: false,
      hp: 100,
      maxHp: 100,
      rank: 0,
    };
    const facing = [0, Math.PI / 2].map((angle) =>
      hash(() => art.unit(g, u, 0, angle)),
    );
    const teams = [0, 1, 3].map((team) =>
      hash(() => art.unit(g, { ...u, team }, 0, 0)),
    );
    const deployment = ["packed", "setting-up", "deployed", "packing"].map(
      (deployment) =>
        hash(() =>
          art.unit(
            g,
            { ...u, type: "trebuchet", deployment, deployTimer: 2, strike: 0 },
            0,
            0,
          ),
        ),
    );
    const construction = [0.2, 0.6, 1].map((progress) =>
      hash(() =>
        art.structure(
          g,
          {
            id: 22,
            kind: "barracks",
            team: 0,
            x: 0,
            y: 0,
            w: 100,
            h: 80,
            hp: 100,
            maxHp: 100,
            progress,
          },
          1,
        ),
      ),
    );
    return {
      assets,
      bounds,
      facing: new Set(facing).size,
      teams: new Set(teams).size,
      deployment: new Set(deployment).size,
      construction: new Set(construction).size,
    };
  });
  expect(checks.assets.sort()).toEqual([
    "buildings",
    "materials",
    "resources",
    "units",
  ]);
  expect(checks.bounds).toEqual({ buildings: 16, resources: 8, units: 12 });
  expect(checks.facing).toBe(2);
  expect(checks.teams).toBe(3);
  expect(checks.deployment).toBe(4);
  expect(checks.construction).toBe(3);
  expect(errors).toEqual([]);
});
for (const size of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
])
  test(`realism menus and battlefield fit ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await load(page);
    await expect(page.locator("#front-menu")).toBeVisible();
    await expect(page.locator("#open-campaign")).toBeEnabled();
    await page.locator("#open-campaign").click();
    await page.locator("#chapter-0").click();
    await page.locator("#overlay button").click();
    const layout = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight > innerHeight + 1,
      width: document.documentElement.scrollWidth > innerWidth + 1,
      canvas: document.querySelector("#game").getBoundingClientRect().height,
      commands: document.querySelector(".commands").getBoundingClientRect()
        .bottom,
      footer:
        document.querySelector("footer").getBoundingClientRect().height > 0
          ? document.querySelector("footer").getBoundingClientRect().top
          : innerHeight,
    }));
    expect(layout.scroll).toBe(false);
    expect(layout.width).toBe(false);
    expect(layout.canvas).toBeGreaterThan(100);
    expect(layout.commands).toBeLessThanOrEqual(layout.footer + 1);
    expect(errors).toEqual([]);
  });

test("realism preserves the main world layout, resources, and unit rules", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.CRUCIATA_COMPARE_MAIN_URL,
    "Set a main-version URL for optional cross-branch comparison.",
  );
  const snapshot = async (url) => {
    await page.goto(url);
    if (url.includes("3030")) await page.evaluate(() => CruciataArt.assetReady);
    return page.evaluate(() => {
      cruciata.start(0);
      cruciata.scenario((s) => {
        s.paused = true;
      });
      const s = cruciata.snapshot();
      return {
        resources: s.resources,
        nodes: s.nodes.map((n) => ({
          kind: n.kind,
          x: n.x,
          y: n.y,
          remaining: n.remaining,
        })),
        buildings: s.buildings.map((b) => ({
          kind: b.kind,
          team: b.team,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          maxHp: b.maxHp,
        })),
        units: s.units.map((u) => ({
          type: u.type,
          team: u.team,
          x: u.x,
          y: u.y,
          maxHp: u.maxHp,
        })),
        cities: s.cities.map((c) => ({ x: c.x, y: c.y, radius: c.radius })),
        roads: s.roads,
      };
    });
  };
  const main = await snapshot(process.env.CRUCIATA_COMPARE_MAIN_URL),
    realism = await snapshot(baseURL + "/?test");
  expect(realism).toEqual(main);
});
