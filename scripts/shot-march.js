// Start npm start first. Screenshots a marching company: node scripts/shot-march.js [prefix].
const { chromium } = require("@playwright/test");
(async () => {
  const out = process.argv[2] || "artifacts/shots/march";
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  await page.addStyleTag({
    content:
      ".shot #objective-panel,.shot .map-controls,.shot #control-groups,.shot .minimap-frame,.shot .map-caption{visibility:hidden}",
  });
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    document.body.classList.add("shot");
    cruciata.start(0);
    const ids = [];
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      s.nodes = [];
      const template = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = [];
      const types = [
        "sword",
        "sword",
        "archer",
        "knight",
        "sword",
        "archer",
        "standard",
        "sword",
      ];
      for (let i = 0; i < 48; i++) {
        const u = JSON.parse(JSON.stringify(template));
        Object.assign(u, {
          id: 99000 + i,
          type: types[i % types.length],
          x: 1200 + (i % 8) * 34,
          y: 2400 + Math.floor(i / 8) * 34,
          order: null,
          path: [],
          target: null,
          stance: "stand-down",
          hp: 200,
          maxHp: 200,
        });
        s.units.push(u);
        ids.push(u.id);
      }
    });
    window.marchIds = ids;
    cruciata.camera(1900, 2500);
    cruciata.order(ids, { x: 2700, y: 2200 });
  });
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => cruciata.liveFrame(45));
    await page.waitForTimeout(120);
    await page.locator("#game").screenshot({ path: `${out}-${k}.png` });
  }
  await browser.close();
})();
