const { test, expect } = require("./helpers");

async function begin(page) {
  await page.goto("/?test");
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
}

test("walls can be placed close to map borders without leaving gaps", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.supply({ stone: 10000, wood: 10000 });
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cheats = { reveal: true };
    });

    const s = cruciata.snapshot();
    const W = s.world.width;
    const H = s.world.height;

    // Check land borders in Chapter 0 (east, north, south)
    const rightSite = cruciata.site("wall", { x: W - 32, y: 1000 });
    const topSite = cruciata.site("wall", { x: 1000, y: 32 });
    const bottomSite = cruciata.site("wall", { x: 1000, y: H - 32 });

    // Other buildings (e.g. house) still retain footprint clearance
    const houseAtBorder = cruciata.site("house", { x: W - 32, y: 1000 });

    // Place a wall at the border
    cruciata.scenario((st) => {
      st.buildings.push({
        id: 99881,
        team: 0,
        kind: "wall",
        x: W - 32,
        y: 1000,
        w: 32,
        h: 32,
        hp: 1500,
        maxHp: 1500,
        progress: 1,
        wallAngle: 0,
        queue: [],
      });
    });

    // Verify the wall connects to the terrain border
    const wallObj = cruciata.snapshot().buildings.find((b) => b.id === 99881);
    const hasBorderLink = !!wallObj.links?.e;

    // Verify ground is blocked across the border margin, leaving no passable gap
    const borderCellClear = cruciata.free({ x: W - 16, y: 1000 });
    const wallCellClear = cruciata.free({ x: W - 32, y: 1000 });

    // In a dryland skirmish (inland, no sea), test all 4 borders including west
    cruciata.launch(0, { width: 4000, height: 3000, biome: 2 });
    cruciata.scenario((st) => {
      st.cheats = { reveal: true };
    });
    const inlandLeft = cruciata.site("wall", { x: 32, y: 1000 });
    const inlandRight = cruciata.site("wall", { x: 3968, y: 1000 });
    const inlandTop = cruciata.site("wall", { x: 1000, y: 32 });
    const inlandBottom = cruciata.site("wall", { x: 1000, y: 2968 });

    return {
      rightSite,
      topSite,
      bottomSite,
      houseAtBorder,
      hasBorderLink,
      borderCellClear,
      wallCellClear,
      inlandLeft,
      inlandRight,
      inlandTop,
      inlandBottom,
    };
  });

  expect(result.rightSite).toBe(true);
  expect(result.topSite).toBe(true);
  expect(result.bottomSite).toBe(true);
  expect(result.houseAtBorder).toBe(false);
  expect(result.hasBorderLink).toBe(true);
  expect(result.borderCellClear).toBe(false);
  expect(result.wallCellClear).toBe(false);
  expect(result.inlandLeft).toBe(true);
  expect(result.inlandRight).toBe(true);
  expect(result.inlandTop).toBe(true);
  expect(result.inlandBottom).toBe(true);
});

test("boids-like unit movement maintains cohesion and separation during group march", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let squadIds = [];
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.sites = [];
      s.cities = [];
      s.enemy.think = 1e9;
      // 8 swordsmen in two ranks
      const swords = s.units.filter((u) => u.team === 0 && u.type === "sword");
      while (swords.length < 8) {
        const copy = { ...swords[0], id: 98000 + swords.length };
        swords.push(copy);
        s.units.push(copy);
      }
      s.units = swords.slice(0, 8);
      squadIds = s.units.map((u) => u.id);
      s.units.forEach((u, i) => {
        u.x = 1400 + (i % 4) * 24;
        u.y = 2500 + Math.floor(i / 4) * 24;
        u.order = null;
        u.path = [];
      });
    });

    // Order squad to move 600px to the east
    const target = { x: 2000, y: 2500 };
    cruciata.order(squadIds, target, false);

    // Step a few seconds while moving
    cruciata.step(3);
    const midSnapshot = cruciata.snapshot().units;
    const midSquad = midSnapshot.filter((u) => squadIds.includes(u.id));

    // Check separation: no two units should be overlapping (< 14px)
    let minSeparation = Infinity;
    for (let i = 0; i < midSquad.length; i++) {
      for (let j = i + 1; j < midSquad.length; j++) {
        const d = Math.hypot(
          midSquad[i].x - midSquad[j].x,
          midSquad[i].y - midSquad[j].y,
        );
        if (d < minSeparation) minSeparation = d;
      }
    }

    // Check cohesion: all squad members should remain within a reasonable company radius
    const avgX = midSquad.reduce((sum, u) => sum + u.x, 0) / midSquad.length;
    const avgY = midSquad.reduce((sum, u) => sum + u.y, 0) / midSquad.length;
    const maxDistFromCenter = Math.max(
      ...midSquad.map((u) => Math.hypot(u.x - avgX, u.y - avgY)),
    );

    // All units should have advanced eastward along the path
    const allMovingEast = midSquad.every((u) => u.x > 1450);

    // Let the squad complete their march to destination
    cruciata.step(8);
    const finalSnapshot = cruciata.snapshot().units;
    const finalSquad = finalSnapshot.filter((u) => squadIds.includes(u.id));
    const allArrived = finalSquad.every(
      (u) => Math.hypot(u.x - target.x, u.y - target.y) < 100,
    );
    const finalSeparate = finalSquad.every((u, i) =>
      finalSquad.every(
        (v, j) => i === j || Math.hypot(u.x - v.x, u.y - v.y) > 16,
      ),
    );

    return {
      allMovingEast,
      minSeparation,
      maxDistFromCenter,
      allArrived,
      finalSeparate,
    };
  });

  expect(result.allMovingEast).toBe(true);
  expect(result.minSeparation).toBeGreaterThanOrEqual(14);
  expect(result.maxDistFromCenter).toBeLessThan(120);
  expect(result.allArrived).toBe(true);
  expect(result.finalSeparate).toBe(true);
});

test("obstacle avoidance force steers marching units smoothly around obstacles", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let unitId;
    cruciata.scenario((s) => {
      s.nodes = [];
      s.sites = [];
      s.cities = [];
      s.enemy.think = 1e9;
      // Place a rock obstacle directly in the line of travel
      s.decorations = [{ kind: "rock", x: 1600, y: 2600, r: 35, block: true }];
      const u = s.units.find((u) => u.team === 0 && u.type === "sword");
      u.x = 1450;
      u.y = 2600;
      u.order = null;
      u.path = [];
      unitId = u.id;
      s.units = [u];
    });

    const destination = { x: 1800, y: 2600 };
    cruciata.order([unitId], destination, false);

    // Step through the movement
    let collidedWithRock = false;
    for (let step = 0; step < 20; step++) {
      cruciata.step(0.3);
      const u = cruciata.snapshot().units.find((u) => u.id === unitId);
      const distToRock = Math.hypot(u.x - 1600, u.y - 2600);
      // Rock radius is 35, plus unit radius ~12 => collision if dist < 40
      if (distToRock < 40) collidedWithRock = true;
    }

    cruciata.step(5);
    const finalUnit = cruciata.snapshot().units.find((u) => u.id === unitId);
    const goalY = finalUnit.formation ? finalUnit.formation.y : 2600;
    const reachedGoal =
      Math.hypot(finalUnit.x - 1800, finalUnit.y - goalY) < 15;

    return {
      collidedWithRock,
      reachedGoal,
      finalUnit,
    };
  });

  expect(result.collidedWithRock).toBe(false);
  expect(result.reachedGoal).toBe(true);
});

test("large units move without periodic zig-zagging or pileups and maintain proper spacing", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let knightIds = [];
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.sites = [];
      s.cities = [];
      s.enemy.think = 1e9;
      // 6 knights
      const baseKnight = s.units.find(
        (u) => u.team === 0 && u.type === "knight",
      ) || {
        ...s.units.find((u) => u.team === 0 && u.type === "sword"),
        type: "knight",
        speed: 96,
        maxHp: 650,
        hp: 650,
      };
      const knights = [];
      for (let i = 0; i < 6; i++) {
        knights.push({
          ...baseKnight,
          id: 97000 + i,
          type: "knight",
          team: 0,
          x: 1300 + (i % 3) * 36,
          y: 2500 + Math.floor(i / 3) * 36,
          order: null,
          path: [],
          stuck: 0,
        });
      }
      s.units = knights;
      knightIds = knights.map((k) => k.id);
    });

    const target = { x: 1900, y: 2500 };
    cruciata.order(knightIds, target, false);

    let minSeparation = Infinity;
    let anyMovedBackward = false;
    let prevX = {};
    knightIds.forEach((id) => {
      prevX[id] = 1250;
    });

    // Step across 5 seconds of movement, checking each 0.5s
    for (let step = 0; step < 10; step++) {
      cruciata.step(0.5);
      const squad = cruciata
        .snapshot()
        .units.filter((u) => knightIds.includes(u.id));

      for (let i = 0; i < squad.length; i++) {
        // Forward progress check: once moving, shouldn't drop significantly backward (> 5px)
        if (squad[i].x < prevX[squad[i].id] - 5) {
          anyMovedBackward = true;
        }
        prevX[squad[i].id] = squad[i].x;

        for (let j = i + 1; j < squad.length; j++) {
          const d = Math.hypot(
            squad[i].x - squad[j].x,
            squad[i].y - squad[j].y,
          );
          if (d < minSeparation) minSeparation = d;
        }
      }
    }

    cruciata.step(6);
    const finalSquad = cruciata
      .snapshot()
      .units.filter((u) => knightIds.includes(u.id));
    const allArrived = finalSquad.every(
      (u) => Math.hypot(u.x - target.x, u.y - target.y) < 140,
    );
    const finalSeparate = finalSquad.every((u, i) =>
      finalSquad.every(
        (v, j) => i === j || Math.hypot(u.x - v.x, u.y - v.y) > 22,
      ),
    );

    return {
      minSeparation,
      anyMovedBackward,
      allArrived,
      finalSeparate,
    };
  });

  expect(result.anyMovedBackward).toBe(false);
  expect(result.minSeparation).toBeGreaterThanOrEqual(20);
  expect(result.allArrived).toBe(true);
  expect(result.finalSeparate).toBe(true);
});

test("tactical force drives archers away from threats and pulls melee troops towards enemies", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.sites = [];
      s.cities = [];
      s.enemy.think = 1e9;
      // Spawn player archer at 1400, player sword at 1420
      // Spawn enemy sword at 1500
      s.units = [
        {
          id: 91001,
          team: 0,
          type: "archer",
          x: 1400,
          y: 2600,
          hp: 300,
          maxHp: 300,
          stance: "fight",
          order: null,
          target: null,
        },
        {
          id: 91002,
          team: 0,
          type: "sword",
          x: 1420,
          y: 2650,
          hp: 450,
          maxHp: 450,
          stance: "fight",
          order: null,
          target: null,
        },
        {
          id: 91003,
          team: 1,
          type: "sword",
          x: 1500,
          y: 2600,
          hp: 450,
          maxHp: 450,
          stance: "fight",
          order: null,
          target: null,
        },
      ];
    });

    // Step 1.5 seconds in fight stance
    cruciata.step(1.5);
    const s1 = cruciata.snapshot().units;
    const archer = s1.find((u) => u.id === 91001);
    const sword = s1.find((u) => u.id === 91002);
    const enemy = s1.find((u) => u.id === 91003);

    // Melee sword should have moved closer to enemy (advanced eastward > 1425)
    const swordAdvanced = sword.x > 1425;

    // Archer should NOT have charged into melee range (< 40px of enemy)
    const archerDistance = Math.hypot(archer.x - enemy.x, archer.y - enemy.y);
    const archerKeptDistance = archerDistance > 80;

    // Now test "hold" stance on archer: does not move
    cruciata.scenario((s) => {
      const a = s.units.find((u) => u.id === 91001);
      a.x = 1400;
      a.y = 2600;
      a.stance = "hold";
      a.hold = true;
      a.order = null;
      a.target = null;
      // Enemy closer at 1460
      const e = s.units.find((u) => u.id === 91003);
      e.x = 1460;
      e.y = 2600;
      e.hold = true;
      e.stance = "hold";
    });

    cruciata.step(1.5);
    const s2 = cruciata.snapshot().units;
    const holdArcher = s2.find((u) => u.id === 91001);
    const holdMaintained = Math.abs(holdArcher.x - 1400) < 3;

    return {
      swordAdvanced,
      archerKeptDistance,
      holdMaintained,
    };
  });

  expect(result.swordAdvanced).toBe(true);
  expect(result.archerKeptDistance).toBe(true);
  expect(result.holdMaintained).toBe(true);
});
