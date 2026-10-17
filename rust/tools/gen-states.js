// Dumps JS game states (start of each chapter, then after simulated time) as
// fixtures for the native port. Math.random is replaced by a seeded stream so
// the runs are reproducible. Requires `npm start` (server on :3000).
const { chromium } = require("../../node_modules/@playwright/test");
const fs = require("fs");
const out = __dirname + "/../fixtures/";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  const plan = [
    { name: "L0", level: 0, times: [0, 10, 60] },
    { name: "L1", level: 1, times: [0] },
    { name: "L2", level: 2, times: [0] },
    { name: "L3", level: 3, times: [0] },
    { name: "L4", level: 4, times: [0] },
    { name: "L5", level: 5, times: [0] },
  ];
  for (const item of plan) {
    for (const t of item.times) {
      const json = await page.evaluate(
        ({ level, t }) => {
          document.getElementById("front-menu").hidden = true;
          // Reproducible randomness (mulberry32 seeded with 777).
          let seed = 777;
          Math.random = () => {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
          };
          cruciata.start(level);
          if (t > 0) cruciata.step(t);
          const I = cruciata.internals();
          // Force one full navigation rebuild so the nav fingerprint does not
          // depend on the history of incremental updates.
          I.nav.footprints = null;
          I.rebuildNavigation();
          const s = { ...I.state };
          delete s.groundCover;
          // Collision samples (groundFree) and navigation fingerprints.
          const rnd = (() => { let q = 4242; return () => { q |= 0; q = (q + 0x6d2b79f5) | 0; let x = Math.imul(q ^ (q >>> 15), 1 | q); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; })();
          const samples = [];
          const bx = s.buildings.filter((b) => b.team === 0).slice(0, 8);
          for (let i = 0; i < 1500; i++) {
            let x, y;
            if (i % 3 === 0 && bx.length) { const b = bx[i % bx.length]; x = b.x + (rnd() - 0.5) * 260; y = b.y + (rnd() - 0.5) * 260; }
            else { x = rnd() * 12800; y = rnd() * 8800; }
            const margin = [0, 6, 10, 28][i % 4];
            samples.push([x, y, margin, I.groundFree(x, y, margin)]);
          }
          const nav = I.nav;
          const comps = Array.from({ length: 300 }, () => Math.floor(rnd() * nav.components.length)).map((k) => [k, nav.components[k]]);
          const routes = [];
          for (let i = 0; i < 40; i++) {
            const a = { x: 300 + rnd() * 3500, y: 300 + rnd() * 3500 }, b2 = { x: 300 + rnd() * 3500, y: 300 + rnd() * 3500 };
            if (!I.groundFree(a.x, a.y, 6)) continue;
            routes.push({ a, b: b2, route: nav.find(a, b2).map((p) => [p.x, p.y]) });
          }
          const decorations = I.decorations().filter((d) => d.kind !== "rockmass").map((d) => ({ x: d.x, y: d.y, kind: d.kind, r: d.r, block: d.block, scale: d.scale }));
          const navinfo = { blockedSum: nav.blocked.reduce((a2, b2) => a2 + b2, 0), leafTotal: nav.leafTotal, revision: nav.revision, comps, routes, cols: nav.cols, rows: nav.rows };
          return JSON.stringify({ uid: I.uid(), state: s, decorations, samples, nav: navinfo });
        },
        { level: item.level, t },
      );
      fs.writeFileSync(out + `state-${item.name}-t${t}.json`, json);
      console.log(item.name, t, json.length);
    }
  }
  await browser.close();
})();
