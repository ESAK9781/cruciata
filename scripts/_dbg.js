const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto("http://127.0.0.1:3000/?test"); await page.locator("#open-campaign").click();
  const r = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true; cruciata.start(0);
    cruciata.scenario((s) => { s.nodes = []; s.decorations = []; s.terrainFeatures = []; s.time = 60; s.enemy.think = 0; s.enemy.resources = { food: 10000, wood: 10000, gold: 10000, stone: 10000 }; });
    const out = [];
    for (let i = 0; i < 6; i++) { cruciata.step(5); const s = cruciata.snapshot(); const f = s.enemy.fortifications?.[s.capitals.enemy];
      out.push({ t: s.time | 0, plots: f?.plots.length, defence: s.buildings.filter((b) => b.defence && b.team === 1).length, done: s.buildings.filter((b) => b.defence && b.team === 1 && b.progress >= 1).length, paid: s.enemy.paid, builders: s.units.filter((u) => u.team === 1 && u.job?.kind === "build").length, workers: s.units.filter((u) => u.team === 1 && u.type === "worker").length }); }
    return out; });
  console.log(r.map((x) => JSON.stringify(x)).join("\n")); await b.close(); })();
