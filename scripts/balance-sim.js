// Start npm start first. Simulates each campaign level with an idle player and prints pressure timelines.
const { chromium } = require("@playwright/test");
(async () => {
  const levels = (process.argv[2] || "0,1,2,3,4,5").split(",").map(Number),
    minutes = Number(process.argv[3] || 8);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  for (const level of levels) {
    const out = await page.evaluate(
      ({ level, minutes }) => {
        document.getElementById("front-menu").hidden = true;
        cruciata.start(level);
        const rows = [];
        for (let m = 0; m < minutes; m++) {
          cruciata.liveFrame(30 * 60);
          const s = cruciata.snapshot();
          rows.push({
            min: m + 1,
            result: s.result || null,
            mine: s.units.filter((u) => u.team === 0).length,
            army: s.units.filter(
              (u) => u.team === 0 && !["worker", "civilian"].includes(u.type),
            ).length,
            foes: s.units.filter((u) => u.team === 1).length,
            myB: s.buildings.filter((b) => b.team === 0 && b.hp > 0).length,
            foeB: s.buildings.filter((b) => b.team === 1 && b.hp > 0).length,
            food: Math.round(s.food),
            wood: Math.round(s.wood),
            gold: Math.round(s.gold),
            stone: Math.round(s.stone),
            objective:
              s.objective &&
              (s.objective.text ||
                s.objective.label ||
                JSON.stringify(s.objective).slice(0, 80)),
          });
          if (s.result) break;
        }
        return rows;
      },
      { level, minutes },
    );
    console.log("LEVEL", level);
    for (const r of out) console.log(JSON.stringify(r));
  }
  await browser.close();
})();
