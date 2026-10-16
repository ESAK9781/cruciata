// Records the effect of player commands on chapter 0 for the native port.
// Requires `npm start` (server on :3000). Output: fixtures/commands-L0.json
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
    const pick = (u) => ({
      id: u.id, x: u.x, y: u.y, order: u.order, formation: u.formation,
      target: u.target, stance: u.stance, manualTarget: u.manualTarget,
      marchOffset: u.marchOffset, job: u.job, buildQueue: u.buildQueue,
    });
    const forms = () => JSON.parse(JSON.stringify(S.formations));
    const out = { uid0: I.uid(), steps: [] };
    const soldiers = S.units.filter((u) => u.team === 0 && u.hp > 0 && !["worker", "civilian", "pilgrim", "merchant"].includes(u.type));
    const ids = soldiers.slice(0, 14).map((u) => u.id);
    const c = S.units.find((u) => ids.includes(u.id));
    // 1. formation move
    const t1 = { x: c.x + 500, y: c.y + 260 };
    cruciata.order(ids, t1, false);
    out.steps.push({ cmd: "order", ids, x: t1.x, y: t1.y, attack: false, units: ids.map((i) => pick(S.units.find((u) => u.id === i))), formations: forms(), uid: I.uid() });
    cruciata.step(6);
    out.steps.push({ cmd: "after6", units: ids.map((i) => pick(S.units.find((u) => u.id === i))) });
    // 2. attack-move swarm
    const t2 = { x: c.x - 300, y: c.y + 420 };
    cruciata.order(ids, t2, true);
    out.steps.push({ cmd: "order", ids, x: t2.x, y: t2.y, attack: true, units: ids.map((i) => pick(S.units.find((u) => u.id === i))), formations: forms().slice(-3), uid: I.uid() });
    // 3. worker move
    const workers = S.units.filter((u) => u.team === 0 && u.type === "worker").slice(0, 4).map((u) => u.id);
    const t3 = { x: c.x + 100, y: c.y - 200 };
    cruciata.order(workers, t3, false);
    out.steps.push({ cmd: "order", ids: workers, x: t3.x, y: t3.y, attack: false, units: workers.map((i) => pick(S.units.find((u) => u.id === i))), formations: [], uid: I.uid() });
    // 4. economy commands
    const res = () => ({ ...S.resources });
    const cap = S.buildings.find((b) => b.team === 0 && b.progress >= 1 && b.kind === "towncenter") || S.buildings[0];
    const prods = S.buildings.filter((b) => b.team === 0 && b.progress >= 1 && ["barracks", "towncenter", "stable"].includes(b.kind));
    const eco = [];
    for (const b of prods) {
      const type = b.kind === "barracks" ? "sword" : b.kind === "stable" ? "knight" : "worker";
      const before = res();
      const ok = cruciata.recruit(type, [b.id]);
      eco.push({ cmd: "recruit", type, building: b.id, ok, before, after: res(), queue: JSON.parse(JSON.stringify(S.buildings.find((x) => x.id === b.id).queue)) });
    }
    out.steps.push({ cmd: "eco", eco });
    // 5. placement
    const w = S.units.find((u) => u.team === 0 && u.type === "worker");
    const spots = [];
    for (let i = 0; i < 12; i++) spots.push({ x: cap.x + 220 + (i % 4) * 90, y: cap.y + 330 + Math.floor(i / 4) * 90 });
    const placed = [];
    for (const p of spots) {
      const before = res();
      const n = S.buildings.length, valid = cruciata.site("house", p);
      const ok = cruciata.place("house", p, [w.id]);
      placed.push({ x: p.x, y: p.y, valid, ok, before, after: res(), count: S.buildings.length - n, id: ok ? S.buildings[S.buildings.length - 1].id : null, job: JSON.parse(JSON.stringify(w.job || null)) });
    }
    out.steps.push({ cmd: "place", worker: w.id, placed, uid: I.uid() });
    return JSON.stringify(out);
  });
  fs.writeFileSync(__dirname + "/../fixtures/commands-L0.json", result);
  console.log("wrote", result.length);
  await browser.close();
})();
