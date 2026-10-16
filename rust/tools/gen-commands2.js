// Walls, upgrades, demolition, research and scouting on chapter 0.
// Requires `npm start`. Output: fixtures/commands2-L0.json
const { chromium } = require("../../node_modules/@playwright/test");
const fs = require("fs");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  const result = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    let seed = 777;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    cruciata.start(0);
    const I = cruciata.internals();
    const S = I.state;
    const out = { steps: [] };
    const res = () => ({ ...S.resources });
    const worker = S.units.find((u) => u.team === 0 && u.type === "worker");
    const cap = S.buildings.find((b) => b.team === 0 && b.kind === "towncenter");
    // Wall line east of the town centre, then finish the sections instantly.
    let a = null,
      b = null;
    for (let dy = 200; dy < 1200 && !a; dy += 64)
      for (let dx = -600; dx < 600 && !a; dx += 64) {
        const p0 = { x: Math.round((cap.x + dx) / 32) * 32, y: Math.round((cap.y + dy) / 32) * 32 };
        if ([0, 1, 2, 3, 4, 5].every((i) => cruciata.site("wall", { x: p0.x + 32 * i, y: p0.y }))) {
          a = p0;
          b = { x: p0.x + 160, y: p0.y };
        }
      }
    const before = res(),
      n0 = S.buildings.length;
    cruciata.wallLine("wall", a, b, [worker.id]);
    const walls = S.buildings.slice(n0);
    out.steps.push({ cmd: "wallLine", a, b, worker: worker.id, before, after: res(), walls: walls.map((w) => ({ id: w.id, x: w.x, y: w.y, wallAngle: w.wallAngle, hp: w.hp })), job: JSON.parse(JSON.stringify(worker.job || null)), buildQueue: worker.buildQueue || [], uid: I.uid() });
    cruciata.scenario((st) => {
      for (const w of st.buildings.slice(n0)) {
        w.progress = 1;
        w.hp = w.maxHp;
      }
    });
    // Queue a gate (needs a straight pair) and a guard tower.
    const ids = walls.map((w) => w.id);
    const g0 = res();
    cruciata.upgradeWall("gate", [ids[1]]);
    const first = S.buildings.find((x) => x.id === ids[1]);
    out.steps.push({ cmd: "gate", first: ids[1], before: g0, after: res(), queue: JSON.parse(JSON.stringify(first.queue)), owners: S.buildings.filter((x) => x.upgradeOwner).map((x) => [x.id, x.upgradeOwner]) });
    const t0 = res();
    cruciata.upgradeWall("tower", [ids[4]]);
    const tw = S.buildings.find((x) => x.id === ids[4]);
    out.steps.push({ cmd: "tower", first: ids[4], before: t0, after: res(), queue: JSON.parse(JSON.stringify(tw.queue)) });
    // Demolish a house.
    const house = S.buildings.find((x) => x.team === 0 && x.kind === "house");
    cruciata.demolish([house.id]);
    out.steps.push({ cmd: "demolish", id: house.id, hp: house.hp, count: S.buildings.length });
    // Scout with the soldiers.
    const soldiers = S.units.filter((u) => u.team === 0 && !["worker", "civilian"].includes(u.type)).map((u) => u.id);
    cruciata.scout(soldiers);
    out.steps.push({ cmd: "scout", ids: soldiers, groups: JSON.parse(JSON.stringify(S.scoutingGroups || [])), autoScout: S.units.filter((u) => u.autoScout).map((u) => [u.id, u.autoScout]), uid: I.uid() });
    // Research.
    const barracks = S.buildings.find((x) => x.team === 0 && x.kind === "barracks");
    const r0 = res();
    const ok = cruciata.research("sword1", [barracks.id]);
    out.steps.push({ cmd: "research", ok, before: r0, after: res(), queue: JSON.parse(JSON.stringify(barracks.queue)), barracks: barracks.id });
    return JSON.stringify(out);
  });
  fs.writeFileSync(__dirname + "/../fixtures/commands2-L0.json", result);
  console.log("wrote", result.length);
  await browser.close();
})();
