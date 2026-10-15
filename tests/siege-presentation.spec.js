const { test, expect } = require("./helpers");
async function start(page) {
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.nodes = [];
      s.decorations = [];
      s.cities = [];
      s.sites = [];
      s.campaignRules = null;
      s.enemy.think = 1e9;
      s.regionalThink = 1e9;
      const template = s.buildings[0],
        unit = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = [
        {
          ...unit,
          id: 99803,
          type: "trebuchet",
          x: 1500,
          y: 2850,
          deployment: "deployed",
          cooldown: 0,
          order: null,
          target: null,
          stance: "fight",
        },
      ];
      s.buildings = s.buildings.filter(
        (b) => b.kind === "towncenter" && b.team < 2,
      );
      s.buildings.push({
        ...template,
        id: 99801,
        kind: "greatengine",
        x: 1500,
        y: 2600,
        w: 162,
        h: 140,
        r: 81,
        hp: 6000,
        maxHp: 6000,
        guardCooldown: 0,
        aimAngle: -Math.PI / 2,
        queue: [],
      });
      window.siegeSounds = [];
      const play = CruciataAudio.play.bind(CruciataAudio);
      CruciataAudio.play = (kind, volume) => {
        window.siegeSounds.push({ kind, volume });
        return play(kind, volume);
      };
    });
    cruciata.camera(1800, 2680);
  });
}
async function click(page, x, y, button = "left") {
  const p = await page.evaluate(({ x, y }) => cruciata.project(x, y), { x, y });
  await page.mouse.click(p.x, p.y, { button });
}
test("great engines bombard empty ground, swivel before firing, and cancel targets", async ({
  page,
}) => {
  await start(page);
  await click(page, 1500, 2600);
  await expect(page.locator("#cancel-targeting-button")).toBeVisible();
  await expect(page.locator("#cancel-targeting-button")).toBeDisabled();
  await click(page, 2000, 2650, "right");
  const turning = await page.evaluate(() => {
    cruciata.step(0.2);
    return cruciata.snapshot();
  });
  const engine = turning.buildings.find((b) => b.id === 99801);
  expect(Math.abs(engine.fireTarget.x - 2000)).toBeLessThan(2);
  expect(engine.aimAngle).toBeGreaterThan(-Math.PI / 2);
  expect(turning.boulders.filter((b) => b.source === 99801)).toHaveLength(0);
  const fired = await page.evaluate(() => {
    cruciata.step(2);
    return cruciata.snapshot();
  });
  const shell = fired.boulders.find((b) => b.source === 99801);
  expect(shell).toBeDefined();
  expect(Math.abs(shell.tx - 2000)).toBeLessThan(2);
  expect(shell.heavy).toBe(true);
  await page.locator("#cancel-targeting-button").click();
  expect(
    (await page.evaluate(() => cruciata.snapshot())).buildings.find(
      (b) => b.id === 99801,
    ).fireTarget,
  ).toBeNull();
  await expect(page.locator("#cancel-targeting-button")).toBeDisabled();
  await click(page, 1500, 2850);
  await click(page, 1950, 2850, "right");
  await expect(page.locator("#cancel-targeting-button")).toBeEnabled();
  await page.locator("#cancel-targeting-button").click();
  const trebuchet = (await page.evaluate(() => cruciata.snapshot())).units.find(
    (u) => u.id === 99803,
  );
  expect(trebuchet.fireTarget).toBeNull();
  expect(trebuchet.manualTarget).toBe(false);
});
test("siege landings play audible recordings and trails stay behind projectile heads", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.recordedImpacts = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const item = { src: this.src, volume: this.volume, resolved: false };
      window.recordedImpacts.push(item);
      return play.call(this).then(() => {
        item.resolved = true;
      });
    };
    cruciata.scenario((s) => {
      s.units = [];
      s.buildings.find((b) => b.id === 99801).guardCooldown = 100;
      s.boulders = [
        {
          sx: 1500,
          sy: 2600,
          tx: 2900,
          ty: 2600,
          x: 1500,
          y: 2600,
          t: 0,
          duration: 4,
          heavy: true,
          team: 0,
          source: 99801,
          damage: 650,
          r: 230,
        },
      ];
    });
    window.drawLayers = [];
    const particle = CruciataArt.particle,
      ellipse = CruciataArt.ellipse;
    CruciataArt.particle = (...args) => {
      window.drawLayers.push("particle");
      return particle(...args);
    };
    CruciataArt.ellipse = (...args) => {
      if (args[5] === "#2b2623") window.drawLayers.push("head");
      return ellipse(...args);
    };
    cruciata.camera(2200, 2600);
    cruciata.step(1.5);
  });
  await expect
    .poll(() => page.evaluate(() => window.drawLayers.includes("head")))
    .toBe(true);
  const trail = await page.evaluate(() => {
    const s = cruciata.snapshot(),
      stone = s.boulders[0];
    return {
      points: s.particles.filter((p) => p.trail),
      headX: stone.sx + ((stone.tx - stone.sx) * stone.t) / stone.duration,
      layers: window.drawLayers.slice(),
    };
  });
  expect(trail.points.length).toBeGreaterThan(0);
  expect(
    trail.points.every((p) => p.x < trail.headX && p.sprite === "smoke_04"),
  ).toBe(true);
  expect(trail.layers.indexOf("particle")).toBeLessThan(
    trail.layers.indexOf("head"),
  );
  const impact = await page.evaluate(() => {
    cruciata.step(2.6);
    return { s: cruciata.snapshot(), sounds: window.siegeSounds };
  });
  expect(
    impact.sounds.some((s) => s.kind === "great-impact" && s.volume > 0.6),
  ).toBe(true);
  expect(impact.s.particles.some((p) => p.sprite === "smoke_01")).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.recordedImpacts.some(
          (p) =>
            p.src.includes("great-landing.wav") && p.volume > 0.3 && p.resolved,
        ),
      ),
    )
    .toBe(true);
});
test("Kenney particle and new audio files decode, and enemy silhouettes differ by architecture", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const context = new AudioContext(),
      durations = [];
    for (const name of [
      "explosionCrunch_002",
      "explosionCrunch_003",
      "impactWood_heavy_001",
      "impactMetal_heavy_001",
      "impactGlass_heavy_000",
      "lowFrequency_explosion_001",
    ]) {
      const response = await fetch(`assets/audio/${name}.ogg`);
      durations.push(
        (await context.decodeAudioData(await response.arrayBuffer())).duration,
      );
    }
    await context.close();
    const particles = await Promise.all(
      [
        "smoke_01",
        "smoke_04",
        "dirt_01",
        "spark_01",
        "light_02",
        "flame_01",
      ].map(async (name) => {
        const image = new Image();
        image.src = `assets/particles/${name}.png`;
        await image.decode();
        return image.naturalWidth;
      }),
    );
    const paint = (kind, team, fortified = false) => {
      const c = document.createElement("canvas");
      c.width = c.height = 360;
      const g = c.getContext("2d");
      CruciataArt.structure(
        g,
        {
          kind,
          team,
          fortified,
          x: 180,
          y: 180,
          w: 120,
          h: 100,
          hp: 6000,
          maxHp: 6000,
          progress: 1,
          id: 1,
        },
        0,
      );
      return c.toDataURL();
    };
    return {
      durations,
      particles,
      different: [
        "house",
        "barracks",
        "stable",
        "chapel",
        "towncenter",
        "tower",
        "siegeworkshop",
      ].map((kind) => paint(kind, 0) !== paint(kind, 1)),
      dark: paint("wall", 0, true) !== paint("wall", 0, false),
    };
  });
  expect(result.durations.every((n) => n > 0)).toBe(true);
  expect(result.particles.every((n) => n === 512)).toBe(true);
  expect(result.different.every(Boolean)).toBe(true);
  expect(result.dark).toBe(true);
});

test("projectile artwork grows at the apex while its damage radius stays fixed", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    window.projectileSizes = [];
    const ellipse = CruciataArt.ellipse;
    CruciataArt.ellipse = (g, x, y, rx, ry, color) => {
      if (color === "#2b2623" || color === "#c8451c") {
        const m = g.getTransform();
        window.projectileSizes.push(rx * Math.hypot(m.a, m.b));
      }
      return ellipse(g, x, y, rx, ry, color);
    };
  });
  for (const heavy of [false, true]) {
    const sizes = [];
    for (const fraction of [0.02, 0.5, 0.98]) {
      await page.evaluate(
        ({ heavy, fraction }) => {
          cruciata.scenario((s) => {
            s.units = [];
            s.buildings.find((b) => b.id === 99801).guardCooldown = 100;
            s.boulders = [
              {
                sx: 1700,
                sy: 2600,
                tx: 2100,
                ty: 2600,
                x: 1700,
                y: 2600,
                t: fraction * 4,
                duration: 4,
                r: heavy ? 230 : 120,
                heavy,
                team: 0,
                source: 99801,
                damage: 650,
              },
            ];
          });
          window.projectileSizes = [];
        },
        { heavy, fraction },
      );
      await expect
        .poll(() => page.evaluate(() => window.projectileSizes.length))
        .toBeGreaterThan(0);
      sizes.push(await page.evaluate(() => window.projectileSizes.at(-1)));
      expect(
        (await page.evaluate(() => cruciata.snapshot())).boulders[0].r,
      ).toBe(heavy ? 230 : 120);
    }
    expect(sizes[1] / sizes[0]).toBeGreaterThan(1.25);
    expect(sizes[1] / sizes[0]).toBeLessThan(1.31);
    expect(sizes[2] / sizes[0]).toBeCloseTo(1, 2);
  }
});

test("raised siege models render locally, turn, and animate their mechanisms", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    const paint = (type, time, angle) => {
      const c = document.createElement("canvas");
      c.width = c.height = 400;
      const g = c.getContext("2d");
      g.translate(200, 260);
      if (type === "greatengine")
        CruciataArt.greatEngine(
          g,
          { x: 0, y: 0, kind: type, team: 0, lastShot: 0, aimAngle: angle },
          time,
        );
      else
        CruciataArt.siegeMachine(
          g,
          { type, team: 0, moving: true, strike: 0.3 },
          time,
          angle,
        );
      const data = g.getImageData(0, 0, 400, 400).data;
      let minY = 400,
        maxY = 0,
        count = 0;
      for (let i = 3; i < data.length; i += 4)
        if (data[i] > 200) {
          const y = Math.floor(i / 4 / 400);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          count++;
        }
      return { url: c.toDataURL(), minY, maxY, count };
    };
    const poses = ["greatengine", "ram", "ballista"].map((type) => {
      const a = paint(type, 0.15, 0),
        b = paint(type, 0.5, 0),
        c = paint(type, 0.15, 0.8);
      return {
        type,
        count: a.count,
        height: a.maxY - a.minY,
        animated: a.url !== b.url,
        turns: a.url !== c.url,
      };
    });
    window.mobileSiegeDraws = [];
    const draw = CruciataArt.siegeMachine;
    CruciataArt.siegeMachine = (g, u, ...rest) => {
      window.mobileSiegeDraws.push(u.type);
      return draw(g, u, ...rest);
    };
    cruciata.scenario((s) => {
      const template = s.units[0];
      s.units = [
        { ...template, type: "ram", id: 99804, x: 1500, y: 2600 },
        { ...template, type: "ballista", id: 99805, x: 1700, y: 2600 },
      ];
    });
    return poses;
  });
  for (const pose of result) {
    expect(pose.count).toBeGreaterThan(1000);
    expect(pose.animated).toBe(true);
    expect(pose.turns).toBe(true);
    expect(pose.height).toBeGreaterThan(pose.type === "greatengine" ? 130 : 40);
  }
  await expect
    .poll(() => page.evaluate(() => new Set(window.mobileSiegeDraws).size))
    .toBe(2);
});

test("player trebuchet movement and target changes preserve manual deployment", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    cruciata.scenario((s) => {
      const u = s.units[0];
      u.deployment = "packed";
      u.order = null;
      u.fireTarget = null;
      u.target = null;
      u.manualTarget = false;
    });
    cruciata.order([99803], { x: 1900, y: 2850 });
    cruciata.step(8);
    const moved = cruciata.snapshot().units.find((u) => u.id === 99803);
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.id === 99803);
      u.x = 1500;
      u.y = 2850;
      u.deployment = "deployed";
      u.order = null;
      u.target = null;
      u.cooldown = 100;
    });
    cruciata.order([99803], { x: 2600, y: 2850 });
    cruciata.step(1);
    const stationary = cruciata.snapshot().units.find((u) => u.id === 99803);
    cruciata.scenario((s) => {
      const u = s.units.find((u) => u.id === 99803);
      s.units.push({
        ...u,
        id: 99806,
        type: "worker",
        team: 1,
        x: 2400,
        y: 2850,
        job: null,
        order: null,
        target: null,
      });
      u.manualTarget = true;
      u.target = 99806;
    });
    cruciata.step(2);
    const locked = cruciata.snapshot().units.find((u) => u.id === 99803);
    return { moved, stationary, locked };
  });
  expect(result.moved.deployment).toBe("packed");
  expect(result.moved.x).toBeGreaterThan(1600);
  expect(result.stationary.deployment).toBe("deployed");
  expect(result.stationary.x).toBeCloseTo(1500, 0);
  expect(result.locked.deployment).toBe("deployed");
  expect(result.locked.manualTarget).toBe(true);
});

test("siege sprite bounds retain mechanisms and trebuchet setup raises a lower matching frame", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 600;
    const g = c.getContext("2d");
    g.translate(300, 300);
    const draw = g.drawImage.bind(g),
      borders = [];
    g.drawImage = (image, ...args) => {
      if (image instanceof HTMLCanvasElement) {
        const cg = image.getContext("2d");
        const w = image.width,
          h = image.height;
        const edges = [
          cg.getImageData(0, 0, w, 2).data,
          cg.getImageData(0, h - 2, w, 2).data,
          cg.getImageData(0, 0, 2, h).data,
          cg.getImageData(w - 2, 0, 2, h).data,
        ];
        borders.push(
          edges.every((data) => {
            for (let i = 3; i < data.length; i += 4) if (data[i]) return false;
            return true;
          }),
        );
      }
      return draw(image, ...args);
    };
    for (const angle of [0, 0.8, 1.6, 2.4, 3.2, 4])
      for (const time of [0.0, 0.15, 0.28, 0.5, 18])
        CruciataArt.greatEngine(
          g,
          { x: 0, y: 0, team: 0, lastShot: 0, aimAngle: angle },
          time,
        );
    for (const type of ["ram", "ballista"])
      for (const angle of [0, 0.8, 1.6, 2.4, 3.2, 4])
        CruciataArt.siegeMachine(g, { type, team: 0, strike: 0.3 }, 0.2, angle);
    const height = (deployment) => {
      const p = document.createElement("canvas");
      p.width = p.height = 300;
      const pg = p.getContext("2d");
      pg.translate(150, 160);
      CruciataArt.siegeMachine(
        pg,
        { type: "trebuchet", team: 0, deployment, strike: 0 },
        0,
        0,
      );
      const data = pg.getImageData(0, 0, 300, 300).data;
      let first = 300,
        last = 0;
      for (let i = 3; i < data.length; i += 4)
        if (data[i] > 200) {
          const y = Math.floor(i / 4 / 300);
          first = Math.min(first, y);
          last = Math.max(last, y);
        }
      return last - first;
    };
    return { borders, packed: height("packed"), deployed: height("deployed") };
  });
  expect(result.borders.every(Boolean)).toBe(true);
  expect(result.deployed).toBeGreaterThan(result.packed + 10);
  expect(result.deployed).toBeLessThan(100);
});

test("saved bombardment restores its target and migrates the old engine footprint", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      const b = s.buildings.find((b) => b.id === 99801);
      b.w = 232;
      b.h = 200;
      b.r = 116;
      b.fireTarget = { x: 2100, y: 2600 };
      b.guardCooldown = 12;
      b.aimAngle = 0.4;
      delete s.buildings.find((b) => b.team === 1).architecture;
    });
    cruciata.save();
  });
  await page.reload();
  expect(await page.evaluate(() => cruciata.resume())).toBe(true);
  const state = await page.evaluate(() => cruciata.snapshot()),
    engine = state.buildings.find((b) => b.id === 99801);
  expect(engine.w).toBe(162);
  expect(engine.h).toBe(140);
  expect(engine.fireTarget).toEqual({ x: 2100, y: 2600 });
  expect(engine.guardCooldown).toBe(12);
  expect(engine.aimAngle).toBe(0.4);
  expect(state.buildings.find((b) => b.team === 1).architecture).toBe(
    "islamic",
  );
});
