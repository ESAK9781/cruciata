const { test, expect } = require("./helpers");

test("forward-facing architecture has distinct faction silhouettes, textured courts and no circular building shadows", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const A = CruciataArt,
      c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d");
    const draw = (team, architecture) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 400, 400);
      A.structure(
        g,
        {
          kind: "house",
          w: 51,
          h: 50,
          x: 200,
          y: 230,
          hp: 450,
          maxHp: 450,
          progress: 1,
          team,
          architecture,
        },
        0,
      );
      return g.getImageData(140, 150, 120, 120).data;
    };
    draw(0, "christian");
    draw(1, "islamic");
    draw(0, "islamic");
    await CruciataAtlas.ready;
    const christian = draw(0, "christian"),
      islamic = draw(1, "islamic"),
      captured = draw(0, "islamic");
    let difference = 0,
      opaque = 0,
      capturedDifference = 0;
    for (let i = 0; i < christian.length; i += 4) {
      if (christian[i + 3] || islamic[i + 3]) {
        opaque++;
        if (
          Math.abs(christian[i] - islamic[i]) +
            Math.abs(christian[i + 1] - islamic[i + 1]) +
            Math.abs(christian[i + 2] - islamic[i + 2]) >
          45
        )
          difference++;
      }
      // Compare the building body below the little ownership standard.
      if (
        i / 4 / 120 > 60 &&
        Math.abs(captured[i] - islamic[i]) +
          Math.abs(captured[i + 1] - islamic[i + 1]) +
          Math.abs(captured[i + 2] - islamic[i + 2]) >
          15
      )
        capturedDifference++;
    }
    draw(0, "christian");
    const ground = g.getImageData(172, 258, 56, 8).data;
    return {
      different: difference / opaque,
      capturedDifference,
      groundAlpha: [...ground]
        .filter((_, i) => i % 4 === 3)
        .reduce((a, b) => a + b, 0),
      atlas: CruciataAtlas.stats(),
    };
  });
  expect(result.different).toBeGreaterThan(0.45);
  expect(result.capturedDifference).toBeLessThan(12);
  expect(result.groundAlpha).toBe(0);
  expect(result.atlas.hits).toBeGreaterThan(0);
});

test("troop, harvesting and mechanical animation frames reuse local sprite pages without model rendering", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d");
    g.translate(200, 220);
    const draw = (frame) => {
      for (const team of [0, 1]) {
        CruciataArt.unit(
          g,
          {
            type: "sword",
            team,
            rank: 0,
            moving: true,
            anim: ((frame + 0.1) / 12) * Math.PI * 2,
          },
          0,
          0,
        );
        for (const resource of ["wood", "stone", "gold", "food"])
          CruciataArt.unit(
            g,
            {
              type: "worker",
              team,
              rank: 4,
              working: true,
              job: { resource },
              anim: ((frame + 0.1) / 12) * Math.PI * 2,
              workPhase: (frame + 0.1) / 12,
            },
            0,
            0,
          );
        for (const type of ["ram", "ballista", "trebuchet"])
          CruciataArt.siegeMachine(
            g,
            { type, team, moving: true, deployment: "packed" },
            ((frame % 8) + 0.1) / 24,
            0,
          );
      }
    };
    for (let i = 0; i < 12; i++) draw(i);
    await CruciataAtlas.ready;
    const before = CruciataAtlas.stats(),
      raster = CruciataModelRaster.stats().renders;
    for (let i = 0; i < 120; i++) draw(i % 12);
    const after = CruciataAtlas.stats();
    return {
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      renders: CruciataModelRaster.stats().renders - raster,
      resident: after.residentPages,
    };
  });
  expect(result.hits).toBe(1920);
  expect(result.misses).toBe(0);
  expect(result.renders).toBe(0);
  expect(result.resident).toBeLessThanOrEqual(64);
});

test("great engine launch and reload frames stay visually distinct", async ({
  page,
}) => {
  await page.goto("/?test");
  const difference = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d"),
      b = { x: 200, y: 250, team: 0, aimAngle: 0, lastShot: 0 };
    CruciataArt.greatEngine(g, b, 0.21);
    CruciataArt.greatEngine(g, b, 1.21);
    await CruciataAtlas.ready;
    const draw = (time) => {
      g.clearRect(0, 0, 400, 400);
      CruciataArt.greatEngine(g, b, time);
      return g.getImageData(0, 0, 400, 400).data;
    };
    const launch = draw(0.21),
      reload = draw(1.21);
    let count = 0;
    for (let i = 0; i < launch.length; i += 4)
      if (
        Math.abs(launch[i] - reload[i]) +
          Math.abs(launch[i + 1] - reload[i + 1]) +
          Math.abs(launch[i + 2] - reload[i + 2]) +
          Math.abs(launch[i + 3] - reload[i + 3]) >
        70
      )
        count++;
    return count;
  });
  expect(difference).toBeGreaterThan(300);
});

test("dense views retain their active sprite pages instead of cycling empty loads", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const entries = [],
      seen = new Set();
    for (const [key, e] of Object.entries(CruciataAtlasManifest.frames))
      if (!seen.has(e[0])) {
        entries.push(key);
        seen.add(e[0]);
        if (entries.length === 40) break;
      }
    const g = document.createElement("canvas").getContext("2d");
    for (const key of entries) CruciataAtlas.draw(g, key, 100, 100, 0, 0);
    await CruciataAtlas.ready;
    const before = CruciataAtlas.stats();
    for (let frame = 0; frame < 4; frame++)
      for (const key of entries) CruciataAtlas.draw(g, key, 100, 100, 0, 0);
    const after = CruciataAtlas.stats();
    return {
      hits: after.hits - before.hits,
      pending: after.pendingFrames - before.pendingFrames,
      pages: after.residentPages,
    };
  });
  expect(result.hits).toBe(160);
  expect(result.pending).toBe(0);
  expect(result.pages).toBeLessThanOrEqual(64);
});

test("attached watchtower roofs remain visible above diagonal bastion curtains", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d"),
      A = CruciataArt;
    const tower = {
      kind: "watchtower",
      x: 200,
      y: 230,
      w: 30,
      h: 30,
      team: 0,
      hp: 100,
      maxHp: 100,
      progress: 1,
      fortified: true,
      wallAttachment: { fortified: true, wallAngle: Math.PI / 4, w: 32, h: 32 },
    };
    const draw = (neighbors) => {
      g.clearRect(0, 0, 400, 400);
      A.beginFrame(g);
      if (neighbors)
        for (const i of [-1, 0, 1])
          A.structure(
            g,
            {
              ...tower,
              kind: "wall",
              w: 32,
              h: 32,
              wallAttachment: null,
              x: 200 + i * Math.cos(Math.PI / 4) * 32,
              y: 230 + i * Math.sin(Math.PI / 4) * 32,
              wallAngle: Math.PI / 4,
            },
            0,
          );
      A.structure(g, tower, 0);
      A.flushFrame();
      return g.getImageData(180, 165, 40, 50).data;
    };
    draw(true);
    await CruciataAtlas.ready;
    const alone = draw(false),
      joined = draw(true);
    let roof = 0,
      covered = 0;
    for (let i = 0; i < alone.length; i += 4)
      if (
        alone[i] > alone[i + 1] * 1.4 &&
        alone[i] > alone[i + 2] * 1.4 &&
        alone[i + 3] > 240
      ) {
        roof++;
        if (
          Math.abs(alone[i] - joined[i]) +
            Math.abs(alone[i + 1] - joined[i + 1]) +
            Math.abs(alone[i + 2] - joined[i + 2]) >
          60
        )
          covered++;
      }
    return { roof, covered };
  });
  expect(result.roof).toBeGreaterThan(100);
  expect(result.covered).toBeLessThan(result.roof * 0.05);
});
