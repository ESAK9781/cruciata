const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  const out = await page.evaluate(() => {
    const A = window.CruciataArt, rows = [];
    for (const [w, h] of [[12800, 8800], [6400, 4400], [9600, 6600]])
      for (const biome of [0, 1, 2, 3])
        for (const quick of [false, true]) {
          let n = 0;
          const rand = () => { n++; return 0.5; };
          const coast = quick ? () => -1000 : (y) => 175 + Math.sin(y / 170) * 34 + Math.cos(y / 67) * 12;
          const river = (y) => (biome === 1 ? w * 0.5 : 1610) + Math.sin(y / 330) * 165;
          A.terrain(w, h, biome, coast, river, rand, biome === 1 ? h * 0.5 : 1150);
          rows.push([w, h, biome, quick, n]);
        }
    return rows;
  });
  console.log(JSON.stringify(out));
  await browser.close();
})();
