// Start npm start first. Generates quickmatch maps for several biomes/seeds and checks the bases connect.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const seeds = Number(process.argv[2] || 6);
  const rows = await page.evaluate((seeds) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    const out = [];
    for (const [width, height] of [
      [6400, 4400],
      [9600, 6600],
    ])
      for (const biome of [0, 1, 2, 3])
        for (let seed = 1; seed <= seeds; seed++) {
          cruciata.launch(
            0,
            {
              width,
              height,
              frequency: 0.3,
              resources: 500,
              units: 4,
              structures: "settlement",
              difficulty: "normal",
              biome,
              seed: seed * 977,
            },
            0,
          );
          const s = cruciata.snapshot();
          const a = s.buildings.find(
              (b) => b.team === 0 && b.kind === "towncenter",
            ),
            e = s.buildings.find(
              (b) => b.team === 1 && b.kind === "towncenter",
            );
          if (!a || !e) {
            out.push({ width, biome, seed, error: "missing capital" });
            continue;
          }
          const route = cruciata.route(
            { x: a.x + a.w / 2 + 40, y: a.y },
            { x: e.x - e.w / 2 - 40, y: e.y },
          );
          const free = cruciata.free({ x: a.x + a.w / 2 + 60, y: a.y });
          if (!route.length)
            out.push({
              width,
              biome,
              seed,
              error: "no route",
              a: [Math.round(a.x), Math.round(a.y)],
              e: [Math.round(e.x), Math.round(e.y)],
              free,
            });
        }
    return out;
  }, seeds);
  console.log(
    rows.length
      ? rows.map((r) => JSON.stringify(r)).join("\n")
      : "all maps connect",
  );
  await browser.close();
})();
