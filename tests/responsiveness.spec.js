const { test, expect } = require("./helpers");

async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
  }, level);
}

test("a large army starts moving on the first live frame of an order", async ({
  page,
}) => {
  await begin(page, 5);
  const result = await page.evaluate(() => {
    const ids = [];
    cruciata.scenario((s) => {
      const base = s.buildings.find(
          (b) => b.team === 0 && b.kind === "towncenter",
        ),
        template = JSON.parse(
          JSON.stringify(
            s.units.find((u) => u.team === 0 && u.type === "sword"),
          ),
        );
      for (let i = 0; i < 90; i++) {
        const u = JSON.parse(JSON.stringify(template));
        Object.assign(u, {
          id: 900000 + i,
          x: base.x + 260 + (i % 10) * 30,
          y: base.y + 220 + Math.floor(i / 10) * 30,
          order: null,
          path: [],
          target: null,
          job: null,
          stance: "stand-down",
        });
        s.units.push(u);
        ids.push(u.id);
      }
      s.enemy.think = 1e9;
    });
    const before = cruciata.snapshot();
    const origin = new Map(before.units.map((u) => [u.id, { x: u.x, y: u.y }]));
    // A far, walled destination forces a budgeted shared route.
    const enemy = before.buildings.find((b) => b.team === 1);
    cruciata.order(ids, { x: enemy.x, y: enemy.y });
    const costs = cruciata.liveFrame(4);
    const moved = cruciata
      .snapshot()
      .units.filter(
        (u) =>
          ids.includes(u.id) &&
          Math.hypot(u.x - origin.get(u.id).x, u.y - origin.get(u.id).y) > 1,
      ).length;
    return { moved, worst: Math.max(...costs) };
  });
  expect(result.moved).toBeGreaterThan(60);
  expect(result.worst).toBeLessThan(250);
});

test("a plain move order is not abandoned when the troops are struck", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    let ids = [];
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.terrainFeatures = [];
      s.cities = [];
      s.enemy.think = 1e9;
      const sword = s.units.find((u) => u.team === 0 && u.type === "sword"),
        foe =
          s.units.find((u) => u.team === 1 && u.type === "archer") ||
          s.units.find((u) => u.team === 1);
      s.units = [];
      for (let i = 0; i < 4; i++) {
        const u = JSON.parse(JSON.stringify(sword));
        Object.assign(u, {
          id: 91000 + i,
          x: 1300 + i * 28,
          y: 2700,
          hp: 800,
          maxHp: 800,
          order: null,
          path: [],
          stance: "fight",
          target: null,
        });
        s.units.push(u);
        ids.push(u.id);
      }
      for (let i = 0; i < 3; i++) {
        const e = JSON.parse(JSON.stringify(foe));
        Object.assign(e, {
          id: 91100 + i,
          type: "sword",
          team: 1,
          x: 1450 + i * 20,
          y: 2660,
          hp: 8000,
          maxHp: 8000,
          order: null,
          hold: false,
          stance: "fight",
          home: { x: 1450, y: 2660 },
        });
        s.units.push(e);
      }
    });
    cruciata.order(ids, { x: 2200, y: 2700 });
    cruciata.step(6);
    const s = cruciata.snapshot();
    return ids.map((id) => {
      const u = s.units.find((u) => u.id === id);
      return u ? { x: u.x, target: u.target } : null;
    });
  });
  for (const u of result) {
    expect(u).not.toBeNull();
    expect(u.target).toBeNull();
    expect(u.x).toBeGreaterThan(1650);
  }
});

test("curtain footprints match their projected world geometry at every heading", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const out = [];
    const dirs = {
      e: [1, 0],
      w: [-1, 0],
      s: [0, 1],
      n: [0, -1],
      se: [1, 1],
      sw: [-1, 1],
      ne: [1, -1],
      nw: [-1, -1],
    };
    const opposite = (key) =>
      key
        .split("")
        .map((ch) => ({ e: "w", w: "e", n: "s", s: "n" })[ch])
        .join("");
    for (const fortified of [false, true])
      for (const [key, [dx, dy]] of Object.entries(dirs)) {
        const c = document.createElement("canvas");
        c.width = c.height = 260;
        const g = c.getContext("2d");
        g.translate(130, 150);
        CruciataArt.structure(
          g,
          {
            kind: "wall",
            x: 0,
            y: 0,
            w: 32,
            h: 32,
            hp: 1000,
            maxHp: 1000,
            progress: 1,
            team: 0,
            fortified,
            // Arms are half-vectors in world units to the shared seam.
            links: {
              [key]: { x: dx * 16, y: dy * 16 },
              [opposite(key)]: { x: -dx * 16, y: -dy * 16 },
            },
          },
          0,
        );
        const data = g.getImageData(0, 0, 260, 260).data;
        let left = 999,
          right = -999,
          bottom = -999;
        for (let y = 0; y < 260; y++)
          for (let x = 0; x < 260; x++)
            if (data[(y * 260 + x) * 4 + 3] > 20) {
              left = Math.min(left, x - 130);
              right = Math.max(right, x - 130);
              bottom = Math.max(bottom, y - 150);
            }
        // Expected ground footprint: the plinth rectangle swept between the seams.
        const hw = (fortified ? 24 : 15) + 1.5,
          length = Math.hypot(dx, dy),
          ux = dx / length,
          uy = dy / length;
        const half = (dx && dy ? Math.SQRT2 : 1) * 16;
        let xs = [],
          ys = [];
        for (const sign of [-1, 1])
          for (const side of [-1, 1]) {
            xs.push(ux * half * sign - uy * hw * side);
            ys.push((uy * half * sign + ux * hw * side) * 0.72);
          }
        out.push({
          key,
          fortified,
          dl: left - Math.min(...xs),
          dr: right - Math.max(...xs),
          db: bottom - Math.max(...ys),
        });
      }
    return out;
  });
  for (const r of result) {
    // Merlons and lips may overhang a pixel or two; a skewed projection is far larger.
    expect(Math.abs(r.dl), JSON.stringify(r)).toBeLessThan(4);
    expect(Math.abs(r.dr), JSON.stringify(r)).toBeLessThan(4);
    expect(Math.abs(r.db), JSON.stringify(r)).toBeLessThan(4);
  }
});

test("double-clicking a unit selects every unit of its kind on screen", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const sword = s.units.find((u) => u.team === 0 && u.type === "sword"),
        archer = s.units.find((u) => u.team === 0 && u.type === "archer");
      s.units = [];
      s.nodes = [];
      s.decorations = [];
      for (let i = 0; i < 6; i++) {
        const u = JSON.parse(JSON.stringify(i < 4 ? sword : archer));
        Object.assign(u, {
          id: 92000 + i,
          type: i < 4 ? "sword" : "archer",
          x: 1500 + i * 60,
          y: 2600,
          order: null,
        });
        s.units.push(u);
      }
    });
    cruciata.camera(1650, 2600);
  });
  const p = await page.evaluate(() => cruciata.project(1500, 2600));
  await page.mouse.dblclick(p.x, p.y);
  const selected = await page.evaluate(() => cruciata.snapshot().selected);
  expect(selected.sort()).toEqual([92000, 92001, 92002, 92003]);
});

test("a cavalry charge with a long run-up strikes harder than a standing blow", async ({
  page,
}) => {
  await begin(page);
  const damage = async (runUp) =>
    page.evaluate((runUp) => {
      let ids;
      cruciata.scenario((s) => {
        s.nodes = [];
        s.decorations = [];
        s.cities = [];
        s.enemy.think = 1e9;
        const knight =
            s.units.find((u) => u.team === 0 && u.type === "knight") ||
            s.units.find((u) => u.team === 0),
          foe = s.units.find((u) => u.team === 1);
        s.units = [knight, foe];
        Object.assign(knight, {
          type: "knight",
          x: 1500,
          y: 2600,
          hp: 5000,
          maxHp: 5000,
          rank: 0,
          cooldown: 0,
          stance: "fight",
          hold: false,
          order: null,
          runUp,
          runAt: s.time,
        });
        Object.assign(foe, {
          type: "sword",
          x: 1522,
          y: 2600,
          hp: 100000,
          maxHp: 100000,
          hold: true,
          order: null,
          target: null,
          cooldown: 99,
        });
        knight.target = foe.id;
        knight.manualTarget = true;
        ids = [knight.id, foe.id];
      });
      cruciata.step(1 / 30);
      const foe = cruciata.snapshot().units.find((u) => u.id === ids[1]);
      return 100000 - foe.hp;
    }, runUp);
  const standing = await damage(0),
    charged = await damage(300);
  expect(standing).toBeGreaterThan(0);
  expect(charged / standing).toBeGreaterThan(1.4);
});

test("attacks outside the view raise an alert that the Z key jumps to", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.enemy.think = 1e9;
      const sword = s.units.find((u) => u.team === 0 && u.type === "sword"),
        foe = s.units.find((u) => u.team === 1 && u.type === "sword");
      s.units = [sword, foe];
      Object.assign(sword, {
        x: 3000,
        y: 3000,
        hp: 5000,
        maxHp: 5000,
        hold: true,
        order: null,
      });
      Object.assign(foe, {
        x: 3020,
        y: 3000,
        hp: 5000,
        maxHp: 5000,
        hold: false,
        order: null,
        stance: "fight",
        home: { x: 3020, y: 3000 },
      });
    });
    cruciata.camera(600, 600);
  });
  await page.evaluate(() => cruciata.step(3));
  const snap = await page.evaluate(() => cruciata.snapshot());
  expect(snap.alerts?.length).toBeGreaterThan(0);
  await expect(page.locator("#toast")).toContainText("under attack");
  await page.keyboard.press("z");
  const view = await page.evaluate(() => cruciata.snapshot().camera);
  expect(Math.hypot(view.x - 3000, view.y - 3000)).toBeLessThan(200);
});
