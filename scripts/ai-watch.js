// Start npm start first. Watches enemy assaults: node scripts/ai-watch.js <level> <seconds>.
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 2),
    seconds = Number(process.argv[3] || 600);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const rows = await page.evaluate(
    ({ level, seconds }) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const { state } = cruciata.internals();
      const out = [];
      for (let i = 0; i < seconds * 30; i++) {
        cruciata.liveFrame(1);
        if (i % 1800 === 0) {
          const ai = state.enemy,
            army = state.units.filter(
              (u) => u.team === 1 && u.hp > 0 && u.type !== "civilian",
            ),
            mine = state.units.filter((u) => u.team === 0 && u.hp > 0);
          out.push({
            t: Math.round(state.time),
            army: army.length,
            raiders: army.filter((u) => u.assault).length,
            assault: ai.assault ? Math.round(state.time - ai.assault.at) : null,
            failures: ai.failures || 0,
            intel:
              ai.intel &&
              Object.values(ai.intel)
                .map((v) => v.toFixed(0))
                .join("/"),
            mine: mine.length,
            workers: state.units.filter(
              (u) => u.team === 1 && u.type === "worker" && u.hp > 0,
            ).length,
            idle: state.units.filter(
              (u) =>
                u.team === 1 &&
                u.type === "worker" &&
                u.hp > 0 &&
                !u.job &&
                !u.order,
            ).length,
            bases: state.buildings.filter(
              (b) =>
                b.team === 1 &&
                b.kind === "towncenter" &&
                b.hp > 0 &&
                b.progress >= 1,
            ).length,
            camps: state.buildings.filter(
              (b) =>
                b.team === 1 &&
                ["lumbercamp", "miningcamp", "mill"].includes(b.kind) &&
                b.hp > 0,
            ).length,
            prod: state.buildings.filter(
              (b) =>
                b.team === 1 &&
                ["barracks", "stable", "siegeworkshop"].includes(b.kind) &&
                b.hp > 0,
            ).length,
            res: Object.values(ai.resources)
              .map((v) => Math.round(v))
              .join("/"),
            result: state.result || "",
          });
        }
      }
      return out;
    },
    { level, seconds },
  );
  for (const r of rows) console.log(JSON.stringify(r));
  await browser.close();
})();
