const { test, expect } = require("./helpers");

test("forests are dense blocking masses with harvestable rims on every campaign map", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/?test");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let level = 0; level < 6; level++) {
    const r = await page.evaluate((level) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const S = cruciata.internals().state,
        forests = S.terrainFeatures.filter((f) => f.forest),
        tc = S.buildings.find((b) => b.team === 0 && b.kind === "towncenter"),
        foe = S.buildings.find((b) => b.team === 1 && b.kind === "towncenter"),
        tile = forests[0]?.tiles[Math.floor(forests[0].tiles.length / 2)],
        center = tile && { x: (tile.x + 0.5) * 64, y: (tile.y + 0.5) * 64 },
        route = cruciata.route(
          { x: tc.x, y: tc.y + 90 },
          { x: foe.x, y: foe.y + 90 },
        );
      return {
        forests: forests.length,
        tiles: forests.reduce((a, f) => a + f.tiles.length, 0),
        blocked: center ? !cruciata.free(center) : false,
        woodNear: S.nodes.some(
          (n) => n.kind === "wood" && Math.hypot(n.x - tc.x, n.y - tc.y) < 900,
        ),
        // No wood deposit stands inside a forest's solid tiles.
        buried: S.nodes.filter(
          (n) =>
            n.kind === "wood" &&
            forests.some((f) =>
              f.tiles.some(
                (t) =>
                  n.x > t.x * 64 + 8 &&
                  n.x < (t.x + 1) * 64 - 8 &&
                  n.y > t.y * 64 + 8 &&
                  n.y < (t.y + 1) * 64 - 8,
              ),
            ),
        ).length,
        routed: route.length > 0,
      };
    }, level);
    expect(r.forests, "level " + level).toBeGreaterThan(5);
    expect(r.tiles).toBeGreaterThan(400);
    expect(r.blocked).toBe(true);
    expect(r.woodNear).toBe(true);
    expect(r.buried).toBe(0);
    expect(r.routed).toBe(true);
  }
});

test("saved forests reload as blocking terrain", async ({ page }) => {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
  const before = await page.evaluate(
    () =>
      cruciata.internals().state.terrainFeatures.filter((f) => f.forest).length,
  );
  await page.evaluate(() => cruciata.save());
  await page.reload();
  await page.locator("#resume-campaign").click();
  await page.locator("#overlay button").click();
  const after = await page.evaluate(() => {
    const S = cruciata.internals().state,
      f = S.terrainFeatures.find((f) => f.forest),
      t = f.tiles[0];
    return {
      count: S.terrainFeatures.filter((f) => f.forest).length,
      blocked: !cruciata.free({ x: (t.x + 0.5) * 64, y: (t.y + 0.5) * 64 }),
    };
  });
  expect(after.count).toBe(before);
  expect(after.blocked).toBe(true);
});
