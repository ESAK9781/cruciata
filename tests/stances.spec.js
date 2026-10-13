const { test, expect } = require("./helpers");
async function battle(page, distance = 180) {
  await page.goto("/?test");
  await page.evaluate((distance) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      const soldier = s.units.find((u) => u.team === 0 && u.type === "sword");
      const foe = {
        ...soldier,
        id: 999999,
        team: 1,
        x: 1500 + distance,
        y: 2600,
        hp: 10000,
        maxHp: 10000,
        stance: "hold",
        hold: true,
        home: null,
      };
      soldier.x = 1500;
      soldier.y = 2600;
      soldier.order = null;
      soldier.target = null;
      s.units = [soldier, foe];
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.enemy.think = 1e9;
    });
    cruciata.camera(1600, 2600);
  }, distance);
  await page.keyboard.press("Space");
}
for (const stance of ["hold", "stand-down", "fight"])
  test(`${stance} obeys independent movement and attack rules`, async ({
    page,
  }) => {
    await battle(page);
    await page.locator("#unit-stance").selectOption(stance);
    const far = await page.evaluate(() => {
      cruciata.step(3);
      return cruciata
        .snapshot()
        .units.map((u) => ({ x: u.x, hp: u.hp, stance: u.stance }));
    });
    if (stance === "fight") expect(far[0].x).toBeGreaterThan(1505);
    else expect(far[0].x).toBe(1500);
    await page.evaluate(() =>
      cruciata.scenario((s) => {
        const own = s.units.find((u) => u.team === 0),
          enemy = s.units.find((u) => u.team === 1);
        enemy.x = own.x + 25;
        enemy.y = own.y;
        own.cooldown = 0;
        own.target = null;
      }),
    );
    const near = await page.evaluate(() => {
      cruciata.step(2);
      return cruciata
        .snapshot()
        .units.map((u) => ({ x: u.x, hp: u.hp, stance: u.stance }));
    });
    if (stance === "stand-down") expect(near[1].hp).toBe(far[1].hp);
    else expect(near[1].hp).toBeLessThan(far[1].hp);
    expect(near[0].stance).toBe(stance);
  });
test("hold and stand down persist across manual movement orders", async ({
  page,
}) => {
  for (const stance of ["hold", "stand-down"]) {
    await battle(page, 1000);
    await page.locator("#unit-stance").selectOption(stance);
    const p = await page.evaluate(() => cruciata.project(1800, 2600));
    await page.mouse.click(p.x, p.y, { button: "right" });
    const u = await page.evaluate(() => {
      cruciata.step(10);
      return cruciata.snapshot().units.find((u) => u.team === 0);
    });
    expect(u.stance).toBe(stance);
    expect(u.x).toBeGreaterThan(1750);
    expect(u.order).toBeNull();
  }
});
