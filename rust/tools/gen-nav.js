// Runs the original navigation.js on a synthetic scene and records routes.
global.window = {};
global.performance = performance;
require("../../src/navigation.js");
const Navigation = window.CruciataNavigation;
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const out = { scenes: [] };
for (const [seed, W, H, count] of [[11, 4000, 3000, 70], [12, 6400, 4400, 160], [13, 2400, 1800, 40]]) {
  const r = seeded(seed);
  const rects = [];
  for (let i = 0; i < count; i++) {
    const w = 40 + Math.floor(r() * 220), h = 40 + Math.floor(r() * 220);
    rects.push({ x: 150 + r() * (W - 300), y: 150 + r() * (H - 300), w, h });
  }
  // A long wall with a narrow gap exercises gap routes.
  rects.push({ x: W / 2, y: H / 2 - 400, w: 60, h: 700 });
  rects.push({ x: W / 2, y: H / 2 + 400, w: 60, h: 700 });
  const free = (x, y, margin = 6) => {
    if (x < 24 + margin || y < 24 + margin || x > W - 24 - margin || y > H - 24 - margin) return false;
    for (const b of rects) if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(y - b.y) < b.h / 2 + margin) return false;
    return true;
  };
  const nav = new Navigation(W, H);
  const waypoints = [];
  for (const b of rects) for (const dx of [-b.w / 2 - 6.25, b.w / 2 + 6.25]) for (const dy of [-b.h / 2 - 6.25, b.h / 2 + 6.25]) waypoints.push({ x: b.x + dx, y: b.y + dy });
  nav.rebuild((x, y) => free(x, y, 6), waypoints, null);
  const queries = [];
  for (let i = 0; i < 120; i++) {
    let a, b;
    do { a = { x: 60 + r() * (W - 120), y: 60 + r() * (H - 120) }; } while (!free(a.x, a.y, 6));
    do { b = { x: 60 + r() * (W - 120), y: 60 + r() * (H - 120) }; } while (!free(b.x, b.y, 6) && r() < 0.9);
    // Include a few unreachable-looking targets (inside obstacles).
    const route = nav.find(a, b);
    queries.push({ a, b, route: route.map((p) => [p.x, p.y]) });
  }
  const comp = Array.from({ length: 200 }, () => Math.floor(r() * nav.components.length)).map((i) => [i, nav.components[i]]);
  out.scenes.push({ seed, W, H, rects, queries, comp, revision: nav.revision, cols: nav.cols, rows: nav.rows, blockedSum: nav.blocked.reduce((a, b) => a + b, 0), leafTotal: nav.leafTotal });
}
require("fs").writeFileSync(__dirname + "/../fixtures/nav.json", JSON.stringify(out));
console.log("ok", out.scenes.map((s) => [s.blockedSum, s.leafTotal, s.queries.filter((q) => q.route.length).length]));
