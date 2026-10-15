// Start npm start first. Measures squish and backtracking for a large order: node scripts/army-squish.js [level] [units] [distance]
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 0),
    count = Number(process.argv[3] || 120),
    dist = Number(process.argv[4] || 1800);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const out = await page.evaluate(
    ({ level, count, dist }) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const ids = [];
      cruciata.scenario((s) => {
        s.enemy.think = 1e9;
        s.cheats = { reveal: true };
        const base = s.buildings.find(
            (b) => b.team === 0 && b.kind === "towncenter",
          ),
          tpl = JSON.parse(
            JSON.stringify(
              s.units.find((u) => u.team === 0 && u.type === "sword"),
            ),
          );
        for (let i = 0; i < count; i++) {
          const u = JSON.parse(JSON.stringify(tpl));
          Object.assign(u, {
            id: 900000 + i,
            x: base.x + 220 + (i % 12) * 28,
            y: base.y + 200 + Math.floor(i / 12) * 28,
            order: null,
            path: [],
            target: null,
            job: null,
            stance: "fight",
          });
          s.units.push(u);
          ids.push(u.id);
        }
      });
      const S = cruciata.internals().state;
      const mine = () => S.units.filter((u) => ids.includes(u.id) && u.hp > 0);
      const c0 = mine().reduce(
        (p, u) => ({ x: p.x + u.x / count, y: p.y + u.y / count }),
        { x: 0, y: 0 },
      );
      // Walk to a free point roughly `dist` away toward the map centre.
      const a = Math.atan2(
        S.world?.[1] / 2 - c0.y || 1,
        S.world?.[0] / 2 - c0.x || 1,
      );
      const target = cruciata.internals().findFree({
        x: c0.x + Math.cos(a) * dist,
        y: c0.y + Math.sin(a) * dist,
      });
      cruciata.order(ids, target);
      const samples = [];
      let backward = new Map();
      for (let i = 0; i < 40 * 30; i++) {
        cruciata.liveFrame(1);
        if (i % 15 === 0) {
          const us = mine();
          let overlap = 0,
            back = 0;
          for (let x = 0; x < us.length; x++) {
            const u = us[x];
            const gx = u.order ? u.order.x - u.x : 0,
              gy = u.order ? u.order.y - u.y : 0;
            if (
              u.order &&
              (u.vx || 0) * gx + (u.vy || 0) * gy <
                -0.3 * Math.hypot(u.vx || 0, u.vy || 0) * Math.hypot(gx, gy) &&
              Math.hypot(u.vx || 0, u.vy || 0) > 20
            )
              back++;
            for (let y = x + 1; y < us.length; y++)
              if (Math.hypot(u.x - us[y].x, u.y - us[y].y) < 14) overlap++;
          }
          const c = us.reduce(
            (p, u) => ({ x: p.x + u.x / us.length, y: p.y + u.y / us.length }),
            { x: 0, y: 0 },
          );
          const spread = Math.sqrt(
            us.reduce((s, u) => s + (u.x - c.x) ** 2 + (u.y - c.y) ** 2, 0) /
              us.length,
          );
          samples.push({
            t: +(i / 30).toFixed(1),
            overlap,
            back,
            spread: Math.round(spread),
            moving: us.filter((u) => u.moving).length,
            remaining: us.filter((u) => u.order).length,
          });
        }
      }
      return { target, samples: samples.filter((_, i) => i % 4 === 0) };
    },
    { level, count, dist },
  );
  console.log(JSON.stringify(out.target));
  for (const r of out.samples) console.log(JSON.stringify(r));
  await browser.close();
})();
