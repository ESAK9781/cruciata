const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  const out = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    const I = cruciata.internals();
    const nav = I.nav;
    nav.footprints = null;
    I.rebuildNavigation();
    const start = { x: 1646.9952472951263, y: 3430.4162569576874 }, dest = { x: 3778.060993598774, y: 462.75319177657366 };
    const s = nav.nearest(start.x, start.y), end = nav.nearest(dest.x, dest.y, null);
    const goal = { x: (end.x + 0.5) * nav.cell, y: (end.y + 0.5) * nav.cell };
    const corridor = nav.chunkCorridor(s, end);
    const raw = nav.complete(nav.leafRouteSteps(s, end, goal, corridor));
    return { s, end, corridor: [...corridor], raw: raw.map((p) => [p.x, p.y]), links: nav.chunkLinks.map((l) => [...l]).slice(0, 12) };
  });
  console.log(JSON.stringify(out));
  await browser.close();
})();
