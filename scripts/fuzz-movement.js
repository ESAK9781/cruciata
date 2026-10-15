// Start npm start first. Random armies/destinations on every campaign map; reports units that never arrive.
const { chromium } = require("@playwright/test");
(async () => {
  const levels = (process.argv[2] || "0,1,2,3,4,5").split(",").map(Number),
    trials = Number(process.argv[3] || 6),
    groupSize = Number(process.argv[4] || 30),
    seconds = Number(process.argv[5] || 90);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  for (const level of levels) {
    const report = await page.evaluate(
      ({ level, trials, groupSize, seconds }) => {
        document.getElementById("front-menu").hidden = true;
        cruciata.start(level);
        let seed = 12345 + level;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const out = { level, trials: [] };
        const base0 = cruciata.snapshot();
        const base = base0.buildings.find((b) => b.team === 0) || base0.buildings[0];
        const W = base0.world.width, H = base0.world.height;
        const freePoint = (cx, cy, r) => {
          for (let i = 0; i < 400; i++) {
            const p = { x: Math.min(W - 60, Math.max(60, cx + (rnd() - 0.5) * 2 * r)), y: Math.min(H - 60, Math.max(60, cy + (rnd() - 0.5) * 2 * r)) };
            if (cruciata.free(p) && cruciata.land(p, 20)) return p;
          }
          return null;
        };
        for (let t = 0; t < trials; t++) {
          cruciata.start(level);
          const start = freePoint(base.x, base.y, 700), goal = freePoint(base.x, base.y, 2200);
          if (!start || !goal) continue;
          cruciata.scenario((s) => {
            s.result = null; s.paused = false;
                        const tpl = JSON.parse(JSON.stringify(s.units.find((u) => u.team === 0) || s.units[0]));
            for (let i = 0; i < groupSize; i++) {
              const u = JSON.parse(JSON.stringify(tpl));
              Object.assign(u, { id: 800000 + t * 100 + i, type: ["sword", "archer", "knight"][i % 3], team: 0, hp: 100, maxHp: 100, x: start.x + (i % 6) * 28, y: start.y + Math.floor(i / 6) * 28, order: null, path: [], job: null, target: null, stance: "stand-down", moving: false });
              s.units.push(u);
            }
            s.enemy.think = 1e9;
          });
          const ids = Array.from({ length: groupSize }, (_, i) => 800000 + t * 100 + i);
          cruciata.order(ids, goal);
          const slots = new Map(cruciata.snapshot().units.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.order ? { x: u.order.x, y: u.order.y } : null]));
          const orderedCount = [...slots.values()].filter(Boolean).length;
          cruciata.liveFrame(Math.round((seconds / 2) * 30));
          const mid = new Map(cruciata.snapshot().units.filter((u) => ids.includes(u.id)).map((u) => [u.id, { x: Math.round(u.x), y: Math.round(u.y) }]));
          cruciata.liveFrame(Math.round((seconds / 2) * 30));
          const units = cruciata.snapshot().units.filter((u) => ids.includes(u.id));
          const series = [];
          const probe = units.find((u) => { const sl = slots.get(u.id); return sl && Math.hypot(u.x - sl.x, u.y - sl.y) > 60 && mid.get(u.id) && Math.hypot(u.x - mid.get(u.id).x, u.y - mid.get(u.id).y) < 5; });
          if (probe) for (let i = 0; i < 8; i++) { cruciata.step(1 / 30); const q = cruciata.internals().state.units.find((u) => u.id === probe.id); if (q) series.push([+q.x.toFixed(2), +q.y.toFixed(2), +(q.vx || 0).toFixed(1), +(q.vy || 0).toFixed(1), q.path?.length, +(q.stuck || 0).toFixed(2)]); }
          const far = units.filter((u) => { const sl = slots.get(u.id); return !sl || Math.hypot(u.x - sl.x, u.y - sl.y) > 60; });
          out.trials.push({ start: [Math.round(start.x), Math.round(start.y)], goal: [Math.round(goal.x), Math.round(goal.y)], paused: cruciata.internals().state.paused, result: cruciata.internals().state.result, time: Math.round(cruciata.internals().state.time), series, total: units.length, ordered: orderedCount, failed: far.length, ordersLeft: units.filter((u) => u.order).length, sample: far[0] && { type: far[0].type, id: far[0].id, x: Math.round(far[0].x), y: Math.round(far[0].y), mid: mid.get(far[0].id), slot: slots.get(far[0].id), stuck: far[0].stuck, moving: far[0].moving, hasPath: far[0].path?.length, hold: far[0].hold, target: far[0].target, path: far[0].path?.map((q) => [Math.round(q.x), Math.round(q.y)]), pathGoal: far[0].pathGoal && [Math.round(far[0].pathGoal.x), Math.round(far[0].pathGoal.y)], freeHere: cruciata.free(far[0]), vx: far[0].vx, vy: far[0].vy, route: cruciata.route(far[0], slots.get(far[0].id)).map((q) => [Math.round(q.x), Math.round(q.y)]), orderObj: far[0].order, near: cruciata.internals().nearby(far[0], 45).map((o) => [o.id, o.type, Math.round(o.x), Math.round(o.y), o.team, o.moving, o.order ? 1 : 0]), ahead: [4, 8, 12, 20].map((d) => [d, cruciata.internals().groundFree(far[0].x + (far[0].vx || 0) * d / 100, far[0].y + (far[0].vy || 0) * d / 100, 6)]) } });
        }
        return out;
      },
      { level, trials, groupSize, seconds },
    );
    console.log(JSON.stringify(report));
  }
  await browser.close();
})();
