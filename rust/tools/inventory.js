const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  const out = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    const keys = {};
    const note = (cat, o) => { const k = (keys[cat] ||= {}); for (const [n, v] of Object.entries(o)) { const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v; (k[n] ||= new Set()).add(t); } };
    for (const level of [0, 1, 2, 3, 4, 5]) {
      cruciata.start(level);
      for (let i = 0; i < 6; i++) {
        cruciata.step(40);
        const s = cruciata.internals().state;
        for (const [n, v] of Object.entries(s)) { const k = (keys.state ||= {}); const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v; (k[n] ||= new Set()).add(t); }
        for (const u of s.units) note("unit", u);
        for (const b of s.buildings) note("building", b);
        for (const n of s.nodes) note("node", n);
        for (const a of s.arrows || []) note("arrow", a);
        for (const a of s.boulders || []) note("boulder", a);
        for (const a of s.particles || []) note("particle", a);
      }
    }
    const r = {};
    for (const [c, k] of Object.entries(keys)) r[c] = Object.fromEntries(Object.entries(k).map(([n, t]) => [n, [...t].join("|")]));
    return r;
  });
  console.log(JSON.stringify(out, null, 0));
  await browser.close();
})();
