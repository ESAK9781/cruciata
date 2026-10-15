const { test, expect } = require("./helpers");

test("attached towers sit exactly on their curtain line in every campaign fortress", async ({
  page,
}) => {
  await page.goto("/?test");
  for (const level of [3, 4, 5]) {
    const result = await page.evaluate((level) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const s = cruciata.snapshot();
      const towers = s.buildings.filter(
        (b) => b.kind === "tower" && b.wallAttachment && b.hp > 0,
      );
      return {
        count: towers.length,
        displaced: towers.filter(
          (b) =>
            Math.abs(b.x - b.wallAttachment.x) > 0.5 ||
            Math.abs(b.y - b.wallAttachment.y) > 0.5,
        ).length,
      };
    }, level);
    expect(result.count, `level ${level}`).toBeGreaterThan(0);
    expect(result.displaced, `level ${level}`).toBe(0);
  }
});

test("a saved tower displaced from its curtain is returned to the wall line", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(5);
    let id = null;
    cruciata.scenario((s) => {
      const tower = s.buildings.find(
        (b) => b.kind === "tower" && b.wallAttachment,
      );
      id = tower.id;
      tower.x += 40;
      tower.y -= 25;
      s.navDirty = true;
    });
    cruciata.step(2);
    const t = cruciata.snapshot().buildings.find((b) => b.id === id);
    return { dx: t.x - t.wallAttachment.x, dy: t.y - t.wallAttachment.y };
  });
  expect(Math.abs(result.dx)).toBeLessThan(1);
  expect(Math.abs(result.dy)).toBeLessThan(1);
});
