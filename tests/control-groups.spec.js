const { test, expect } = require("./helpers");
async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}
async function clickBuilding(page, id, shift = false) {
  const p = await page.evaluate((id) => {
    const b = cruciata.snapshot().buildings.find((b) => b.id === id);
    cruciata.camera(b.x, b.y);
    return cruciata.project(b.x, b.y);
  }, id);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up("Shift");
}
test("number keys recall unit groups, zero works, and button selection matches keyboard selection", async ({
  page,
}) => {
  await begin(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+1");
  const army = await page.evaluate(() => cruciata.snapshot().selected);
  await page.keyboard.press("e");
  await page.keyboard.press("Control+0");
  const villagers = await page.evaluate(() => cruciata.snapshot().selected);
  await page.keyboard.press("1");
  expect(await page.evaluate(() => cruciata.snapshot().selected)).toEqual(army);
  await expect(page.locator("#control-group-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("0");
  expect(await page.evaluate(() => cruciata.snapshot().selected)).toEqual(
    villagers,
  );
  await page.locator("#control-group-1").click();
  expect(await page.evaluate(() => cruciata.snapshot().selected)).toEqual(army);
});
test("building and mixed groups append selections, survive saves, and ignore lost members", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const t = s.buildings.find((b) => b.kind === "barracks");
      s.nodes = [];
      s.decorations = [];
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      s.buildings.push(
        { ...t, id: 95001, x: 1500, y: 2600, queue: [] },
        { ...t, id: 95002, x: 1700, y: 2600, queue: [] },
      );
    }),
  );
  await clickBuilding(page, 95001);
  await clickBuilding(page, 95002, true);
  await page.keyboard.press("Control+2");
  await page.keyboard.press("Space");
  await page.keyboard.press("2");
  expect(
    await page.evaluate(() => cruciata.snapshot().selectedBuildings),
  ).toEqual([95001, 95002]);
  // Training rotates among the selected producers, one operation per click.
  await page.locator("#recruit-sword").click();
  await page.locator("#recruit-sword").click();
  expect(
    await page.evaluate(() =>
      cruciata
        .snapshot()
        .buildings.filter((b) => [95001, 95002].includes(b.id))
        .map((b) => b.queue.length),
    ),
  ).toEqual([1, 1]);
  await page.keyboard.press("e");
  await page.keyboard.press("Control+Shift+2");
  await page.keyboard.press("2");
  let s = await page.evaluate(() => cruciata.snapshot());
  expect(s.selected.length).toBeGreaterThan(0);
  expect(s.selectedBuildings).toEqual([95001, 95002]);
  await page.evaluate(() => cruciata.save());
  await page.reload();
  await page.locator("#resume-campaign").click();
  await page.locator("#overlay button").click();
  await page.keyboard.press("2");
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.selectedBuildings).toEqual([95001, 95002]);
  expect(s.selected.length).toBeGreaterThan(0);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units.find((u) => u.team === 0 && u.type === "worker").hp = 0;
      s.buildings.find((b) => b.id === 95001).team = 1;
    }),
  );
  await page.keyboard.press("2");
  s = await page.evaluate(() => cruciata.snapshot());
  expect(s.selectedBuildings).toEqual([95002]);
  expect(
    s.selected.every((id) => s.units.some((u) => u.id === id && u.hp > 0)),
  ).toBe(true);
});
