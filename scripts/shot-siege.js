// Start npm start first. Screenshots trebuchets bombarding Jerusalem's walls: node scripts/shot-siege.js [prefix].
const { chromium } = require("@playwright/test");
(async () => {
  const out = process.argv[2] || "artifacts/shots/siege";
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
  const spot = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    document.body.classList.add("shot");
    cruciata.start(5);
    let spot;
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      const tower = s.buildings.find(
        (b) => b.team === 1 && b.kind === "tower" && b.wallAttachment,
      );
      spot = { x: tower.x, y: tower.y };
      const template = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = s.units.filter((u) => u.team === 1 && false);
      for (let i = 0; i < 4; i++) {
        const u = JSON.parse(JSON.stringify(template));
        Object.assign(u, {
          id: 99000 + i,
          type: "trebuchet",
          team: 0,
          x: tower.x - 520 - (i % 2) * 60,
          y: tower.y - 60 + i * 55,
          deployment: "deployed",
          cooldown: i * 1.5,
          stance: "fight",
          order: null,
          target: null,
          hp: 600,
          maxHp: 600,
          fireTarget: { x: tower.x + (i - 2) * 30, y: tower.y + 20 },
          hold: false,
        });
        s.units.push(u);
      }
    });
    cruciata.camera(spot.x - 220, spot.y);
    return spot;
  });
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => cruciata.liveFrame(75));
    await page.waitForTimeout(150);
    await page.locator("#game").screenshot({ path: `${out}-${k}.png` });
  }
  await browser.close();
})();
