/* Standalone artwork inspection; no server or gameplay mutation required. */
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1800, height: 2300 },
    });
    await page.setContent(
      '<body style="margin:0;background:#cabc97"><canvas width="1800" height="2300"></canvas>',
    );
    for (const name of [
      "model-raster",
      "orders-art",
      "siege-art",
      "artwork",
      "isometric-art",
      "settlement-art",
      "people-art",
    ])
      await page.addScriptTag({
        content: fs.readFileSync(
          path.join(__dirname, "../src", name + ".js"),
          "utf8",
        ),
      });
    await page.evaluate(() => {
      const g = document.querySelector("canvas").getContext("2d"),
        A = CruciataArt;
      g.fillStyle = "#cabc97";
      g.fillRect(0, 0, 1800, 2300);
      const label = (text, x, y, size = 20) => {
        g.fillStyle = "#423d2e";
        g.font = size + "px Georgia";
        g.fillText(text, x, y);
      };
      label("CRUCIATA · stone, timber, plaster and cloth", 35, 40, 30);
      const kinds = [
        "towncenter",
        "fort",
        "chapel",
        "barracks",
        "house",
        "stable",
        "siegeworkshop",
        "mill",
        "lumbercamp",
        "miningcamp",
        "tower",
        "watchtower",
      ];
      for (const team of [0, 1]) {
        label(
          team
            ? "Islamic architecture · arcades, domes and minarets"
            : "Crusader architecture · tiled roofs, timber and masonry",
          35,
          team ? 670 : 90,
        );
        kinds.forEach((kind, i) => {
          const x = 150 + (i % 6) * 290,
            y = (team ? 865 : 295) + Math.floor(i / 6) * 245;
          const large = ["towncenter", "fort"].includes(kind);
          const b = {
            kind,
            x: 0,
            y: 0,
            w: large ? 130 : kind === "tower" ? 46 : 83,
            h: large ? 114 : 72,
            hp: 1800,
            maxHp: 1800,
            progress: 1,
            team,
          };
          g.save();
          g.translate(x, y);
          g.scale(1.35, 1.35);
          A.structure(g, b, 2);
          g.restore();
          label(kind, x - 70, y + 78, 16);
        });
      }
      label("Curtains and gatehouses · ground-aligned connections", 35, 1240);
      [false, true].forEach((fortified, i) => {
        g.save();
        g.translate(150 + i * 390, 1345);
        g.scale(1.6, 1.6);
        for (let x = -48; x <= 48; x += 32)
          A.structure(
            g,
            {
              kind: "wall",
              x,
              y: 0,
              w: 32,
              h: 32,
              fortified,
              links: { a: { x: -16, y: 0 }, b: { x: 16, y: 0 } },
              hp: 100,
              progress: 1,
            },
            0,
          );
        A.structure(
          g,
          {
            kind: "gate",
            x: 135,
            y: 0,
            w: 74,
            h: 42,
            team: 0,
            bastionGate: fortified,
            hp: 100,
            progress: 1,
            closed: true,
          },
          0,
        );
        g.restore();
      });
      ["farm", "house", "fort"].forEach((kind, i) => {
        g.save();
        g.translate(1060 + i * 245, 1345);
        g.scale(1.25, 1.25);
        A.structure(
          g,
          {
            kind,
            x: 0,
            y: 0,
            w: 100,
            h: 85,
            hp: i === 2 ? 0 : 500,
            maxHp: 1000,
            progress: i === 1 ? 0.55 : 1,
            team: 0,
            id: 3,
          },
          2,
        );
        g.restore();
      });
      label("Troops, citizens, horsemen and covered supply wagon", 35, 1495);
      [
        "worker",
        "civilian",
        "sword",
        "archer",
        "knight",
        "chaplain",
        "standard",
      ].forEach((type, i) => {
        g.save();
        g.translate(85 + i * 180, 1625);
        g.scale(2.5, 2.5);
        A.unit(
          g,
          { type, team: i % 2, rank: 2, moving: true, anim: 1, strike: 0.2 },
          1,
          -0.6,
        );
        g.restore();
        label(type, 50 + i * 180, 1665, 16);
      });
      g.save();
      g.translate(1510, 1605);
      g.scale(2.5, 2.5);
      A.caravan(
        g,
        { type: "merchant", team: 0, moving: true, anim: 1 },
        1,
        -0.6,
      );
      g.restore();
      label(
        "Animated siege workshop · raised machinery and rotating assemblies",
        35,
        1735,
      );
      ["ram", "ballista", "trebuchet"].forEach((type, i) => {
        g.save();
        g.translate(125 + i * 260, 1865);
        g.scale(1.8, 1.8);
        A.siegeMachine(
          g,
          { type, team: 0, moving: true, strike: 0.2, deployment: "deployed" },
          1,
          -0.6,
        );
        g.restore();
      });
      A.structure(
        g,
        {
          kind: "greatengine",
          x: 1070,
          y: 1905,
          w: 162,
          h: 140,
          team: 0,
          hp: 6000,
          progress: 1,
          lastShot: 0,
          aimAngle: -0.5,
        },
        18,
      );
      A.ship(g, 1480, 1895, 0);
      label(
        "Vegetation and resources · curved foliage, warm sunlight",
        35,
        1975,
      );
      A.tree(g, 100, 2095, 1.2, false);
      A.tree(g, 275, 2095, 1.2, true);
      A.tree(g, 450, 2095, 1.2, false, true);
      ["wood", "food", "stone", "gold"].forEach((kind, i) =>
        A.resource(
          g,
          { kind, x: 650 + i * 210, y: 2075, remaining: 100, id: i },
          0,
        ),
      );
      label(
        "Physical forked standards, bridge masonry and fallen equipment",
        35,
        2160,
      );
      for (let i = 0; i < 3; i++) {
        const u = {
          type: "standard",
          team: i === 2 ? 1 : 0,
          x: 0,
          y: 0,
          angle: Math.PI,
          moving: true,
          rank: 1,
        };
        A.updateStandard(u, 1 / 120);
        for (let j = 0; j < 360; j++) {
          u.x -= 70 / 120;
          A.updateStandard(u, 1 / 120);
        }
        if (i === 1)
          for (let j = 0; j < 1200; j++) A.updateStandard(u, 1 / 120);
        g.save();
        g.translate(130 + i * 300, 2260);
        g.scale(1.3, 1.3);
        A.unit(g, u, 0);
        A.armyStandard(g, u);
        g.restore();
      }
      A.bridge(g, 1130, 2230);
      for (const [i, type] of [
        "sword",
        "knight",
        "ram",
        "merchant",
      ].entries()) {
        g.save();
        g.translate(1400 + i * 100, 2240);
        A.corpse(g, { type, team: 0, angle: 0.2 });
        g.restore();
      }
    });
    const target = path.join(__dirname, "../artifacts/isometric-assets.png");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target });
    console.log(target);
    if (process.argv.includes("--world")) {
      await page.setViewportSize({ width: 1440, height: 1080 });
      await page.goto("http://127.0.0.1:3000/?test");
      await page.locator("#open-campaign").click();
      for (const level of [0, 2, 5]) {
        await page.evaluate((level) => {
          document.getElementById("front-menu").hidden = true;
          cruciata.start(level);
          const b = cruciata
            .snapshot()
            .buildings.find((b) => b.team === 0 && b.kind === "towncenter");
          cruciata.camera(b.x, b.y);
          return new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        }, level);
        const worldTarget = path.join(
          __dirname,
          `../artifacts/isometric-chapter-${level + 1}.png`,
        );
        await page.screenshot({ path: worldTarget });
        console.log(worldTarget);
      }
    }
  } finally {
    await browser.close();
  }
})();
