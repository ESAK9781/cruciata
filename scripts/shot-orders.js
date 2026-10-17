/* Render a sheet of every faction's troops, standard and buildings (source masters).
 * Needs `node server.js`. Usage: node scripts/shot-orders.js [out.png] */
const { chromium } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const out = path.resolve(process.argv[2] || "artifacts/shots/orders.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test&bake");
  const data = await page.evaluate(() => {
    cruciata.start(0);
    const sizes = {};
    for (const b of cruciata.snapshot().buildings)
      sizes[b.kind] = sizes[b.kind] || [b.w, b.h];
    const A = CruciataArt;
    const c = document.createElement("canvas");
    c.width = 1800;
    c.height = 1300;
    const g = c.getContext("2d");
    g.fillStyle = "#6f7c52";
    g.fillRect(0, 0, c.width, c.height);
    const rows = [
      [0, "Crusader"],
      [4, "Templar"],
      [5, "Hospitaller"],
      [6, "Teutonic"],
      [1, "Muslim"],
    ];
    const kinds = ["towncenter", "barracks", "chapel", "stable", "house"];
    rows.forEach(([team, label], r) => {
      const y = 70 + r * 255;
      g.fillStyle = "#fff";
      g.font = "16px sans-serif";
      g.fillText(label, 8, y - 40);
      let x = 70;
      for (const [type, rank] of [
        ["sword", 0],
        ["archer", 0],
        ["knight", 0],
        ["sword", 1],
        ["chaplain", 0],
      ]) {
        g.save();
        g.translate(x, y + 40);
        g.scale(2, 2);
        CruciataPeopleArt.draw(
          g,
          { type, team, rank, carry: 0 },
          0.4,
          0.3,
          "idle",
        );
        g.restore();
        x += 110;
      }
      g.save();
      g.translate(x + 40, y + 90);
      const u = { x: 0, y: 0, type: "standard", team, angle: 0, moving: false };
      for (let t = 0; t < 400; t++) A.updateStandard(u, 1 / 90);
      A.standardMaster(g, u);
      g.restore();
      x += 220;
      for (const k of kinds) {
        const [w, h] = sizes[k] || [60, 60];
        g.save();
        g.translate(x + 80, y + 70);
        g.scale(0.9, 0.9);
        A.structure(
          g,
          {
            id: 1,
            kind: k,
            w,
            h,
            x: 0,
            y: 0,
            hp: 100,
            maxHp: 100,
            team,
            architecture: team === 1 ? "islamic" : "christian",
            progress: 1,
          },
          1.2,
        );
        g.restore();
        x += 230;
      }
    });
    return c.toDataURL("image/png").split(",")[1];
  });
  fs.writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out);
  await browser.close();
})();
