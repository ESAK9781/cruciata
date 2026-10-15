// Start npm start first. Compares drawn silhouettes with pick areas: node scripts/hit-audit.js
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(5);
  });
  await page.waitForTimeout(500);
  const out = await page.evaluate(async () => {
    const S = cruciata.internals().state,
      Art = window.CruciataArt,
      rows = [];
    const bounds = (draw) => {
      const c = document.createElement("canvas");
      c.width = c.height = 700;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.translate(350, 450);
      draw(g);
      const d = g.getImageData(0, 0, 700, 700).data;
      let minX = 1e9,
        maxX = -1e9,
        minY = 1e9,
        maxY = -1e9;
      for (let y = 0; y < 700; y++)
        for (let x = 0; x < 700; x++)
          if (d[(y * 700 + x) * 4 + 3] > 120) {
            minX = Math.min(minX, x - 350);
            maxX = Math.max(maxX, x - 350);
            minY = Math.min(minY, y - 450);
            maxY = Math.max(maxY, y - 450);
          }
      return [minX, maxX, minY, maxY];
    };
    const samples = {};
    for (const u of S.units) {
      const k = (u.team === 1 ? "e-" : "") + u.type;
      if (!samples[k]) samples[k] = u;
    }
    const bsample = {};
    for (const b of S.buildings) {
      const k =
        b.kind +
        (b.wallAttachment ? "+att" : "") +
        (b.fortified ? "+bast" : "");
      if (!bsample[k] && b.hp > 0) bsample[k] = b;
    }
    for (let i = 0; i < 8; i++) {
      for (const u of Object.values(samples))
        bounds((g) => {
          g.save();
          Art.unit?.(g, { ...u, x: 0, y: 0 }, 0, u.angle || 0);
          g.restore();
        });
      for (const b of Object.values(bsample))
        bounds((g) => Art.structure(g, { ...b, x: 0, y: 0 }, 0));
      await window.CruciataAtlas?.ready;
      await new Promise((r) => setTimeout(r, 400));
    }
    for (const [k, u] of Object.entries(samples)) {
      const kind = ["ram", "ballista", "trebuchet"].includes(u.type);
      rows.push([
        "unit " + k,
        bounds((g) => {
          const q = { ...u, x: 0, y: 0 };
          if (kind) Art.siegeMachine(g, q, 0, 0);
          else {
            g.scale(0.72, 0.72);
            Art.unit(g, q, 0, 0);
          }
        }),
      ]);
    }
    for (const [k, b] of Object.entries(bsample))
      rows.push([
        "bld " +
          k +
          " w" +
          b.w +
          "h" +
          b.h +
          " vh" +
          Math.round(Art.visualHeight(b)) +
          " top" +
          Math.round(-(b.h / 2 + Art.visualHeight(b) + 6)),
        bounds((g) => Art.structure(g, { ...b, x: 0, y: 0 }, 0)),
      ]);
    return rows;
  });
  for (const r of out) console.log(r[0], JSON.stringify(r[1]));
  await browser.close();
})();
