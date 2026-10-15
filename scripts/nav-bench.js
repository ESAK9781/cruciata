// Start npm start first. Compares grid and quadtree navigation: node scripts/nav-bench.js [level] [pairs]
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 3),
    pairs = Number(process.argv[3] || 150);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const out = await page.evaluate(
    ({ level, pairs }) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const I = cruciata.internals(),
        nav = I.nav;
      let seed = 12345;
      const rnd = () =>
        (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const free = (x, y) => nav.pointFree(x, y) && nav.physicalFree(x, y);
      const pick = () => {
        for (let i = 0; i < 500; i++) {
          const p = {
            x: 100 + rnd() * (nav.width - 200),
            y: 100 + rnd() * (nav.height - 200),
          };
          if (free(p.x, p.y)) return p;
        }
      };
      const set = [];
      while (set.length < pairs) {
        const a = pick(),
          b = pick();
        if (a && b) set.push([a, b]);
      }
      const run = (leaves) => {
        nav.useLeaves = leaves;
        nav.pathCache.clear();
        const res = {
          ms: 0,
          worst: 0,
          empty: 0,
          invalid: 0,
          length: 0,
          points: 0,
          ok: 0,
        };
        for (const [a, b] of set) {
          const t = performance.now();
          const path = nav.findRoute(a, b, false);
          const dt = performance.now() - t;
          res.ms += dt;
          res.worst = Math.max(res.worst, dt);
          if (!path.length) {
            res.empty++;
            res.emptyMs = (res.emptyMs || 0) + dt;
            continue;
          }
          let prev = a,
            len = 0,
            bad = false;
          for (const p of path) {
            if (!nav.clearLine(prev, p)) bad = true;
            len += Math.hypot(p.x - prev.x, p.y - prev.y);
            prev = p;
          }
          if (bad) {
            res.invalid++;
            (res.bad ||= []).push({
              a,
              b,
              path,
              startFree: nav.physicalFree(a.x, a.y),
            });
          } else {
            res.ok++;
            res.length += len;
          }
          res.points += path.length;
        }
        return res;
      };
      const grid = run(false),
        tree = run(true);
      const free2 = nav.blocked.reduce((n, v) => n + (v ? 0 : 1), 0);
      return {
        grid,
        tree,
        leaves: nav.leafTotal,
        freeCells: free2,
        cells: nav.blocked.length,
      };
    },
    { level, pairs },
  );
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
