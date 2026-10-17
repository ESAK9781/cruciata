/* Bake the Colossus sprites for the native client into assets/atlas/colossus-*.png + colossus.json.
 * The web game draws them at runtime (too many frames for the main atlas); the native client
 * ships a reduced pose set: 16 headings x 2 teams x 8 poses at 1.5 pixels per world unit.
 * Serve the repo first (npm start, or set BAKE_URL), then: node scripts/bake-colossus.js */
const { chromium } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
(async () => {
  const output = path.resolve(__dirname, "../assets/atlas");
  for (const name of fs.readdirSync(output))
    if (/^colossus-\d+\.png$/.test(name))
      fs.unlinkSync(path.join(output, name));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(
    (process.env.BAKE_URL || "http://127.0.0.1:3000") + "/?test&bake",
  );
  await page.exposeFunction("saveColossusPage", (index, encoded) => {
    fs.writeFileSync(
      path.join(output, `colossus-${index}.png`),
      Buffer.from(encoded, "base64"),
    );
  });
  const meta = await page.evaluate(async () => {
    const scale = 1.5,
      size = 1024,
      frames = {},
      pages = [],
      writes = [];
    let canvas,
      pg,
      x = 2,
      y = 2,
      rowHeight = 0;
    const flush = () => {
      if (!canvas) return;
      writes.push(
        window.saveColossusPage(
          pages.length - 1,
          canvas.toDataURL("image/png").split(",")[1],
        ),
      );
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
    window.CruciataBakeSprite = (key, w, h, ox, oy, draw) => {
      if (!key.startsWith("siege:colossus:")) return true;
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
        bottom = 0;
      for (let yy = 0; yy < c.height; yy++)
        for (let xx = 0; xx < c.width; xx++)
          if (rgba[(yy * c.width + xx) * 4 + 3]) {
            left = Math.min(left, xx);
            top = Math.min(top, yy);
            right = Math.max(right, xx);
            bottom = Math.max(bottom, yy);
          }
      if (left > right) return true;
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
      frames[key] = [pages.length - 1, x, y, sw, sh, left / scale, top / scale];
      x += sw + 2;
      rowHeight = Math.max(rowHeight, sh);
      return true;
    };
    // Capture the flat flag textures the engine's live banners are cut from.
    window.__flags = {};
    const proto = CanvasRenderingContext2D.prototype,
      drawImage = proto.drawImage;
    proto.drawImage = function (img, ...rest) {
      if (
        img.width === 120 &&
        img.height === 84 &&
        window.__team !== undefined &&
        !window.__flags[window.__team]
      )
        window.__flags[window.__team] = img
          .toDataURL("image/png")
          .split(",")[1];
      return drawImage.call(this, img, ...rest);
    };
    const g = document.createElement("canvas").getContext("2d"),
      A = CruciataArt;
    const poses = [
      ["fire", 0],
      ["fire", 4],
      ["fire", 8],
      ["reload", 1],
      ["reload", 4],
      ["reload", 8],
      ["reload", 12],
      ["ready", 0],
    ];
    for (const team of [0, 1])
      for (let k = -8; k < 8; k++) {
        const aimAngle = (k * Math.PI) / 8;
        window.__team = team;
        for (const [pose, n] of poses) {
          const b = { kind: "colossus", x: 0, y: 0, team, aimAngle };
          if (pose === "fire")
            A.greatEngine(g, { ...b, lastShot: 0 }, (n + 0.01) / 12);
          else if (pose === "reload")
            A.greatEngine(g, { ...b, lastShot: 0 }, n + 0.01);
          else A.greatEngine(g, b, 18);
        }
      }
    flush();
    await Promise.all(writes);
    return {
      scale,
      pages: pages.map((_, i) => `colossus-${i}.png`),
      frames,
      flags: window.__flags,
    };
  });
  for (const [team, data] of Object.entries(meta.flags || {}))
    fs.writeFileSync(
      path.join(output, `colossus-flag-${team}.png`),
      Buffer.from(data, "base64"),
    );
  delete meta.flags;
  fs.writeFileSync(path.join(output, "colossus.json"), JSON.stringify(meta));
  console.log(
    meta.pages.length,
    "pages;",
    Object.keys(meta.frames).length,
    "frames",
  );
  await browser.close();
})();
