// Start npm start first. Screenshots three-person unit clusters: node scripts/shot-cluster.js [prefix]
const { chromium } = require("@playwright/test");
(async () => {
  const out = process.argv[2] || "artifacts/shots/cluster";
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
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      s.nodes = [];
      const template = s.units.find((u) => u.team === 0 && u.type === "sword");
      s.units = [];
      const types = [
        "sword",
        "archer",
        "knight",
        "chaplain",
        "worker",
        "sword",
      ];
      for (let i = 0; i < 6; i++) {
        const u = JSON.parse(JSON.stringify(template));
        Object.assign(u, {
          id: 99000 + i,
          type: types[i],
          x: 1300 + i * 90,
          y: 2400,
          order: null,
          path: [],
          target: null,
          stance: "stand-down",
          hp: i === 5 ? 60 : 200,
          maxHp: 200,
        });
        s.units.push(u);
      }
      // A formation block in the open.
      for (let i = 0; i < 60; i++) {
        const u = JSON.parse(JSON.stringify(template));
        Object.assign(u, {
          id: 99100 + i,
          type: i % 5 === 3 ? "archer" : "sword",
          x: 1150 + (i % 10) * 34,
          y: 2560 + Math.floor(i / 10) * 34,
          order: null,
          path: [],
          target: null,
          stance: "stand-down",
          hp: 200,
          maxHp: 200,
        });
        s.units.push(u);
      }
      s.units.push(...[]);
    });
    cruciata.camera(1500, 2540);
  });
  await page.mouse.move(640, 400);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(500);
  await page.evaluate(() => cruciata.step(2));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "-still.png" });
  // march the block
  await page.evaluate(() => {
    const ids = cruciata
      .snapshot()
      .units.filter((u) => u.id >= 99100)
      .map((u) => u.id);
    cruciata.order(ids, { x: 1900, y: 2560 });
    for (let i = 0; i < 40; i++) cruciata.liveFrame(1);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "-march.png" });
  for (let i = 0; i < 9; i++) await page.mouse.wheel(0, 300);
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) cruciata.liveFrame(1);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "-far.png" });
  await browser.close();
})();
