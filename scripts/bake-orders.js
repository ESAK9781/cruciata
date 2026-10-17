/* Bake the crusader-order liveries (Templar, Hospitaller, Teutonic: art slots 4-6) used by
 * the native LAN client into assets/atlas/orders-*.png + orders.json. They sit beside the
 * main atlas (same 3 px/unit resolution, same key format) and the web build skips them.
 * Covers troops (sword, archer, knight, chaplain), standards, finished buildings and their
 * banner animation, and attached towers; everything else falls back to the slot-0 frames.
 * Serve the repo first (npm start, or set BAKE_URL), then: node scripts/bake-orders.js */
const { chromium } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const output = path.resolve(__dirname, "../assets/atlas");
  const main = JSON.parse(
    fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
  );
  // Every finished christian building the main atlas holds, by kind and footprint.
  const sizes = new Map();
  for (const key of Object.keys(main.frames)) {
    const p = key.split(":");
    if (p[0] !== "building" || p[4] !== "0" || p[5] !== "christian") continue;
    if (p[14] !== "true" || p[8] !== "false") continue;
    if (
      ["wall", "gate", "bastiongate", "greatengine", "colossus"].includes(p[1])
    )
      continue;
    sizes.set([p[1], p[2], p[3]].join(":"), [p[1], +p[2], +p[3]]);
  }
  for (const name of fs.readdirSync(output))
    if (/^orders-\d+\.png$/.test(name)) fs.unlinkSync(path.join(output, name));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(
    (process.env.BAKE_URL || "http://127.0.0.1:3000") + "/?test&bake",
  );
  await page.exposeFunction("saveOrdersPage", (index, encoded) => {
    fs.writeFileSync(
      path.join(output, `orders-${index}.png`),
      Buffer.from(encoded, "base64"),
    );
  });
  const meta = await page.evaluate(
    async ({ sizes }) => {
      const scale = 3,
        size = 1024,
        frames = {},
        pages = [],
        writes = [],
        fingerprints = new Map();
      let canvas,
        pg,
        x = 2,
        y = 2,
        rowHeight = 0;
      const flush = () => {
        if (!canvas) return;
        writes.push(
          window.saveOrdersPage(
            pages.length - 1,
            canvas.toDataURL("image/png").split(",")[1],
          ),
        );
        canvas.width = canvas.height = 1;
      };
      const next = () => {
        flush();
        canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        pg = canvas.getContext("2d");
        pages.push(null);
        x = y = 2;
        rowHeight = 0;
      };
      next();
      const wanted = (key) => {
        const p = key.split(":");
        if (p[0] === "person") return +p[2] >= 4;
        if (p[0] === "standard2") return +p[1] >= 4;
        if (p[0] === "building" || p[0] === "buildingMotion") return +p[4] >= 4;
        return false;
      };
      window.CruciataBakeSprite = (key, w, h, ox, oy, draw) => {
        if (!wanted(key)) return true;
        if (frames[key]) return true;
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
          bottom = 0,
          hash = 2166136261,
          sum = 0;
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
        for (let yy = top; yy <= bottom; yy++)
          for (let xx = left; xx <= right; xx++)
            for (let ch = 0; ch < 4; ch++) {
              const v = rgba[(yy * c.width + xx) * 4 + ch];
              hash = Math.imul(hash ^ v, 16777619);
              sum = (sum + Math.imul(v, xx + yy * 31 + ch * 997)) | 0;
            }
        const fp = [hash, sum, right - left, bottom - top, left, top].join(":");
        if (fingerprints.has(fp)) {
          frames[key] = fingerprints.get(fp);
          c.width = c.height = 1;
          return true;
        }
        const sw = right - left + 1,
          sh = bottom - top + 1;
        if (sw + 4 > size || sh + 4 > size)
          throw Error(`Sprite exceeds its page: ${key} ${sw}x${sh}`);
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
        fingerprints.set(fp, frames[key]);
        x += sw + 2;
        rowHeight = Math.max(rowHeight, sh);
        return true;
      };
      const g = document.createElement("canvas").getContext("2d"),
        A = CruciataArt,
        slots = [4, 5, 6];
      // Troops.
      for (const team of slots)
        for (const type of ["sword", "archer", "knight", "chaplain"])
          for (const rank of type === "chaplain" ? [0] : [0, 1])
            for (let heading = -4; heading <= 4; heading++)
              for (const action of ["idle", "walk", "attack"])
                for (
                  let frame = 0;
                  frame < (action === "idle" ? 1 : 12);
                  frame++
                ) {
                  const angle = (heading * Math.PI) / 4,
                    u = { type, team, rank, carry: 0 };
                  CruciataBakeSprite(
                    `person:${type === "knight" ? "knight5" : type}:${team}:${rank}:${angle}:${action}:${frame}:false`,
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
      // Standards.
      for (const team of slots)
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
              for (let tick = 0; tick < 30; tick++) A.updateStandard(u, 1 / 90);
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
      // Finished buildings and their banner animation.
      for (const team of slots)
        for (const [kind, w, h] of sizes) {
          const b = {
            kind,
            w,
            h,
            x: 0,
            y: 0,
            hp: 100,
            maxHp: 100,
            team,
            architecture: "christian",
            progress: 1,
          };
          A.structure(g, b, 0);
          for (let frame = 1; frame < 24; frame++)
            A.structure(g, b, ((frame / 24) * Math.PI * 2) / 0.7 + 0.00001);
        }
      // Attached curtain towers.
      for (const kind of ["watchtower", "tower"])
        for (const team of slots)
          for (const fortified of [false, true]) {
            const w = kind === "tower" ? 43 : 30,
              b = {
                kind,
                w,
                h: w,
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
      flush();
      await Promise.all(writes);
      return { scale, pages: pages.map((_, i) => `orders-${i}.png`), frames };
    },
    { sizes: [...sizes.values()] },
  );
  fs.writeFileSync(path.join(output, "orders.json"), JSON.stringify(meta));
  console.log(
    meta.pages.length,
    "pages;",
    Object.keys(meta.frames).length,
    "frames",
  );
  await browser.close();
})();
