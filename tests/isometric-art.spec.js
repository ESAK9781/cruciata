const { test, expect } = require("./helpers");

test("hidden roof gables do not paint pale patches over visible tiles", async ({
  page,
}) => {
  await page.goto("/?test");
  const color = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 240;
    const g = c.getContext("2d");
    g.translate(120, 150);
    const m = CruciataArt.projectedModel(g, Math.PI / 6);
    m.roof(0, 0, 20, 80, 100, 28);
    m.paint();
    return [...g.getImageData(145, 90, 1, 1).data];
  });
  expect(color[3]).toBe(255);
  expect(color[0]).toBeGreaterThan(color[1] * 1.4);
});

test("projected assets retain complete silhouettes through factions, construction and destruction", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const A = CruciataArt,
      failures = [];
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d");
    const drawImage = g.drawImage.bind(g);
    let label = "";
    g.drawImage = (source, ...args) => {
      if (source instanceof HTMLCanvasElement) {
        const q = source.getContext("2d"),
          w = source.width,
          h = source.height;
        const borders = [
          q.getImageData(0, 0, w, 1).data,
          q.getImageData(0, h - 1, w, 1).data,
          q.getImageData(0, 0, 1, h).data,
          q.getImageData(w - 1, 0, 1, h).data,
        ];
        if (borders.some((p) => p.some((v, i) => i % 4 === 3 && v > 0)))
          failures.push({ clippedSprite: label });
      }
      drawImage(source, ...args);
    };
    const check = (name, draw) => {
      label = name;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 512, 512);
      draw();
      const p = g.getImageData(0, 0, 512, 512).data;
      let count = 0,
        edge = 0;
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 512; x++)
          if (p[(y * 512 + x) * 4 + 3]) {
            count++;
            if (x < 3 || y < 3 || x > 508 || y > 508) edge++;
          }
      if (count < 35 || edge) failures.push({ label, count, edge });
    };
    const kinds = [
      "house",
      "farm",
      "mill",
      "lumbercamp",
      "miningcamp",
      "barracks",
      "stable",
      "chapel",
      "tower",
      "watchtower",
      "siegeworkshop",
      "towncenter",
      "fort",
      "gate",
      "wall",
      "greatengine",
    ];
    for (const kind of kinds)
      for (const team of [0, 1, 2, 3])
        for (const stage of [1, 0.55, 0]) {
          const b = {
            kind,
            team,
            x: 256,
            y: 280,
            w: 140,
            h: 120,
            hp: stage ? 1000 : 0,
            maxHp: 1000,
            progress: stage || 1,
            id: 9,
            fortified: kind === "wall",
            bastionGate: kind === "gate",
            gateAngle: 0.55,
          };
          const before = JSON.stringify(b);
          check(`${kind}/${team}/${stage}`, () => A.structure(g, b, 2));
          if (JSON.stringify(b) !== before) failures.push({ mutation: kind });
        }
    for (const type of [
      "worker",
      "civilian",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "pilgrim",
      "merchant",
      "ram",
      "ballista",
      "trebuchet",
    ])
      for (const angle of [0, 0.8, 2.5, 4.4]) {
        check(`${type}/${angle}`, () => {
          g.translate(256, 280);
          const u = {
            type,
            team: 0,
            rank: 2,
            moving: true,
            anim: 1,
            strike: 0.3,
            deployment: "deployed",
          };
          if (["ram", "ballista", "trebuchet"].includes(type))
            A.siegeMachine(g, u, 2, angle);
          else if (["pilgrim", "merchant"].includes(type))
            A.caravan(g, u, 2, angle);
          else A.unit(g, u, 2, angle);
        });
      }
    for (const kind of ["wood", "food", "gold", "stone"])
      check(kind, () =>
        A.resource(g, { kind, x: 256, y: 280, remaining: 100, id: 3 }),
      );
    for (const kind of ["towncenter", "fort"])
      check(`large ${kind}`, () =>
        A.structure(
          g,
          {
            kind,
            x: 256,
            y: 280,
            w: 300,
            h: 260,
            hp: 1000,
            progress: 1,
            team: 1,
          },
          0,
        ),
      );
    check("ship", () => A.ship(g, 256, 280, 2));
    check("bridge", () => A.bridge(g, 256, 280));
    return failures;
  });
  expect(result).toEqual([]);
});

test("depth ordering preserves local transforms and always places health overlays above models", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const A = CruciataArt;
    const paint = (queued) => {
      const c = document.createElement("canvas");
      c.width = c.height = 400;
      const g = c.getContext("2d");
      const b = {
        kind: "house",
        x: 180,
        y: 220,
        w: 100,
        h: 80,
        team: 0,
        hp: 1000,
        progress: 1,
      };
      const u = {
        type: "knight",
        x: 180,
        y: 190,
        team: 1,
        rank: 1,
        moving: false,
        angle: 0.3,
      };
      const unit = () => {
        g.save();
        g.translate(u.x, u.y);
        g.scale(0.72, 0.72);
        A.unit(g, u, 0);
        g.restore();
      };
      const structure = () => A.structure(g, b, 0);
      const overlay = () => {
        g.fillStyle = "#ff00ff";
        g.fillRect(178, 170, 4, 4);
      };
      if (queued) {
        A.beginFrame(g);
        structure();
        unit();
        A.deferOverlay(g, overlay);
        A.flushFrame();
      } else {
        unit();
        structure();
        overlay();
      }
      return c.toDataURL();
    };
    const first = paint(true),
      expected = paint(false);
    return { same: first === expected, repeat: first === paint(true) };
  });
  expect(result).toEqual({ same: true, repeat: true });
});

test("shared sprite caches stay bounded and captured Islamic architecture retains its model", async ({
  page,
}) => {
  await page.goto("/?test&bake");
  const result = await page.evaluate(() => {
    const A = CruciataArt,
      c = document.createElement("canvas");
    c.width = c.height = 400;
    const g = c.getContext("2d");
    for (let i = 0; i < 450; i++)
      A.structure(
        g,
        {
          kind: "house",
          x: 180,
          y: 220,
          w: 60 + i * 0.05,
          h: 60,
          team: i % 4,
          hp: 1000,
          progress: 1,
        },
        0,
      );
    const stats = A.spriteStats();
    const paint = (architecture) => {
      g.clearRect(0, 0, 400, 400);
      A.structure(
        g,
        {
          kind: "chapel",
          x: 180,
          y: 220,
          w: 80,
          h: 100,
          team: 0,
          architecture,
          hp: 1000,
          progress: 1,
        },
        0,
      );
      return c.toDataURL();
    };
    return { stats, distinct: paint("islamic") !== paint(undefined) };
  });
  expect(result.stats.entries).toBeLessThanOrEqual(384);
  expect(result.stats.pixels).toBeLessThanOrEqual(16000000);
  expect(result.distinct).toBe(true);
});

test("the campaign renders new models and portraits without changing owned building selection", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  const b = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(4);
    const b = cruciata
      .snapshot()
      .buildings.find((b) => b.team === 0 && b.kind === "towncenter");
    cruciata.camera(b.x, b.y);
    return b;
  });
  const point = await page.evaluate((b) => cruciata.project(b.x, b.y), b);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#selection-title")).toContainText("Town");
  const border = await page.evaluate(() => {
    const c = document.getElementById("selection-icon"),
      p = c.getContext("2d").getImageData(0, 0, 74, 74).data;
    let count = 0;
    for (let y = 0; y < 74; y++)
      for (let x = 0; x < 74; x++)
        if ((x < 2 || y < 2 || x > 71 || y > 71) && p[(y * 74 + x) * 4 + 3])
          count++;
    return count;
  });
  expect(border).toBe(0);
  expect(errors).toEqual([]);
});

test("raised silhouettes accept selection and attack orders and every unit portrait fits", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  const targets = await page.evaluate(async () => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.team === 0 && u.type === "sword"),
        b = s.buildings.find((b) => b.team === 0 && b.kind === "towncenter"),
        enemy = s.buildings.find(
          (b) => b.team === 1 && b.kind === "towncenter",
        );
      s.units = [
        { ...u, id: 99001, x: 1400, y: 2500, order: null, target: null },
        {
          ...u,
          id: 99002,
          type: "knight",
          team: 1,
          x: 1700,
          y: 2700,
          hp: 10000,
          maxHp: 10000,
          angle: -Math.PI / 2,
        },
      ];
      s.buildings = [
        { ...b, x: 1000, y: 2500 },
        enemy,
        {
          ...b,
          id: 99003,
          kind: "tower",
          team: 1,
          x: 1800,
          y: 2500,
          w: 48,
          h: 48,
        },
      ];
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.campaignRules = null;
      s.enemy.think = 1e9;
      s.cheats = { reveal: true };
    });
    cruciata.camera(1500, 2550);
    const s = cruciata.snapshot(),
      tower = s.buildings.find((b) => b.id === 99003),
      knight = s.units.find((u) => u.id === 99002);
    const g = document.createElement("canvas").getContext("2d");
    CruciataArt.structure(g, tower, 0);
    CruciataArt.unit(g, knight, 0, knight.visualAngle ?? knight.angle);
    await CruciataAtlas.ready;
    const find = (o, test) => {
      for (let y = o.y - 80; y < o.y - 32; y += 2)
        for (let x = o.x - 12; x < o.x + 12; x += 2)
          if (test(o, { x, y })) return { x, y };
      throw Error("missing raised silhouette");
    };
    const roof = find(tower, CruciataArt.hitStructure),
      head = find(knight, CruciataArt.hitUnit);
    cruciata.order([99001], roof);
    const buildingTarget = cruciata
      .snapshot()
      .units.find((u) => u.id === 99001).target;
    cruciata.order([99001], head);
    const unitTarget = cruciata
      .snapshot()
      .units.find((u) => u.id === 99001).target;
    return { buildingTarget, unitTarget };
  });
  expect(targets).toEqual({ buildingTarget: 99003, unitTarget: 99002 });
  for (const type of [
    "worker",
    "civilian",
    "sword",
    "archer",
    "knight",
    "chaplain",
    "standard",
    "ram",
    "ballista",
    "trebuchet",
    "merchant",
    "pilgrim",
  ]) {
    const p = await page.evaluate((type) => {
      cruciata.scenario((s) => {
        const u = s.units[0];
        s.units = [
          {
            ...u,
            type,
            x: 1400,
            y: 2500,
            angle: -Math.PI / 2,
            visualAngle: -Math.PI / 2,
            rank: 0,
            order: null,
            target: null,
            strike: 0,
            moving: false,
            deployment: "deployed",
            deployTimer: 0,
          },
        ];
      });
      return cruciata.project(1400, 2500);
    }, type);
    await page.mouse.click(p.x, p.y);
    await page.evaluate(() => CruciataAtlas.ready);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = document.getElementById("selection-icon"),
            data = c.getContext("2d").getImageData(0, 0, 74, 74).data;
          return [...data].filter((v, i) => i % 4 === 3 && v > 0).length;
        }),
      )
      .toBeGreaterThan(20);
    const result = await page.evaluate(() => {
      const c = document.getElementById("selection-icon"),
        p = c.getContext("2d").getImageData(0, 0, 74, 74).data;
      let border = 0,
        filled = 0;
      for (let y = 0; y < 74; y++)
        for (let x = 0; x < 74; x++)
          if (p[(y * 74 + x) * 4 + 3]) {
            filled++;
            if (x < 1 || y < 1 || x > 72 || y > 72) border++;
          }
      return { border, filled, selected: cruciata.snapshot().selected };
    });
    expect(result.selected, type).toEqual([99001]);
    expect(result.border, type).toBe(0);
    expect(result.filled, type).toBeGreaterThan(20);
  }
});
