/* Rebuild local PNG sprite pages from editable artwork masters. npm start first. */
const { chromium } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const browser = await chromium.launch();
  const assetsRoot = path.resolve(__dirname, "../assets"),
    artifactsRoot = path.resolve(__dirname, "../artifacts"),
    output = path.join(assetsRoot, "atlas"),
    stamp = Date.now(),
    staging = path.join(artifactsRoot, `atlas-bake-${stamp}`),
    backup = path.join(artifactsRoot, `atlas-before-${stamp}`),
    resolution = 3;
  if (
    path.dirname(output) !== assetsRoot ||
    path.dirname(staging) !== artifactsRoot ||
    path.dirname(backup) !== artifactsRoot
  )
    throw Error("Invalid artwork staging path");
  fs.mkdirSync(staging, { recursive: true });
  if (process.argv.includes("--append"))
    fs.cpSync(output, staging, { recursive: true });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:3000/?test&bake");
    await page.exposeFunction("saveBakedPage", (index, encoded) => {
      fs.writeFileSync(
        path.join(staging, `page-${index}.png`),
        Buffer.from(encoded, "base64"),
      );
      if (index % 50 === 0) console.log(`Baked page ${index}`);
    });
    const catalog = await page.evaluate(() => {
      const result = {},
        curtains = {};
      for (let level = 0; level < 6; level++) {
        cruciata.start(level);
        for (const b of cruciata.snapshot().buildings) {
          if (["wall", "gate", "bastiongate"].includes(b.kind)) {
            const c = {
              kind: b.kind,
              w: b.w,
              h: b.h,
              x: 0,
              y: 0,
              hp: 100,
              maxHp: 100,
              progress: 1,
              team: b.team,
              architecture: b.architecture,
              fortified: b.fortified,
              closed: b.closed,
              links: b.links,
              gateAngle: b.gateAngle,
              wallAngle: b.wallAngle,
              gateSegments: b.gateSegments,
            };
            curtains[JSON.stringify(c)] = c;
            continue;
          }
          if (b.kind === "greatengine" || b.kind === "colossus") continue;
          result[[b.kind, b.w, b.h].join(":")] = [b.kind, b.w, b.h];
        }
      }
      // Camps may not exist in any starting scene but are always buildable.
      for (const [kind, w, h] of [
        ["lumbercamp", 61, 56],
        ["miningcamp", 62, 59],
      ])
        result[[kind, w, h].join(":")] = [kind, w, h];
      return {
        sizes: Object.values(result),
        curtains: Object.values(curtains),
      };
    });
    const sizes = catalog.sizes;
    catalog.append = process.argv.includes("--append");
    catalog.resolution = resolution;
    console.log(
      "Baking",
      sizes.length,
      "architectural dimensions and animated troops",
    );
    const metadata = await page.evaluate(
      async ({ sizes, curtains, append, resolution }) => {
        const scale = resolution,
          size = 1024,
          pages = append ? CruciataAtlasManifest.pages.map(() => null) : [],
          frames = append ? structuredClone(CruciataAtlasManifest.frames) : {};
        if (append && CruciataAtlasManifest.scale !== scale)
          throw Error("Rebuild all artwork when changing texture resolution");
        let page,
          pg,
          x = 2,
          y = 2,
          rowHeight = 0;
        const writes = [];
        const flush = () => {
          if (!page) return;
          writes.push(
            window.saveBakedPage(
              pages.length - 1,
              page.toDataURL("image/png").split(",")[1],
            ),
          );
          page.width = page.height = 1;
        };
        const next = () => {
          flush();
          page = document.createElement("canvas");
          page.width = page.height = size;
          pg = page.getContext("2d");
          pages.push(null);
          x = 2;
          y = 2;
          rowHeight = 0;
        };
        const fingerprints = new Map();
        next();
        window.CruciataBakeSprite = (key, w, h, ox, oy, draw) => {
          if (frames[key]) return true;
          // Construction scaffolds, piles and footings render at runtime.
          if (/^(site:|sitePile:|siteFooting:|colossus:)/.test(key))
            return true;
          const c = document.createElement("canvas");
          c.width = Math.ceil(w * scale);
          c.height = Math.ceil(h * scale);
          const g = c.getContext("2d", { willReadFrequently: true });
          g.scale(scale, scale);
          g.translate(ox, oy);
          draw(g);
          const rgba = g.getImageData(0, 0, c.width, c.height).data;
          let left = c.width,
            top = c.height,
            right = 0,
            bottom = 0;
          for (let yy = 0; yy < c.height; yy++)
            for (let xx = 0; xx < c.width; xx++)
              if (rgba[(yy * c.width + xx) * 4 + 3]) {
                left = Math.min(left, xx);
                top = Math.min(top, yy);
                right = Math.max(right, xx);
                bottom = Math.max(bottom, yy);
              }
          if (left > right) {
            c.width = c.height = 1;
            return true;
          }
          let hash = 2166136261,
            sum = 0;
          for (let yy = top; yy <= bottom; yy++)
            for (let xx = left; xx <= right; xx++)
              for (let ch = 0; ch < 4; ch++) {
                const v = rgba[(yy * c.width + xx) * 4 + ch];
                hash = Math.imul(hash ^ v, 16777619);
                sum = (sum + Math.imul(v, xx + yy * 31 + ch * 997)) | 0;
              }
          const fingerprint = [
            hash,
            sum,
            right - left,
            bottom - top,
            left,
            top,
          ].join(":");
          if (fingerprints.has(fingerprint)) {
            frames[key] = fingerprints.get(fingerprint);
            c.width = c.height = 1;
            return true;
          }
          const sw = right - left + 1,
            sh = bottom - top + 1;
          if (sw + 4 > size || sh + 4 > size)
            throw Error(
              `Sprite exceeds its atlas page: ${key} (${sw} x ${sh})`,
            );
          if (x + sw + 2 > size) {
            x = 2;
            y += rowHeight + 2;
            rowHeight = 0;
          }
          if (y + sh + 2 > size) next();
          pg.drawImage(c, left, top, sw, sh, x, y, sw, sh);
          c.width = c.height = 1;
          frames[key] = [
            pages.length - 1,
            x,
            y,
            sw,
            sh,
            left / scale,
            top / scale,
          ];
          fingerprints.set(fingerprint, frames[key]);
          x += sw + 2;
          rowHeight = Math.max(rowHeight, sh);
          return true;
        };
        const g = document.createElement("canvas").getContext("2d"),
          A = CruciataArt;
        const types = [
          "worker",
          "civilian",
          "sword",
          "archer",
          "knight",
          "chaplain",
          "standard",
        ];
        for (const team of [0, 1, 2, 3])
          for (const type of types)
            for (const rank of [0, 1]) {
              if (rank && ["worker", "civilian", "chaplain"].includes(type))
                continue;
              const actions =
                type === "worker"
                  ? [
                      "idle",
                      "walk",
                      "attack",
                      "wood",
                      "stone",
                      "gold",
                      "food",
                      "berries",
                      "build",
                    ]
                  : ["idle", "walk", "attack"];
              for (let heading = -4; heading <= 4; heading++)
                for (const action of actions)
                  for (
                    let frame = 0;
                    frame < (action === "idle" ? 1 : 12);
                    frame++
                  )
                    for (const carry of type === "worker"
                      ? [false, true]
                      : [false]) {
                      const angle = (heading * Math.PI) / 4,
                        u = { type, team, rank, carry: carry ? 5 : 0 };
                      CruciataBakeSprite(
                        `person:${team === 1 && type === "knight" ? "knight6" : type === "knight" ? "knight5" : team === 1 && type === "sword" ? "sword2" : type}:${team}:${rank}:${angle}:${action}:${frame}:${carry}`,
                        100,
                        120,
                        50,
                        95,
                        (q) =>
                          CruciataPeopleArt.draw(
                            q,
                            u,
                            (frame * Math.PI * 2) / 12,
                            angle,
                            action,
                          ),
                      );
                    }
            }
        for (const [kind, w, h] of sizes)
          for (const team of [0, 1, 2, 3])
            for (const architecture of ["christian", "islamic"]) {
              if ((team === 1) !== (architecture === "islamic") && team !== 0)
                continue;
              for (let id = 0; id < 3; id++)
                A.structure(
                  g,
                  {
                    id,
                    kind,
                    w,
                    h,
                    x: 0,
                    y: 0,
                    hp: 0,
                    maxHp: 100,
                    team,
                    architecture,
                    progress: 1,
                  },
                  0,
                );
              for (let stage = 0; stage <= 20; stage++)
                A.structure(
                  g,
                  {
                    kind,
                    w,
                    h,
                    x: 0,
                    y: 0,
                    hp: 100,
                    maxHp: 100,
                    team,
                    architecture,
                    progress: stage / 20,
                  },
                  0,
                );
              for (let frame = 1; frame < 24; frame++)
                A.structure(
                  g,
                  {
                    kind,
                    w,
                    h,
                    x: 0,
                    y: 0,
                    hp: 100,
                    maxHp: 100,
                    team,
                    architecture,
                    progress: 1,
                  },
                  ((frame / 24) * Math.PI * 2) / 0.7 + 0.00001,
                );
            }
        for (const b of curtains) A.structure(g, b, 0);
        // Build-card previews of the curtain and bastion walls (drawn live on the web).
        for (const fortified of [false, true])
          CruciataBakeSprite(
            fortified ? "card:bastionwall" : "card:wall",
            160,
            160,
            80,
            80,
            (q) => {
              // Nested curtain sprites must draw into this card, not bake separately.
              const hook = window.CruciataBakeSprite;
              window.CruciataBakeSprite = undefined;
              A.structure(
                q,
                {
                  kind: "wall",
                  w: 32,
                  h: 32,
                  x: 0,
                  y: 0,
                  hp: 100,
                  maxHp: 100,
                  progress: 1,
                  team: 0,
                  fortified,
                },
                0,
              );
              window.CruciataBakeSprite = hook;
            },
          );
        for (const kind of ["watchtower", "tower"])
          for (const team of [0, 1])
            for (const fortified of [false, true]) {
              const w = kind === "tower" ? 43 : 30,
                h = w;
              const b = {
                kind,
                w,
                h,
                x: 0,
                y: 0,
                hp: 100,
                maxHp: 100,
                progress: 1,
                team,
                fortified,
                wallAttachment: {
                  fortified,
                  links: { e: { x: 16, y: 0 }, w: { x: -16, y: 0 } },
                },
              };
              for (let frame = 0; frame < 24; frame++)
                A.structure(g, b, ((frame / 24) * Math.PI * 2) / 0.7 + 0.00001);
            }
        for (const team of [0, 1, 2, 3])
          for (let heading = -4; heading <= 4; heading++) {
            const angle = (heading * Math.PI) / 4,
              u = { x: 0, y: 0, type: "standard", team, angle, moving: true };
            for (let tick = 0; tick < 360; tick++) {
              u.x += (Math.cos(angle) * 80) / 90;
              u.y += (Math.sin(angle) * 80) / 90;
              A.updateStandard(u, 1 / 90);
            }
            for (let pose = 0; pose < 12; pose++) {
              for (let tick = 0; tick < 7; tick++) {
                u.x += (Math.cos(angle) * 80) / 90;
                u.y += (Math.sin(angle) * 80) / 90;
                A.updateStandard(u, 1 / 90);
              }
              CruciataBakeSprite(
                `standard2:${team}:${heading}:move:${pose}`,
                260,
                180,
                130,
                120,
                (q) => A.standardMaster(q, u),
              );
            }
            u.moving = false;
            for (let pose = 0; pose <= 24; pose++) {
              if (pose)
                for (let tick = 0; tick < 30; tick++)
                  A.updateStandard(u, 1 / 90);
              CruciataBakeSprite(
                `standard2:${team}:${heading}:rest:${pose}`,
                260,
                180,
                130,
                120,
                (q) => A.standardMaster(q, u),
              );
            }
          }
        for (const palm of [false, true])
          for (const snow of [false, true]) A.tree(g, 0, 0, 1, palm, snow);
        for (let stage = 0; stage < 20; stage++)
          A.structure(
            g,
            {
              kind: "greatengine",
              w: 162,
              h: 140,
              x: 0,
              y: 0,
              hp: 100,
              team: 0,
              progress: stage / 20,
            },
            0,
          );
        for (const kind of ["food", "stone", "gold"])
          for (let id = 0; id < 3; id++)
            A.resource(g, { kind, id, remaining: 100, x: 0, y: 0 });
        for (const team of [0, 1, 2, 3])
          for (let heading = -8; heading <= 8; heading++) {
            const angle = (heading * Math.PI) / 8;
            A.caravan(
              g,
              { type: "merchant", team, angle, moving: false },
              0,
              angle,
            );
            for (let frame = 0; frame < 12; frame++)
              A.caravan(
                g,
                { type: "merchant", team, angle, moving: true },
                (frame + 0.01) / 12,
                angle,
              );
          }
        for (let frame = 0; frame < 16; frame++)
          A.ship(g, 0, 0, ((frame + 0.01) / 16) * Math.PI * 2, 0);
        A.bridge(g, 0, 0);
        for (const type of types.concat([
          "ram",
          "ballista",
          "trebuchet",
          "merchant",
          "pilgrim",
        ]))
          for (const team of [0, 1, 2, 3])
            A.corpse(g, { type, team, angle: 0 });
        for (const r of [8, 12, 16, 20, 24, 28, 32, 36, 40])
          A.boulder(g, { x: 0, y: 0, r });
        for (const team of [0, 1, 2, 3])
          for (let heading = -8; heading <= 8; heading++) {
            const angle = (heading * Math.PI) / 8;
            for (const type of ["ram", "ballista", "trebuchet"]) {
              for (const deployment of ["packed", "deployed"])
                A.siegeMachine(g, { type, team, angle, deployment }, 0, angle);
              for (let frame = 0; frame < 8; frame++)
                A.siegeMachine(
                  g,
                  { type, team, angle, moving: true, deployment: "packed" },
                  (frame + 0.1) / 24,
                  angle,
                );
              for (let frame = 1; frame <= 8; frame++)
                A.siegeMachine(
                  g,
                  {
                    type,
                    team,
                    angle,
                    strike: frame / 8,
                    deployment: "deployed",
                  },
                  0,
                  angle,
                );
              if (type === "trebuchet")
                for (const deployment of ["setting-up", "packing"])
                  for (let frame = 0; frame <= 12; frame++)
                    A.siegeMachine(
                      g,
                      { type, team, angle, deployment, deployTimer: frame / 2 },
                      0,
                      angle,
                    );
            }
            for (let frame = 0; frame < 12; frame++)
              A.greatEngine(
                g,
                { x: 0, y: 0, team, aimAngle: angle, lastShot: 0 },
                (frame + 0.01) / 12,
              );
            for (let frame = 2; frame < 32; frame++)
              A.greatEngine(
                g,
                { x: 0, y: 0, team, aimAngle: angle, lastShot: 0 },
                (frame + 0.01) / 2,
              );
            A.greatEngine(g, { x: 0, y: 0, team, aimAngle: angle }, 18);
          }
        flush();
        await Promise.all(writes);
        return { scale, pages: pages.map((_, i) => `page-${i}.png`), frames };
      },
      catalog,
    );
    fs.writeFileSync(
      path.join(staging, "manifest.js"),
      "window.CruciataAtlasManifest = " + JSON.stringify(metadata) + ";\n",
    );
    // Plain JSON copy for the native client.
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(metadata),
    );
    for (const name of fs.readdirSync(staging))
      if (/^page-\d+\.png$/.test(name) && !metadata.pages.includes(name))
        fs.unlinkSync(path.join(staging, name));
    fs.renameSync(output, backup);
    try {
      fs.renameSync(staging, output);
    } catch (error) {
      fs.renameSync(backup, output);
      throw error;
    }
    console.log(
      metadata.pages.length,
      "pages;",
      Object.keys(metadata.frames).length,
      "frames",
    );
  } finally {
    await browser.close();
  }
})();
