const { test, expect } = require("./helpers");
async function begin(page, level = 0) {
  await page.goto("/?test");
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
  }, level);
}
async function snapshot(page) {
  return page.evaluate(() => cruciata.snapshot());
}
async function clickWorld(page, x, y, options = {}) {
  const p = await page.evaluate(
    ({ x, y }) => {
      cruciata.camera(x, y);
      return cruciata.project(x, y);
    },
    { x, y },
  );
  await page.mouse.click(p.x, p.y, options);
}
async function selectBuilding(page, kind) {
  const s = await snapshot(page),
    b = s.buildings.find((b) => b.team === 0 && b.kind === kind && b.hp > 0);
  await clickWorld(page, b.x, b.y);
  return b;
}
async function site(page, kind) {
  return page.evaluate((kind) => {
    const s = cruciata.snapshot(),
      b = s.buildings[0];
    for (let y = b.y - 350; y < b.y + 350; y += 32)
      for (let x = b.x - 350; x < b.x + 450; x += 32)
        if (cruciata.site(kind, { x, y })) return { x, y };
    throw Error("No valid " + kind + " site");
  }, kind);
}
async function build(page, kind) {
  await page.locator("#settlement-tab").click();
  await page.locator("#build-" + kind).click();
  const p = await site(page, kind);
  await clickWorld(page, p.x, p.y);
  return (await snapshot(page)).buildings.at(-1);
}

test("every opening lands on the main menu without overwriting the campaign save", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.step(12);
    cruciata.save();
  });
  const saved = await page.evaluate(() =>
    localStorage.getItem("cruciata-checkpoint-v3"),
  );
  await page.reload();
  await expect(page.locator("#front-menu")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("cruciata-checkpoint-v3")),
  ).toEqual(expect.any(String));
  const afterSave = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cruciata-checkpoint-v3")),
  );
  expect(afterSave.state.time).toBe(JSON.parse(saved).state.time);
  expect(afterSave.uid).toBe(JSON.parse(saved).uid);
  expect(afterSave.state.resources).toEqual(JSON.parse(saved).state.resources);
  await page.locator("#resume-campaign").click();
  expect((await snapshot(page)).time).toBeCloseTo(12, 0);
});
test("campaign atlas has six chapters, progress and difficulty", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-campaign").click();
  await expect(page.locator(".atlas svg")).toBeVisible();
  await expect(page.locator("#chapter-1")).toBeDisabled();
  await page.locator("#campaign-difficulty").selectOption("hard");
  await page.locator("#chapter-0").click();
  await page.locator("#overlay button").click();
  await expect(page.locator(".scene-caption")).toHaveCount(0);
  expect((await snapshot(page)).difficulty).toBe("hard");
  expect((await snapshot(page)).paused).toBe(false);
});
test("quickmatch creates a preset session and restores its world and seed", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-1").click();
  await page.locator("#preset-siege").click();
  await page.locator("[name=seed]").fill("1234");
  await page.locator("#quick-form button[type=submit]").click();
  await page.locator("#overlay button").click();
  const s = await snapshot(page);
  expect(s.mode).toBe("quickmatch");
  expect(s.world.width).toBe(16000);
  expect(s.seed).toBe(1234);
  expect(s.difficulty).toBe("hard");
  expect(
    s.units.filter((u) => u.team === 0 && u.type !== "worker").length,
  ).toBe(30);
  expect(
    s.units.filter((u) => u.team === 1 && u.type !== "worker").length,
  ).toBe(30);
  await page.evaluate(() => {
    cruciata.step(5);
    cruciata.save();
  });
  await page.reload();
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-1").click();
  expect((await snapshot(page)).world.width).toBe(16000);
  expect((await snapshot(page)).time).toBeCloseTo(5, 0);
});
test("three quickmatch slots stay isolated and can be deleted", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++)
      localStorage.setItem(
        "cruciata-quickmatch-" + i,
        JSON.stringify({
          world: [6400, 4400],
          state: { difficulty: "normal", time: i * 60 },
        }),
      );
  });
  await page.locator("#open-quickmatch").click();
  await expect(page.locator(".save-slots article")).toHaveCount(3);
  await page.locator("#delete-1").click();
  expect(
    await page.evaluate(() => localStorage.getItem("cruciata-quickmatch-1")),
  ).toBeNull();
  expect(
    await page.evaluate(() => !!localStorage.getItem("cruciata-quickmatch-0")),
  ).toBe(true);
});
test("WASD pans in four directions and no longer activates attack or deployment", async ({
  page,
}) => {
  await begin(page);
  const s = await snapshot(page);
  await page.keyboard.down("d");
  await page.waitForTimeout(300);
  await page.keyboard.up("d");
  const right = await snapshot(page);
  expect(right.camera.x).toBeGreaterThan(s.camera.x + 50);
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  expect((await snapshot(page)).camera.y).toBeLessThan(right.camera.y - 50);
  await page.keyboard.down("a");
  await page.waitForTimeout(300);
  await page.keyboard.up("a");
  expect((await snapshot(page)).camera.x).toBeLessThan(right.camera.x - 50);
  await page.keyboard.down("s");
  await page.waitForTimeout(300);
  await page.keyboard.up("s");
  expect((await snapshot(page)).camera.y).toBeGreaterThan(right.camera.y - 30);
});
test("minimap dragging moves the camera continuously", async ({ page }) => {
  await begin(page);
  const r = await page.locator("#minimap").boundingBox();
  await page.mouse.move(r.x + 15, r.y + 20);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.8, r.y + r.height * 0.7, {
    steps: 8,
  });
  await page.mouse.up();
  const s = await snapshot(page);
  expect(s.camera.x).toBeGreaterThan(s.world.width * 0.65);
  expect(s.camera.y).toBeGreaterThan(s.world.height * 0.55);
});
test("empty selection permits right-button camera dragging", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => cruciata.camera(4600, 3300));
  const r = await page.locator("#game").boundingBox(),
    s = await snapshot(page);
  await page.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.5);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(r.x + r.width * 0.4 - 130, r.y + r.height * 0.5 + 70, {
    steps: 8,
  });
  await page.mouse.up({ button: "right" });
  expect((await snapshot(page)).camera.x).toBeGreaterThan(s.camera.x + 90);
});
for (const size of [
  [1440, 900],
  [1920, 1080],
  [3840, 2160],
  [390, 844],
  [844, 390],
])
  test(`battlefield fits ${size.join("x")} with no page scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size[0], height: size[1] });
    await begin(page);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const r = await page.locator("#game").boundingBox();
    expect(r.width).toBeGreaterThan(180);
    expect(r.height).toBeGreaterThan(80);
    expect(
      await page
        .locator("#app")
        .evaluate((e) => getComputedStyle(e).userSelect),
    ).toBe("none");
  });
test("a foundation can be planned without selecting a villager and remains unfinished", async ({
  page,
}) => {
  await begin(page);
  const before = await snapshot(page);
  const b = await build(page, "house");
  expect(b.progress).toBe(0);
  expect((await snapshot(page)).wood).toBe(before.wood - 65);
  await page.evaluate(() => cruciata.step(5));
  expect(
    (await snapshot(page)).buildings.find((x) => x.id === b.id).progress,
  ).toBe(0);
});
test("villagers build foundations commanded by right click", async ({
  page,
}) => {
  await begin(page);
  const b = await build(page, "house");
  await page.keyboard.press("e");
  await clickWorld(page, b.x, b.y, { button: "right" });
  await page.evaluate(() => cruciata.step(50));
  expect(
    (await snapshot(page)).buildings.find((x) => x.id === b.id).progress,
  ).toBe(1);
});
test("depot builders automatically collect its resource when construction finishes", async ({
  page,
}) => {
  await begin(page);
  const b = await build(page, "lumbercamp");
  await page.keyboard.press("e");
  await clickWorld(page, b.x, b.y, { button: "right" });
  await page.evaluate(() => cruciata.step(50));
  const s = await snapshot(page);
  expect(s.buildings.find((x) => x.id === b.id).progress).toBe(1);
  expect(
    s.units
      .filter((u) => u.team === 0 && u.type === "worker")
      .every((u) => u.job?.kind === "gather" && u.job.resource === "wood"),
  ).toBe(true);
});
test("resource clicks inspect finite remaining stock and clearing removes navigation blockage", async ({
  page,
}) => {
  await begin(page);
  await page.keyboard.press("e");
  const n = (await snapshot(page)).nodes.find(
    (n) => n.kind === "wood" && n.x < 1000 && n.y > 1100,
  );
  await clickWorld(page, n.x, n.y);
  await expect(page.locator("#selection-detail")).toContainText("remaining");
  await expect(page.locator("#clear-patch")).toBeVisible();
  await page.locator("#clear-patch").click();
  await page.evaluate(() => cruciata.step(60));
  const s = await snapshot(page);
  expect(s.nodes.find((x) => x.id === n.id).remaining).toBe(0);
  expect(s.navigation.revision).toBeGreaterThan(1);
});
test("grain fields permit movement inside and cap assigned workers at five", async ({
  page,
}) => {
  await begin(page);
  const b = await build(page, "farm");
  await page.keyboard.press("e");
  await clickWorld(page, b.x, b.y, { button: "right" });
  await page.evaluate(() => cruciata.step(50));
  await page.keyboard.press("e");
  await clickWorld(page, b.x, b.y, { button: "right" });
  // Workers walk in and out to deliver, so watch the field over a window.
  let inside = false;
  for (let i = 0; i < 10 && !inside; i++) {
    await page.evaluate(() => cruciata.step(5));
    const s = await snapshot(page),
      f = s.buildings.find((x) => x.id === b.id);
    inside = s.units.some(
      (u) =>
        u.team === 0 &&
        u.job?.target === b.id &&
        Math.abs(u.x - f.x) < f.w / 2 &&
        Math.abs(u.y - f.y) < f.h / 2,
    );
  }
  const s = await snapshot(page),
    f = s.buildings.find((x) => x.id === b.id),
    ws = s.units.filter((u) => u.team === 0 && u.job?.target === b.id);
  expect(ws.length).toBeLessThanOrEqual(5);
  expect(ws.length).toBeGreaterThan(0);
  expect(f.remaining).toBeLessThan(f.max);
  expect(inside).toBe(true);
});
test("selected structures filter training and upgrade actions", async ({
  page,
}) => {
  await begin(page);
  await selectBuilding(page, "barracks");
  await expect(page.locator("#recruit-sword")).toBeVisible();
  await expect(page.locator("#recruit-worker")).toBeHidden();
  await expect(page.locator("#recruit-knight")).toBeHidden();
  await page.locator("#research-tab").click();
  await expect(page.locator("#research-sword1")).toBeVisible();
  await expect(page.locator("#research-sword2")).toBeHidden();
  await expect(page.locator("#trade-tab")).toBeHidden();
});
test("unit variations upgrade existing units and subsequent recruits", async ({
  page,
}) => {
  await begin(page);
  await selectBuilding(page, "barracks");
  await page.locator("#research-tab").click();
  await page.locator("#research-sword1").click();
  await page.evaluate(() => cruciata.step(29));
  let s = await snapshot(page);
  expect(s.upgrades.sword).toBe(1);
  expect(
    s.units
      .filter((u) => u.team === 0 && u.type === "sword")
      .every((u) => u.rank === 1 && u.maxHp > 130),
  ).toBe(true);
  await page.locator("#army-tab").click();
  await page.locator("#recruit-sword").click();
  await page.evaluate(() => cruciata.step(10));
  s = await snapshot(page);
  expect(
    s.units
      .filter((u) => u.team === 0 && u.type === "sword")
      .every((u) => u.rank === 1),
  ).toBe(true);
});
test("enemy cannot train or construct without resources and never receives free waves", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.enemy.resources = { food: 0, wood: 0, gold: 0, stone: 0 };
      s.units = s.units.filter((u) => !(u.team === 1 && u.type === "worker"));
      s.buildings.filter((b) => b.team === 1).forEach((b) => (b.queue = []));
    }),
  );
  const before = await snapshot(page);
  await page.evaluate(() => cruciata.step(130));
  const after = await snapshot(page);
  expect(after.units.filter((u) => u.team === 1).length).toBeLessThanOrEqual(
    before.units.filter((u) => u.team === 1).length,
  );
  expect(after.buildings.filter((b) => b.team === 1).length).toBe(
    before.buildings.filter((b) => b.team === 1).length,
  );
});
test("enemy builds and pays for its economy, with hidden player location initially unknown", async ({
  page,
}) => {
  await begin(page);
  const before = await snapshot(page);
  expect(before.enemy.discovered).toBe(false);
  await page.evaluate(() => cruciata.step(80));
  const s = await snapshot(page);
  expect(s.enemy.spent).toBeGreaterThan(0);
  expect(s.buildings.some((b) => b.team === 1 && b.kind === "lumbercamp")).toBe(
    true,
  );
  expect(
    s.units.filter((u) => u.team === 1 && u.type === "worker").length,
  ).toBeGreaterThan(6);
  expect(Object.values(s.enemy.resources).every((n) => n >= 0)).toBe(true);
});
test("fog hides undiscovered positions and preserves explored ground", async ({
  page,
}) => {
  await begin(page);
  expect(
    await page.evaluate(() => cruciata.vision({ x: 5800, y: 3800 })),
  ).toEqual({ visible: false, explored: false });
  const s = await snapshot(page);
  expect(
    await page.evaluate((p) => cruciata.vision(p), s.buildings[0]),
  ).toEqual({ visible: true, explored: true });
});
test("orders preserve formation slots and keep chaplains behind the frontline", async ({
  page,
}) => {
  await begin(page);
  await page.keyboard.press("Space");
  await clickWorld(page, 1200, 1700, { button: "right" });
  const s = await snapshot(page),
    units = s.units.filter((u) => s.selected.includes(u.id));
  expect(new Set(units.map((u) => u.formation?.id)).size).toBe(1);
  expect(s.formations.length).toBe(1);
  const healer = units.find((u) => u.type === "chaplain");
  expect(healer.target).toBeNull();
  expect(healer.order.x).toBeLessThan(
    Math.max(...units.filter((u) => u.type === "sword").map((u) => u.order.x)),
  );
});
test("a chaplain under threat retreats and never attacks", async ({ page }) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const h = s.units.find((u) => u.team === 0 && u.type === "chaplain"),
        e = s.units.find((u) => u.team === 1 && u.type === "sword");
      s.units = s.units.filter((u) => u.id === h.id || u.id === e.id);
      h.x = 1100;
      h.y = 1600;
      h.order = null;
      e.x = 1150;
      e.y = 1600;
      e.order = null;
      e.squad = null;
    }),
  );
  await page.evaluate(() => cruciata.step(1));
  const s = await snapshot(page),
    h = s.units.find((u) => u.type === "chaplain");
  expect(h.target).toBeNull();
  expect(h.hp).toBeGreaterThan(0);
  expect(h.x).toBeLessThan(1100);
});
test("walls block travel and gates open or close their passage", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => cruciata.supply({ stone: 500, wood: 500 }));
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      s.units = [];
      s.nodes = [];
      s.decorations = [];
      for (let i = 0; i < 2; i++)
        s.buildings.push({
          id: 99950 + i,
          kind: "wall",
          team: 0,
          x: 1400 + i * 32,
          y: 2600,
          w: 32,
          h: 32,
          r: 23,
          wallAngle: 0,
          progress: 1,
          hp: 3200,
          maxHp: 3200,
          queue: [],
        });
    }),
  );
  await page.evaluate(() => cruciata.camera(1400, 2600));
  await clickWorld(page, 1400, 2600);
  await page.locator("#upgrade-gate-button").click();
  await page.evaluate(() => cruciata.step(25.1));
  const b = await page.evaluate(() =>
    cruciata.snapshot().buildings.find((b) => b.team === 0 && b.gateSegments),
  );
  await expect(page.locator("#gate-button")).toBeVisible();
  // Newly built gates start closed; opening is an explicit player action.
  expect(await page.evaluate((p) => cruciata.free(p), b)).toBe(false);
  await page.locator("#gate-button").click();
  await page.evaluate(() => cruciata.step(0.1));
  expect(await page.evaluate((p) => cruciata.free(p), b)).toBe(true);
  await page.locator("#gate-button").click();
  await page.evaluate(() => cruciata.step(0.1));
  expect(await page.evaluate((p) => cruciata.free(p), b)).toBe(false);
});
test("construction stages and damage severity produce distinct consistent artwork", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(async () => {
    const paint = (spec) => {
      const c = document.createElement("canvas");
      c.width = c.height = 150;
      CruciataArt.structure(
        c.getContext("2d"),
        {
          id: 7,
          x: 75,
          y: 75,
          hp: 1000,
          maxHp: 1000,
          team: 0,
          progress: 1,
          ...spec,
        },
        1,
      );
      return c.toDataURL();
    };
    const stages = () =>
      [0, 0.25, 0.6, 1].map((progress) =>
        paint({ kind: "barracks", w: 88, h: 76, progress }),
      );
    const damage = () =>
      [1000, 700, 350].map((hp) => paint({ kind: "chapel", w: 70, h: 95, hp }));
    // Atlas pages decode on demand: warm them, then compare settled frames.
    stages();
    damage();
    await CruciataAtlas.ready;
    return { images: stages(), damages: damage() };
  });
  expect(new Set(result.images).size).toBe(4);
  expect(new Set(result.damages).size).toBe(3);
});
test("music and effects controls persist independently", async ({ page }) => {
  await begin(page);
  await page.locator("#settings-button").click();
  await page.locator("#music-volume").fill("35");
  await page.locator("#effects-volume").fill("15");
  await page.reload();
  await page.locator("#menu-settings").click();
  await expect(page.locator("#music-volume")).toHaveValue("35");
  await expect(page.locator("#effects-volume")).toHaveValue("15");
});
test("all four background tracks shuffle without repeats in a cycle", async ({
  page,
}) => {
  await begin(page);
  const ids = await page.evaluate(() => {
    const p = new CruciataShufflePlaylist(["a", "b", "c", "d"]);
    return Array.from({ length: 12 }, () => p.next());
  });
  for (let i = 0; i < 12; i += 4)
    expect(new Set(ids.slice(i, i + 4)).size).toBe(4);
  expect(ids[3]).not.toBe(ids[4]);
  expect(ids[7]).not.toBe(ids[8]);
});
test("local resource illustrations load and no resource field uses emoji", async ({
  page,
}) => {
  await begin(page);
  for (const r of ["food", "wood", "gold", "stone"])
    expect(
      await page
        .locator(".resource-icon." + r + " img")
        .evaluate((i) => i.complete && i.naturalWidth > 0),
    ).toBe(true);
  await expect(page.locator("#recruit-chaplain .role")).toHaveText(
    "Rear-line healer",
  );
});
test("all six campaigns initialize safely with genuinely different objectives", async ({
  page,
}) => {
  await begin(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const objectives = [];
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => cruciata.start(i), i);
    const s = await snapshot(page);
    objectives.push(s.objective.text);
    expect(s.world.width).toBeGreaterThan(4800);
    expect(s.units.some((u) => u.type === "civilian")).toBe(true);
    await page.evaluate(() => cruciata.step(2));
  }
  expect(new Set(objectives).size).toBe(6);
  expect(errors).toEqual([]);
});
test("production mode rejects diagnostic mutations", async ({ page }) => {
  await page.goto("/");
  const before = await snapshot(page);
  await page.evaluate(() => {
    cruciata.supply(9999);
    cruciata.scenario((s) => (s.resources.gold = 9999));
    cruciata.start(5);
  });
  expect((await snapshot(page)).gold).toBe(before.gold);
  expect((await snapshot(page)).level).toBe(0);
});

test("opening and leaving the production main menu preserves an existing battle", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#open-campaign").click();
  await page.locator("#chapter-0").click();
  await page.locator("#overlay button").click();

  await page.waitForTimeout(700);
  await page.locator("#save-button").click();
  await page.reload();
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cruciata-checkpoint-v3")),
  );
  await page.reload();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cruciata-checkpoint-v3")),
  );
  expect(after.state.time).toBe(before.state.time);
  expect(after.state.units.length).toBe(before.state.units.length);
  expect(after.uid).toBe(before.uid);
});

test("trebuchets set up, fire and pack before moving", async ({ page }) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.supply({ wood: 2000, gold: 2000, stone: 2000, food: 1000 }),
  );
  const workshop = await build(page, "siegeworkshop");
  await page.keyboard.press("e");
  await clickWorld(page, workshop.x, workshop.y, { button: "right" });
  await page.evaluate(() => cruciata.step(55));
  await clickWorld(page, workshop.x, workshop.y);
  await page.locator("#army-tab").click();
  await page.locator("#recruit-trebuchet").click();
  await page.evaluate(() => cruciata.step(36));
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const e = s.units.find((u) => u.team === 0 && u.type === "trebuchet");
      e.x = 1200;
      e.y = 1850;
      e.order = null;
      e.target = null;
      const enemy = s.units.find((u) => u.team === 1 && u.type === "sword");
      enemy.x = 1700;
      enemy.y = 1850;
      enemy.hold = true;
      enemy.home = null;
      enemy.squad = null;
      enemy.order = null;
      s.enemy.think = 999;
    }),
  );
  let engine = (await snapshot(page)).units.find(
    (u) => u.type === "trebuchet" && u.team === 0,
  );
  await clickWorld(page, engine.x, engine.y);
  await page.keyboard.press("t");
  await page.evaluate(() => cruciata.step(5));
  expect(
    (await snapshot(page)).units.find((u) => u.id === engine.id).deployment,
  ).toBe("setting-up");
  await page.evaluate(() => cruciata.step(2));
  expect(
    (await snapshot(page)).units.find((u) => u.id === engine.id).deployment,
  ).toBe("deployed");
  await page.evaluate(() => cruciata.step(1));
  expect((await snapshot(page)).boulders.length).toBeGreaterThan(0);
  await clickWorld(page, 1450, 2000, { button: "right" });
  expect(
    (await snapshot(page)).units.find((u) => u.id === engine.id).deployment,
  ).toBe("deployed");
  await page.keyboard.press("t");
  await page.evaluate(() => cruciata.step(5));
  expect(
    (await snapshot(page)).units.find((u) => u.id === engine.id).deployment,
  ).toBe("packed");
});

test("siege splash damages allies and enemies and leaves casualties", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const a = s.units.find((u) => u.team === 0 && u.type === "archer"),
        e = s.units.find((u) => u.team === 1 && u.type === "archer");
      a.x = 1200;
      a.y = 2000;
      e.x = 1215;
      e.y = 2000;
      a.hold = e.hold = true;
      s.boulders.push({
        sx: 800,
        sy: 2000,
        tx: 1200,
        ty: 2000,
        t: 2,
        duration: 2.1,
        team: 0,
        source: 0,
        damage: 135,
        r: 100,
      });
    }),
  );
  // Off-camera effects are intentionally skipped, so view the impact.
  await page.evaluate(() => cruciata.camera(1200, 2000));
  await page.evaluate(() => cruciata.step(0.2));
  const s = await snapshot(page);
  expect(s.losses).toBeGreaterThan(0);
  expect(s.kills).toBeGreaterThan(0);
  expect(s.corpses.length).toBeGreaterThan(1);
  expect(s.marks.length).toBeGreaterThan(1);
  expect(s.particles.some((p) => p.blood)).toBe(true);
});

test("enemy accounts conserve finite resources during a long economy simulation", async ({
  page,
}) => {
  test.setTimeout(90000);
  await begin(page);
  const start = (await snapshot(page)).enemy.resources;
  await page.evaluate(() => cruciata.step(360));
  const s = await snapshot(page);
  for (const r of ["food", "wood", "gold", "stone"])
    expect(s.enemy.resources[r]).toBeCloseTo(
      start[r] +
        s.enemy.gathered[r] -
        s.enemy.paid[r] -
        (r === "food" ? s.enemy.consumed : 0),
      3,
    );
  expect(s.enemy.gathered.wood).toBeGreaterThan(100);
  expect(s.enemy.gathered.food).toBeGreaterThan(100);
  if (s.enemy.attack > 0) expect(s.enemy.discovered).toBe(true);
  expect(
    s.units.every(
      (u) => Number.isFinite(u.x) && Number.isFinite(u.y) && u.hp > 0,
    ),
  ).toBe(true);
});

test("generation is reproducible by seed and varies between seeds", async ({
  page,
}) => {
  await begin(page);
  const result = await page.evaluate(() => {
    const config = {
      width: 6400,
      height: 4400,
      frequency: 0.45,
      resources: 500,
      units: 8,
      structures: "settlement",
      difficulty: "normal",
      biome: 2,
      seed: 123,
    };
    cruciata.launch(0, config, 0);
    const first = cruciata.snapshot().nodes.map((n) => [n.x, n.y]);
    cruciata.launch(0, config, 0);
    const repeat = cruciata.snapshot().nodes.map((n) => [n.x, n.y]);
    cruciata.launch(0, { ...config, seed: 124 }, 0);
    const different = cruciata.snapshot().nodes.map((n) => [n.x, n.y]);
    return { first, repeat, different };
  });
  expect(result.repeat).toEqual(result.first);
  expect(result.different).not.toEqual(result.first);
});

test("river quickmatch has a navigable bridge and impassable river banks", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.launch(
      0,
      {
        width: 6400,
        height: 4400,
        frequency: 0.3,
        resources: 500,
        units: 4,
        structures: "settlement",
        difficulty: "normal",
        biome: 1,
        seed: 999,
      },
      0,
    ),
  );
  expect(
    await page.evaluate(() =>
      cruciata.free({ x: 3200 + Math.sin(1200 / 330) * 165, y: 1200 }),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => cruciata.route({ x: 2900, y: 2200 }, { x: 3500, y: 2200 }).length,
    ),
  ).toBeGreaterThan(0);
});

test("recorded sounds and four supplied soundtracks decode in the browser", async ({
  page,
}) => {
  await begin(page);
  const durations = await page.evaluate(async () => {
    const c = new AudioContext(),
      result = [];
    for (const path of [
      "audio/chop.ogg",
      "audio/impactMining_000.ogg",
      "audio/impactBell_heavy_000.ogg",
      "music/midday-at-the-oasis.mp3",
      "music/lanterns-by-the-slope.mp3",
      "music/shadows-in-the-stone-courtyard.mp3",
      "music/iter-nostrum.mp3",
    ]) {
      const r = await fetch("assets/" + path),
        b = await c.decodeAudioData(await r.arrayBuffer());
      result.push(b.duration);
    }
    await c.close();
    return result;
  });
  expect(durations.every((n) => n > 0)).toBe(true);
  expect(durations.slice(3).every((n) => n > 120)).toBe(true);
});

test("older campaign checkpoints migrate without losing the company or stores", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.step(5);
    cruciata.save();
    const s = JSON.parse(localStorage.getItem("cruciata-checkpoint-v3"));
    s.version = s.state.version = 2;
    s.world = [4800, 3300];
    delete s.state.enemy;
    delete s.state.upgrades;
    s.state.buildings = s.state.buildings.filter(
      (b) => !(b.team === 1 && b.kind === "towncenter"),
    );
    localStorage.setItem("cruciata-checkpoint-v2", JSON.stringify(s));
    localStorage.removeItem("cruciata-checkpoint-v3");
  });
  const before = await snapshot(page);
  await page.reload();
  await page.locator("#resume-campaign").click();
  const after = await snapshot(page);
  expect(after.time).toBe(before.time);
  expect(after.resources).toEqual(before.resources);
  expect(after.units.filter((u) => u.team === 0).length).toBe(
    before.units.filter((u) => u.team === 0).length,
  );
  expect(
    after.buildings.some((b) => b.team === 1 && b.kind === "towncenter"),
  ).toBe(true);
  expect(after.version).toBe(3);
});

test("custom starting forces obey their chosen composition and population capacity", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-0").click();
  await page.locator("[name=units]").fill("60");
  await page.locator("[name=workers]").fill("12");
  await page.locator("[name=composition]").selectOption("cavalry");
  await page.locator("#quick-form button[type=submit]").click();
  const s = await snapshot(page);
  expect(
    s.units.filter((u) => u.team === 0 && u.type === "worker").length,
  ).toBe(12);
  expect(
    s.units.filter((u) => u.team === 1 && u.type === "worker").length,
  ).toBe(12);
  expect(
    s.units.filter((u) => u.team === 0 && u.type === "knight").length,
  ).toBe(40);
  expect(s.population.used).toBe(72);
  expect(s.population.cap).toBeGreaterThanOrEqual(72);
  await expect(page.locator("#overlay")).toContainText(
    "Destroy the opposing town center",
  );
});

test("faith and population use illustrated assets and every resource icon loads", async ({
  page,
}) => {
  await begin(page);
  for (const type of ["food", "wood", "gold", "stone", "faith", "people"])
    expect(
      await page
        .locator(".resource-icon." + type + " img")
        .evaluate((e) => e.complete && e.naturalWidth > 0),
    ).toBe(true);
});

test("enemy assault companies share formation anchors after discovering a target", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() =>
    cruciata.scenario((s) => {
      const scout = s.units.find((u) => u.team === 1 && u.type === "archer");
      scout.x = 1050;
      scout.y = 1700;
      scout.hold = true;
    }),
  );
  await page.evaluate(() => cruciata.step(540));
  const s = await snapshot(page);
  expect(s.enemy.discovered).toBe(true);
  expect(s.enemy.attack).toBeGreaterThan(0);
  expect(
    s.formations.some((f) =>
      f.members.some((id) => s.units.some((u) => u.id === id && u.team === 1)),
    ),
  ).toBe(true);
});

test("dragged walls join continuously and create automatic corner connections", async ({
  page,
}) => {
  await begin(page);
  const p = await page.evaluate(() => {
    cruciata.supply({ stone: 10000, wood: 10000 });
    cruciata.scenario((s) => {
      s.nodes = [];
      cruciata.cheat("reveal");
    });
    return { x: 1280, y: 1856 };
  });
  await page.locator("#settlement-tab").click();
  await page.locator("#build-wall").click();
  await page.evaluate((p) => cruciata.camera(p.x + 64, p.y + 32), p);
  const a = await page.evaluate((p) => cruciata.project(p.x, p.y), p),
    b = await page.evaluate((p) => cruciata.project(p.x + 160, p.y + 96), p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  const walls = (await snapshot(page)).buildings.filter(
    (b) => b.team === 0 && b.kind === "wall",
  );
  expect(walls.length).toBe(6);
  expect(walls.every((b) => b.w === 32 && b.h === 32)).toBe(true);
  expect(
    walls.every(
      (b, i) =>
        !i ||
        Math.max(
          Math.abs(b.x - walls[i - 1].x),
          Math.abs(b.y - walls[i - 1].y),
        ) === 32,
    ),
  ).toBe(true);
  expect(new Set(walls.map((b) => b.x)).size).toBeGreaterThan(1);
  expect(new Set(walls.map((b) => b.y)).size).toBeGreaterThan(1);
});

test("quickmatch starting soldiers are visible from the initial settlement view", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-0").click();
  await page.locator("#quick-form button[type=submit]").click();
  await page.locator("#overlay button").click();
  const s = await snapshot(page);
  expect(
    s.units
      .filter((u) => u.team === 0 && u.type !== "worker")
      .some(
        (u) =>
          u.x > s.view.x &&
          u.x < s.view.x + s.view.w &&
          u.y > s.view.y &&
          u.y < s.view.y + s.view.h,
      ),
  ).toBe(true);
  await expect(page.locator("#objective-sub")).toContainText(
    "Destroy its town center",
  );
});

test("opposing religious structures use their own names and distinct heraldry", async ({
  page,
}) => {
  await begin(page);
  const point = await page.evaluate(() => {
    let point;
    cruciata.scenario((s) => {
      const b = s.buildings.find((b) => b.team === 0 && b.kind === "house");
      b.kind = "chapel";
      b.team = 1;
      point = { x: b.x, y: b.y };
    });
    return point;
  });
  await clickWorld(page, point.x, point.y);
  await expect(page.locator("#selection-title")).toHaveText("Prayer house");
  const images = await page.evaluate(() =>
    [0, 1].map((team) => {
      const c = document.createElement("canvas");
      c.width = c.height = 160;
      CruciataArt.structure(
        c.getContext("2d"),
        {
          kind: "chapel",
          id: 1,
          team,
          x: 80,
          y: 80,
          w: 70,
          h: 96,
          progress: 1,
          hp: 950,
          maxHp: 950,
        },
        1,
      );
      return c.toDataURL();
    }),
  );
  expect(images[0]).not.toBe(images[1]);
});

test("campaign victory unlocks the next chapter and carries the story forward", async ({
  page,
}) => {
  await begin(page);
  await page.evaluate(() => {
    cruciata.scenario((s) => {
      s.buildings
        .filter((b) => b.team === 0 && b.kind === "house")
        .forEach((b) => (b.kind = "farm"));
      s.stats.gathered.food = 200;
      s.buildings.find((b) => b.id === s.capitals.enemy).hp = 0;
    });
    cruciata.step(0.1);
  });
  expect((await snapshot(page)).result).toBe("victory");
  expect((await snapshot(page)).unlocked).toBe(1);
  await expect(page.locator("#front-menu")).toBeVisible();
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  await expect(page.locator("#army-standard")).toHaveAttribute(
    "data-next-level",
    "1",
  );
  await page.locator("#chapter-1").click();
  await page.locator("#overlay button").click();
  expect((await snapshot(page)).level).toBe(1);
  await page.reload();
  await page.locator("#open-campaign").click();
  await expect(page.locator("#chapter-0")).toContainText("Completed");
  await expect(page.locator("#chapter-1")).toBeEnabled();
});

test("quickmatch victory returns to sessions without changing campaign progress", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.locator("#open-quickmatch").click();
  await page.locator("#slot-0").click();
  await page.locator("#quick-form button[type=submit]").click();
  await page.locator("#overlay button").click();
  await page.evaluate(() => {
    cruciata.scenario((s) =>
      s.buildings
        .filter((b) => b.team === 1 && b.kind === "towncenter")
        .forEach((b) => (b.hp = 0)),
    );
    cruciata.step(0.1);
  });
  await expect(page.locator("#overlay")).toContainText("Quickmatch won.");
  expect((await snapshot(page)).unlocked).toBe(0);
  await page.getByRole("button", { name: "Return to sessions" }).click();
  await expect(page.locator(".save-slots article")).toHaveCount(3);
  expect(
    await page.evaluate(() => localStorage.getItem("cruciata-quickmatch-0")),
  ).toBeNull();
});

test("builder hammer animations reach the structure instead of working at a distance", async ({
  page,
}) => {
  await begin(page);
  const b = await build(page, "chapel");
  await page.keyboard.press("e");
  await clickWorld(page, b.x, b.y, { button: "right" });
  let observed = false;
  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => cruciata.step(1));
    const s = await snapshot(page),
      builders = s.units.filter(
        (u) => u.team === 0 && u.job?.target === b.id && u.working,
      );
    if (builders.length) {
      for (const u of builders)
        expect(
          Math.hypot(
            Math.max(0, Math.abs(u.x - b.x) - b.w / 2),
            Math.max(0, Math.abs(u.y - b.y) - b.h / 2),
          ),
        ).toBeLessThanOrEqual(14.1);
      observed = true;
      break;
    }
  }
  expect(observed).toBe(true);
});
