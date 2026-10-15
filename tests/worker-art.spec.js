const { test, expect } = require("./helpers");

test("villagers carry lowered tools while walking and animate every stationary harvesting job", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 180;
    const g = c.getContext("2d");
    const draw = (u) => {
      g.setTransform(1, 0, 0, 1, 90, 110);
      g.clearRect(-90, -110, 180, 180);
      CruciataArt.unit(g, u, 10, 0);
      return c.toDataURL();
    };
    const u = {
      type: "worker",
      team: 0,
      rank: 4,
      anim: Math.PI / 2,
      moving: true,
      working: true,
      workPhase: 0.25,
      job: { resource: "wood" },
    };
    const walk = draw(u),
      withoutJob = draw({ ...u, working: false, job: null });
    draw(u);
    const pixels = g.getImageData(98, 55, 20, 25).data;
    const highTool = [...pixels].filter((v, i) => i % 4 === 3 && v > 0).length;
    const resources = ["wood", "stone", "gold", "food", "berries"].map(
      (resource) => {
        const b = {
          ...u,
          moving: false,
          working: true,
          job: { resource: resource === "berries" ? "food" : resource },
          gatherSource: resource === "berries" ? "food" : "farm",
        };
        return (
          draw({ ...b, workPhase: 0.1 }) !== draw({ ...b, workPhase: 0.4 })
        );
      },
    );
    return { sameWalk: walk === withoutJob, highTool, resources };
  });
  expect(result.sameWalk).toBe(true);
  expect(result.highTool).toBe(0);
  expect(result.resources).toEqual([true, true, true, true, true]);
});

test("real harvesting advances visible work poses without a moving animation clock", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.enemy.think = 1e9;
      s.campaignRules = null;
      const b = s.buildings.find((b) => b.team === 0 && b.kind === "house");
      Object.assign(b, {
        kind: "farm",
        x: 1300,
        y: 2600,
        w: 106,
        h: 78,
        r: 53,
        remaining: 2400,
        max: 2400,
      });
      const u = s.units.find((u) => u.team === 0 && u.type === "worker");
      s.units = [u];
      Object.assign(u, {
        x: 1300,
        y: 2600,
        order: null,
        job: {
          kind: "gather",
          resource: "food",
          target: b.id,
          phase: "approach",
        },
      });
    });
    cruciata.camera(1300, 2600);
    cruciata.step(4);
    const first = cruciata.snapshot().units[0];
    cruciata.step(0.25);
    const second = cruciata.snapshot().units[0];
    const c = document.createElement("canvas");
    c.width = c.height = 180;
    const g = c.getContext("2d");
    g.translate(90, 110);
    const draw = (u) => {
      g.clearRect(-90, -110, 180, 180);
      CruciataArt.unit(g, u, 0, 0);
      return c.toDataURL();
    };
    const posesChange = draw(first) !== draw(second);
    cruciata.order([second.id], { x: 1500, y: 2700 });
    cruciata.step(0.5);
    const walking = cruciata.snapshot().units[0];
    return {
      first: {
        working: first.working,
        moving: first.moving,
        carry: first.carry,
      },
      second: {
        working: second.working,
        moving: second.moving,
        carry: second.carry,
      },
      animFrozen: first.anim === second.anim,
      posesChange,
      walking: { moving: walking.moving, working: walking.working },
    };
  });
  expect(result.first.working).toBe(true);
  expect(result.first.moving).toBe(false);
  expect(result.second.working).toBe(true);
  expect(result.second.carry).toBeGreaterThan(result.first.carry);
  expect(result.animFrozen).toBe(true);
  expect(result.posesChange).toBe(true);
  expect(result.walking).toEqual({ moving: true, working: false });
});
