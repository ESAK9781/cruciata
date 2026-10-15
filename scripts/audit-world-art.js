/* In-game, reproducible visual audit. Run npm start first. */
const { chromium } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  const target = path.join(__dirname, "../artifacts/world-art-audit");
  fs.mkdirSync(target, { recursive: true });
  const shots = [],
    errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3000/?test");
    await page.locator("#open-campaign").click();
    await page.addStyleTag({
      content:
        ".art-audit-stage #objective-panel,.art-audit-stage .map-controls,.art-audit-stage #control-groups,.art-audit-stage .minimap-frame,.art-audit-stage .map-bottom,.art-audit-stage .map-caption{visibility:hidden}",
    });
    await page.evaluate(() => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(0);
      const s = cruciata.snapshot();
      window.auditTemplates = {
        unit: s.units.find((u) => u.team === 0 && u.type === "sword"),
        building: s.buildings.find(
          (b) => b.team === 0 && b.kind === "towncenter",
        ),
        node: s.nodes[0],
      };
    });
    const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
    const capture = async (name, scene) => {
      if (filter && !filter.test(name)) return;
      await page.evaluate((scene) => {
        document.body.classList.add("art-audit-stage");
        const { unit, building, node } = window.auditTemplates;
        const dimensions = {
          towncenter: [112, 96],
          fort: [140, 132],
          chapel: [69, 93],
          house: [51, 50],
          farm: [88, 76],
          mill: [64, 61],
          lumbercamp: [61, 56],
          miningcamp: [62, 59],
          barracks: [88, 76],
          stable: [85, 77],
          siegeworkshop: [100, 80],
          tower: [43, 43],
          watchtower: [30, 30],
          gate: [74, 42],
          wall: [32, 32],
          greatengine: [162, 140],
        };
        cruciata.scenario((s) => {
          s.units = [];
          s.buildings = [];
          s.nodes = [];
          s.decorations = [];
          s.cities = [];
          s.sites = [];
          s.roads = [];
          s.corpses = [];
          s.particles = [];
          s.rings = [];
          s.marks = [];
          s.campaignRules = null;
          s.enemy.think = 1e9;
          s.regionalThink = 1e9;
          s.cheats = { reveal: true };
          s.paused = true;
          s.mode = "quickmatch";
          s.time = scene.time ?? 20;
          if (scene.buildings)
            scene.buildings.forEach((kind, i) => {
              const [w, h] = dimensions[kind];
              s.buildings.push({
                ...building,
                id: 99000 + i,
                kind,
                team: scene.team ?? 0,
                architecture:
                  scene.architecture ||
                  (scene.team === 1 ? "islamic" : undefined),
                x: scene.single ? 2600 : 2600 + ((i % 4) - 1.5) * 245,
                y: scene.single ? 2730 : 2600 + Math.floor(i / 4) * 210,
                w,
                h,
                r: Math.max(w, h) / 2,
                queue: [],
                hp: scene.ruins ? 0 : scene.damaged ? 300 : 1000,
                maxHp: 1000,
                progress: scene.progress ?? 1,
                fortified: kind === "wall",
                bastionGate: kind === "gate",
                closed: scene.open !== true,
                gateAngle: scene.angle ?? 0,
                aimAngle: scene.angle ?? -0.6,
                lastShot: scene.shot ?? -100,
                wallAttachment: null,
                links: null,
              });
            });
          if (scene.units)
            scene.units.forEach((type, i) =>
              s.units.push({
                ...unit,
                id: 99500 + i,
                type,
                x: 2600 + ((i % 4) - 1.5) * (scene.compact ? 135 : 245),
                y:
                  (scene.compact ? 2730 : 2600) +
                  Math.floor(i / 4) * (scene.compact ? 85 : 200),
                team: scene.team ?? 0,
                rank: scene.rank ?? 1,
                angle: scene.headings
                  ? (i * Math.PI) / 4
                  : (scene.angle ?? -0.6),
                visualAngle: scene.headings
                  ? (i * Math.PI) / 4
                  : (scene.angle ?? -0.6),
                anim: scene.harvest
                  ? (i * Math.PI) / 2 + 0.4
                  : scene.headings
                    ? i * (Math.PI / 6)
                    : 1,
                workPhase: scene.harvest ? i * 0.25 + 0.04 : 0,
                working: !!scene.harvest,
                job: scene.harvest
                  ? {
                      kind: "gather",
                      resource:
                        scene.harvest === "berries" ? "food" : scene.harvest,
                    }
                  : null,
                gatherSource: scene.harvest === "berries" ? "food" : "farm",
                moving: scene.moving ?? false,
                strike: scene.strike ?? 0,
                order: null,
                target: null,
                deployment: scene.deployment ?? "deployed",
                deployTimer: scene.timer ?? 0,
                carry: type === "worker" ? 8 : 0,
              }),
            );
          if (scene.nodes)
            scene.nodes.forEach((kind, i) =>
              s.nodes.push({
                ...node,
                id: 99700 + i,
                kind,
                x: 2600 + ((i % 4) - 1.5) * 245,
                y: 2600 + Math.floor(i / 4) * 220,
                remaining: 1000,
                palm: scene.palm,
                snow: scene.snow,
                r: 35,
              }),
            );
          if (scene.wallCorner) {
            s.buildings = [];
            let id = 99900;
            for (let i = 0; i < 8; i++) {
              const angle = (i * Math.PI) / 4,
                x = 2600 + ((i % 4) - 1.5) * 245,
                y = 2600 + Math.floor(i / 4) * 230;
              for (let j = -2; j <= 2; j++) {
                if (scene.towerOnly && j === 0) continue;
                s.buildings.push({
                  ...building,
                  id: id++,
                  kind: "wall",
                  team: scene.team ?? 0,
                  architecture: scene.team === 1 ? "islamic" : undefined,
                  x: x + Math.cos(angle) * 32 * j,
                  y: y + Math.sin(angle) * 32 * j,
                  w: 32,
                  h: 32,
                  hp: 11000,
                  maxHp: 11000,
                  progress: 1,
                  fortified: scene.fortified,
                  wallAngle: angle,
                  links: null,
                  wallAttachment: null,
                  queue: [],
                });
              }
              s.buildings.push({
                ...building,
                id: id++,
                kind: scene.towerOnly
                  ? scene.watch
                    ? "watchtower"
                    : "tower"
                  : i % 2
                    ? scene.watch
                      ? "watchtower"
                      : "tower"
                    : "gate",
                team: scene.team ?? 0,
                x,
                y,
                w: scene.towerOnly
                  ? scene.watch
                    ? 30
                    : 43
                  : i % 2
                    ? scene.watch
                      ? 30
                      : 43
                    : 74,
                h: scene.towerOnly
                  ? scene.watch
                    ? 30
                    : 43
                  : i % 2
                    ? scene.watch
                      ? 30
                      : 43
                    : 42,
                hp: 1000,
                maxHp: 1000,
                progress: 1,
                fortified: scene.fortified,
                bastionGate: !scene.towerOnly && scene.fortified,
                gateAngle: angle,
                closed: scene.open !== true,
                wallAttachment:
                  scene.towerOnly || i % 2
                    ? {
                        w: 32,
                        h: 32,
                        fortified: scene.fortified,
                        wallAngle: angle,
                      }
                    : null,
                queue: [],
              });
            }
          }
        });
        cruciata.camera(2600, 2800);
        if (scene.compact) cruciata.camera(2600, 2790);
        if (scene.single) cruciata.camera(2600, 2680);
        if (scene.zoomSteps) {
          const mapBottom = document.querySelector(".map-bottom");
          mapBottom.style.visibility = "visible";
          for (let i = 0; i < scene.zoomSteps; i++)
            document.getElementById("zoom-in").click();
          mapBottom.style.visibility = "hidden";
        }
        if (scene.units)
          cruciata.scenario((s) => {
            for (const u of s.units.filter((u) => u.type === "standard")) {
              u.x -= Math.cos(u.angle) * 210;
              u.y -= Math.sin(u.angle) * 210;
              CruciataArt.updateStandard(u, 1 / 120);
              for (let j = 0; j < 360; j++) {
                u.x += (Math.cos(u.angle) * 70) / 120;
                u.y += (Math.sin(u.angle) * 70) / 120;
                CruciataArt.updateStandard(u, 1 / 120);
              }
              if (scene.rest)
                for (let i = 0; i < 1500; i++)
                  CruciataArt.updateStandard(u, 1 / 120);
              u.moving = !scene.rest;
            }
          });
        return new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      }, scene);
      const file = name + ".png";
      await page.locator("#game").screenshot({ path: path.join(target, file) });
      // Zoomed close-ups must not leak their scale into later scenes.
      if (scene.zoomSteps)
        await page.evaluate((steps) => {
          for (let i = 0; i < steps; i++)
            document.getElementById("zoom-out").click();
        }, scene.zoomSteps);
      shots.push({ name, file });
    };
    const kinds = [
      "towncenter",
      "fort",
      "chapel",
      "house",
      "barracks",
      "stable",
      "siegeworkshop",
      "mill",
      "lumbercamp",
      "miningcamp",
      "tower",
      "watchtower",
    ];
    await capture("01-crusader-settlement", { buildings: kinds });
    await capture("02-islamic-settlement", { buildings: kinds, team: 1 });
    await capture("03-captured-and-neutral", { buildings: kinds, team: 3 });
    await capture("03b-captured-islamic", {
      buildings: kinds,
      team: 0,
      architecture: "islamic",
    });
    await capture("04-construction-foundations", {
      buildings: [
        "towncenter",
        "chapel",
        "house",
        "greatengine",
        "barracks",
        "tower",
        "siegeworkshop",
        "mill",
      ],
      progress: 0.3,
    });
    await capture("05-construction-raised", {
      buildings: [
        "towncenter",
        "chapel",
        "house",
        "greatengine",
        "barracks",
        "tower",
        "siegeworkshop",
        "mill",
      ],
      progress: 0.75,
    });
    await capture("06-battle-damage", { buildings: kinds, damaged: true });
    await capture("07-building-ruins", { buildings: kinds, ruins: true });
    await capture("08-curtains-eight-headings", { wallCorner: true });
    await capture("08a-guard-towers-eight-joins", {
      wallCorner: true,
      towerOnly: true,
      fortified: true,
      team: 0,
    });
    await capture("08b-islamic-guard-towers-eight-joins", {
      wallCorner: true,
      towerOnly: true,
      fortified: true,
      team: 1,
    });
    await capture("08c-watchtowers-eight-joins", {
      wallCorner: true,
      towerOnly: true,
      watch: true,
      team: 0,
    });
    await capture("08d-mounted-horsemen-eight-headings", {
      units: Array(8).fill("knight"),
      headings: true,
      moving: true,
      compact: true,
      zoomSteps: 5,
    });
    await capture("08e-mounted-islamic-horsemen", {
      units: Array(8).fill("knight"),
      headings: true,
      moving: true,
      compact: true,
      zoomSteps: 5,
      team: 1,
    });
    await capture("09-bastions-eight-headings", {
      wallCorner: true,
      fortified: true,
    });
    await capture("10-open-bastion-gates", {
      wallCorner: true,
      fortified: true,
      open: true,
    });
    for (const team of [0, 1])
      for (const fortified of [false, true])
        await capture(`watchtower-joins-${team}-${fortified}`, {
          wallCorner: true,
          watch: true,
          fortified,
          team,
        });
    const troops = [
      "worker",
      "civilian",
      "sword",
      "archer",
      "knight",
      "chaplain",
      "standard",
      "merchant",
      "pilgrim",
      "ram",
      "ballista",
      "trebuchet",
    ];
    await capture("11-crusader-troops", { units: troops });
    await capture("12-islamic-troops", { units: troops, team: 1, angle: 2.5 });
    for (const [i, angle] of [0, 0.8, 1.6, 2.4, 3.2, 4, 4.8, 5.6].entries())
      await capture(`siege-${i + 1}-heading`, {
        units: ["ram", "ballista", "trebuchet", "merchant"],
        buildings: ["greatengine"],
        angle,
        strike: 0.3,
        time: 20,
        shot: 19.7,
      });
    await capture("13-packed-siege", {
      units: ["ram", "ballista", "trebuchet", "merchant"],
      deployment: "packed",
      angle: 0.8,
    });
    await capture("14-siege-setting-up", {
      units: ["ram", "ballista", "trebuchet", "merchant"],
      deployment: "setting-up",
      timer: 3,
      angle: -0.8,
    });
    await capture("15-european-resources", {
      nodes: ["wood", "food", "stone", "gold", "wood", "food", "stone", "gold"],
    });
    await capture("16-desert-resources", {
      nodes: ["wood", "food", "stone", "gold", "wood", "food", "stone", "gold"],
      palm: true,
    });
    await capture("17-winter-resources", {
      nodes: ["wood", "food", "stone", "gold", "wood", "food", "stone", "gold"],
      snow: true,
    });
    for (const level of [0, 1, 2, 3, 4, 5]) {
      await page.evaluate((level) => {
        document.body.classList.remove("art-audit-stage");
        cruciata.start(level);
        cruciata.scenario((s) => {
          s.cheats = { reveal: true };
          s.paused = true;
        });
        const s = cruciata.snapshot(),
          b = s.buildings.find((b) => b.team === 0 && b.kind === "towncenter");
        cruciata.camera(b.x, b.y);
        return new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      }, level);
      const name = `campaign-${level + 1}-player`,
        file = name + ".png";
      await page.locator("#game").screenshot({ path: path.join(target, file) });
      shots.push({ name, file });
      await page.evaluate(() => {
        const s = cruciata.snapshot(),
          b = s.buildings.find((b) => b.team === 1 && b.kind === "towncenter");
        cruciata.camera(b.x, b.y);
        return new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      const enemy = `campaign-${level + 1}-enemy`;
      await page
        .locator("#game")
        .screenshot({ path: path.join(target, enemy + ".png") });
      shots.push({ name: enemy, file: enemy + ".png" });
    }
    await page.evaluate(() => {
      for (let i = 0; i < 7; i++) document.getElementById("zoom-in").click();
    });
    await capture("close-troops-crusader", { units: troops, compact: true });
    await capture("close-troops-islamic", {
      units: troops,
      team: 1,
      angle: 2.5,
      compact: true,
    });
    await capture("close-troops-rank-zero", {
      units: troops,
      rank: 0,
      angle: 3.5,
      compact: true,
    });
    await capture("close-standards-moving", {
      units: ["standard", "standard", "standard", "standard"],
      compact: true,
      angle: 0.7,
    });
    await capture("close-standards-at-rest", {
      units: ["standard", "standard", "standard", "standard"],
      compact: true,
      angle: 0.7,
      rest: true,
    });
    for (const harvest of ["wood", "stone", "gold", "food", "berries", "build"])
      await capture(`harvesting-${harvest}`, {
        units: ["worker", "worker", "worker", "worker"],
        harvest,
        compact: true,
      });
    await capture("close-vehicles-left", {
      units: ["ram", "ballista", "trebuchet", "merchant"],
      compact: true,
      angle: 0.8,
      strike: 0.3,
    });
    await capture("close-vehicles-right", {
      units: ["ram", "ballista", "trebuchet", "merchant"],
      compact: true,
      angle: 4,
      strike: 0.3,
    });
    for (const [i, angle] of [0, 1.6, 3.2, 4.8].entries())
      await capture(`close-great-engine-${i + 1}`, {
        buildings: ["greatengine"],
        single: true,
        angle,
        time: 20,
        shot: i === 0 ? 19.72 : i === 1 ? 19.35 : i === 2 ? 14 : -100,
      });
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 1080;
      for (const element of document.body.children)
        element.style.visibility = "hidden";
      document.body.appendChild(canvas);
      canvas.style.cssText =
        "position:fixed;inset:0;z-index:999999;width:1440px;height:1080px";
      const g = canvas.getContext("2d"),
        scale = 1.7;
      function row(team, footY) {
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4,
            x = 80 + i * 180;
          g.setTransform(scale, 0, 0, scale, x, footY);
          CruciataArt.unit(
            g,
            {
              type: "knight",
              team,
              rank: 1,
              moving: true,
              working: false,
              anim: (i * Math.PI) / 6,
              angle,
              visualAngle: angle,
              carry: 0,
            },
            0,
            angle,
          );
        }
      }
      row(0, 300);
      row(1, 730);
      await CruciataAtlas.ready;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      row(0, 300);
      row(1, 730);
    });
    const mountedCloseup = path.join(target, "08f-mounted-atlas-closeup.png");
    await page.screenshot({ path: mountedCloseup });
    shots.push({
      name: "Mounted horse and rider atlas close-up",
      file: path.basename(mountedCloseup),
    });
    fs.writeFileSync(
      path.join(target, "manifest.json"),
      JSON.stringify({ shots, errors }, null, 2),
    );
    const html =
      '<html><meta charset="utf-8"><title>In-game artwork audit</title><style>body{background:#20271f;color:#e9dbb6;font:16px Georgia;margin:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}img{width:100%}figure{margin:0}figcaption{padding:6px}</style><h1>In-game artwork audit</h1><p>Actual game renderer; staged test scenes and paused campaign views. Click for full resolution.</p><div class="grid">' +
      shots
        .map(
          (s) =>
            `<figure><a href="${s.file}"><img src="${s.file}"></a><figcaption>${s.name}</figcaption></figure>`,
        )
        .join("") +
      "</div></html>";
    fs.writeFileSync(path.join(target, "index.html"), html);
    const gallery = await browser.newPage({
      viewport: { width: 1800, height: 1000 },
    });
    await gallery.goto(
      "file:///" + path.join(target, "index.html").replaceAll("\\", "/"),
    );
    await gallery.evaluate(() =>
      Promise.all([...document.images].map((i) => i.decode())),
    );
    await gallery.screenshot({
      path: path.join(target, "contact-sheet.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify(
        {
          screenshots: shots.length,
          errors,
          gallery: path.join(target, "index.html"),
        },
        null,
        2,
      ),
    );
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
