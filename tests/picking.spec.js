const { test, expect } = require("./helpers");

async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
}

// Offsets from a unit's ground point that lie inside the drawn silhouette.
const BODY = [
  [0, -4],
  [0, -16],
  [-6, -24],
  [6, -28],
  [0, -30],
];

for (const type of ["sword", "archer", "knight", "chaplain"]) {
  test(`a ${type} can be selected from anywhere on its drawn body`, async ({
    page,
  }) => {
    await begin(page);
    const unit = await page.evaluate((type) => {
      let id = 940000 + Math.floor(Math.random() * 1000),
        out;
      cruciata.scenario((s) => {
        const base = s.buildings.find(
          (b) => b.team === 0 && b.kind === "towncenter",
        );
        const template = JSON.parse(
          JSON.stringify(
            s.units.find((u) => u.team === 0 && u.type === "sword"),
          ),
        );
        Object.assign(template, {
          id,
          type,
          x: base.x + 420,
          y: base.y + 260,
          order: null,
          path: [],
        });
        s.units.push(template);
        out = { id, x: template.x, y: template.y };
      });
      return out;
    }, type);
    for (const [dx, dy] of BODY) {
      await page.evaluate(({ x, y }) => cruciata.camera(x, y), unit);
      await page.waitForTimeout(60);
      const p = await page.evaluate(({ x, y }) => cruciata.project(x, y), {
        x: unit.x + dx,
        y: unit.y + dy,
      });
      await page.mouse.click(p.x, p.y);
      expect(
        await page.evaluate(() => cruciata.snapshot().selected),
        `${type} at ${dx},${dy}`,
      ).toContain(unit.id);
    }
  });
}

test("towers can be selected by clicking their raised top as well as their base", async ({
  page,
}) => {
  await begin(page);
  const towers = await page.evaluate(() => {
    const out = [];
    cruciata.scenario((s) => {
      const base = s.buildings.find(
        (b) => b.team === 0 && b.kind === "towncenter",
      );
      const template = JSON.parse(JSON.stringify(base));
      [
        ["tower", 43, false],
        ["tower", 48, true],
        ["watchtower", 30, false],
      ].forEach(([kind, size, attached], i) => {
        const b = {
          ...JSON.parse(JSON.stringify(template)),
          id: 950000 + i,
          kind,
          w: size,
          h: size,
          x: base.x + 500 + i * 200,
          y: base.y + 380,
          hp: 800,
          maxHp: 800,
          progress: 1,
          queue: [],
        };
        if (attached)
          b.wallAttachment = {
            x: b.x,
            y: b.y,
            w: 32,
            h: 32,
            wallAngle: 0,
            fortified: true,
            links: {},
          };
        s.buildings.push(b);
        out.push({ id: b.id, x: b.x, y: b.y });
      });
    });
    return out;
  });
  for (const tower of towers)
    for (const dy of [0, -20, -40, -60]) {
      await page.evaluate(({ x, y }) => cruciata.camera(x, y), tower);
      await page.waitForTimeout(60);
      const p = await page.evaluate(({ x, y }) => cruciata.project(x, y), {
        x: tower.x,
        y: tower.y + dy,
      });
      await page.mouse.click(p.x, p.y);
      expect(
        await page.evaluate(() => cruciata.snapshot().selectedBuildings),
        `tower ${tower.id} at ${dy}`,
      ).toContain(tower.id);
    }
});
