const { test, expect } = require("./helpers");

test("forked cloth trails in every movement direction and settles under gravity", async ({
  page,
}) => {
  await page.goto("/?test");
  const results = await page.evaluate(() => {
    const art = CruciataArt;
    return [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((angle) => {
      const u = { x: 0, y: 0, angle, team: 0 };
      art.updateStandard(u, 1 / 120);
      for (let i = 0; i < 600; i++) {
        u.x += (Math.cos(angle) * 70) / 120;
        u.y += (Math.sin(angle) * 70) / 120;
        art.updateStandard(u, 1 / 120);
      }
      const cloth = art.standardCloth(u),
        tip = cloth.rows[2].at(-1);
      const moving = {
        height: tip.z,
        trailing:
          (tip.x - cloth.anchor.x) * Math.cos(angle) +
          (tip.y - cloth.anchor.y) * Math.sin(angle),
      };
      art.updateStandard(u, 0.1);
      const earlyHeight = tip.z;
      for (let i = 0; i < 960; i++) art.updateStandard(u, 1 / 120);
      const restHeight = tip.z;
      const stretch = Math.max(
        ...cloth.links.map(
          ({ a, b, length }) =>
            Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / length,
        ),
      );
      const before = JSON.stringify(cloth.points);
      const g = document.createElement("canvas").getContext("2d");
      art.armyStandard(g, u);
      art.armyStandard(g, u);
      return {
        moving,
        earlyHeight,
        restHeight,
        stretch,
        fork: cloth.rows.map((row) => row.length),
        renderMutated: before !== JSON.stringify(cloth.points),
      };
    });
  });
  for (const result of results) {
    expect(result.moving.trailing).toBeLessThan(-45);
    expect(result.moving.height).toBeGreaterThan(8);
    expect(result.earlyHeight).toBeGreaterThan(result.restHeight + 5);
    expect(result.restHeight).toBeGreaterThanOrEqual(7);
    expect(result.restHeight).toBeLessThan(10);
    expect(result.stretch).toBeLessThan(1.12);
    expect(result.fork).toEqual([17, 15, 13, 15, 17]);
    expect(result.renderMutated).toBe(false);
  }
});

test("cloth preserves inertia through turns and resets safely on teleport", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const art = CruciataArt,
      u = { x: 0, y: 0, angle: 0, team: 0 };
    art.updateStandard(u, 1 / 120);
    for (let i = 0; i < 360; i++) {
      u.x += 70 / 120;
      art.updateStandard(u, 1 / 120);
    }
    const cloth = art.standardCloth(u),
      tip = cloth.rows[2].at(-1);
    u.angle = Math.PI;
    u.x -= 70 / 120;
    art.updateStandard(u, 1 / 120);
    const turnStart = tip.x - cloth.anchor.x;
    for (let i = 0; i < 600; i++) {
      u.x -= 70 / 120;
      art.updateStandard(u, 1 / 120);
    }
    const turnEnd = tip.x - cloth.anchor.x;
    u.x += 3000;
    u.y += 2000;
    art.updateStandard(u, 1 / 120);
    return {
      turnStart,
      turnEnd,
      distance: Math.hypot(tip.x - cloth.anchor.x, tip.y - cloth.anchor.y),
      finite: cloth.points.every((p) =>
        [p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite),
      ),
    };
  });
  expect(result.turnStart).toBeLessThan(-40);
  expect(result.turnEnd).toBeGreaterThan(45);
  expect(result.distance).toBeLessThan(85);
  expect(result.finite).toBe(true);
});

test("unfurled cloth displays all five Jerusalem crosses on a taller slim staff", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const u = { x: 0, y: 0, angle: 0, team: 0 },
      cloth = CruciataArt.standardCloth(u);
    for (const p of cloth.points) {
      p.x = cloth.anchor.x - p.c * 4.2;
      p.y = cloth.anchor.y;
      p.z = cloth.anchor.z - p.r * 4;
    }
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const g = c.getContext("2d");
    g.translate(100, 100);
    g.scale(0.72, 0.72);
    CruciataArt.standardMaster(g, u);
    const centers = [
      [22, 8],
      [17.98, 3.98],
      [26.02, 3.98],
      [17.98, 12.02],
      [26.02, 12.02],
    ];
    return {
      height: cloth.anchor.z,
      crosses: centers.map(([x, y]) => {
        const px = Math.round(100 + cloth.anchor.x - x * 0.84),
          py = Math.round(100 + cloth.anchor.y - cloth.anchor.z + y);
        const data = g.getImageData(px - 1, py - 1, 3, 3).data;
        for (let i = 0; i < data.length; i += 4)
          if (
            data[i] > 220 &&
            data[i + 1] > 200 &&
            data[i + 2] > 150 &&
            data[i + 3] > 200
          )
            return true;
        return false;
      }),
    };
  });
  expect(result.height).toBe(44);
  expect(result.crosses).toEqual([true, true, true, true, true]);
});

test("bastion masonry fills capsule corners, zero arms and tower curtain attachments", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const paint = (extra, points) => {
      const c = document.createElement("canvas");
      c.width = c.height = 160;
      const g = c.getContext("2d");
      CruciataArt.structure(
        g,
        {
          kind: "wall",
          x: 80,
          y: 80,
          w: 32,
          h: 32,
          hp: 11000,
          maxHp: 11000,
          progress: 1,
          team: 1,
          fortified: true,
          ...extra,
        },
        0,
      );
      return points.map(
        ([x, y]) => g.getImageData(80 + x, 80 + y, 1, 1).data[3],
      );
    };
    const samples = () => ({
      corner: paint({ links: { e: { x: 16, y: 0 }, n: { x: 0, y: -16 } } }, [
        [-10, 10],
        [-15, 7],
        [8, 16],
      ]),
      gate: paint({ links: { w: { x: -16, y: 0 }, e: { x: 0, y: 0 } } }, [
        [10, 0],
        [8, 12],
      ]),
      tower: paint(
        {
          kind: "tower",
          w: 48,
          h: 48,
          wallAttachment: {
            x: 80,
            y: 80,
            w: 32,
            h: 32,
            fortified: true,
            links: { e: { x: 32, y: 0 }, n: { x: 0, y: -32 } },
          },
        },
        [
          [30, 10],
          [10, -30],
        ],
      ),
    });
    samples();
    await CruciataAtlas.ready;
    return samples();
  });
  for (const pixels of Object.values(result))
    expect(
      pixels.every((a) => a === 255),
      JSON.stringify(result),
    ).toBe(true);
});

test("building previews repaint when their atlas pages finish decoding", async ({
  page,
}) => {
  await page.goto("/?test");
  const preview = page.locator("#build-tower canvas");
  await expect(preview).toHaveCount(1);
  const alpha = await preview.evaluate(async (canvas) => {
    await CruciataAtlas.ready;
    await new Promise(requestAnimationFrame);
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
    return count;
  });
  expect(alpha).toBeGreaterThan(300);
});
