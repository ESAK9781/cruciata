const { test, expect } = require("./helpers");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}
test("war orders minimize and restore, and the choice is remembered", async ({
  page,
}) => {
  await begin(page);
  const panel = page.locator("#objective-panel");
  await expect(page.locator("#objective-text")).toBeVisible();
  await page.click("#objective-toggle");
  await expect(panel).toHaveClass(/collapsed/);
  await expect(page.locator("#objective-text")).toBeHidden();
  await page.reload();
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
  await expect(panel).toHaveClass(/collapsed/);
  await page.click("#objective-toggle");
  await expect(panel).not.toHaveClass(/collapsed/);
  await expect(page.locator("#objective-text")).toBeVisible();
});
test("the view can slide past the map edge but never fully off the land", async ({
  page,
}) => {
  await begin(page);
  const probe = (x, y) =>
    page.evaluate(
      ([x, y]) => {
        cruciata.camera(x, y);
        const s = cruciata.snapshot();
        return { camera: s.camera, view: s.view, world: s.world };
      },
      [x, y],
    );
  const topLeft = await probe(-1e6, -1e6);
  expect(topLeft.camera.x).toBeLessThan(0);
  expect(topLeft.camera.y).toBeLessThan(0);
  // At least a fifth of the view still covers the land.
  expect(topLeft.view.x + topLeft.view.w).toBeGreaterThanOrEqual(
    topLeft.view.w * 0.19,
  );
  const bottomRight = await probe(1e6, 1e6);
  expect(bottomRight.camera.x).toBeGreaterThan(bottomRight.world.width);
  expect(bottomRight.view.x).toBeLessThanOrEqual(
    bottomRight.world.width - bottomRight.view.w * 0.19,
  );
  expect(bottomRight.view.y).toBeLessThanOrEqual(
    bottomRight.world.height - bottomRight.view.h * 0.19,
  );
});
