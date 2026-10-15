// Start npm start first. Screenshots attached towers, bastion walls and gates in a campaign level.
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 5), out = process.argv[3] || "artifacts/shots/walls";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const spots = await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.scenario((s) => { s.cheats = { reveal: true }; });
    const s = cruciata.snapshot();
    const pick = (f) => s.buildings.filter(f);
    return {
      tower: pick((b) => b.kind === "tower" && b.wallAttachment).slice(0, 3).map((b) => [b.x, b.y]),
      bastion: pick((b) => b.kind === "wall" && b.fortified).slice(0, 2).map((b) => [b.x, b.y]),
      gate: pick((b) => b.kind === "gate").slice(0, 2).map((b) => [b.x, b.y]),
      wall: pick((b) => b.kind === "wall" && !b.fortified).slice(0, 1).map((b) => [b.x, b.y]),
      n: s.buildings.length,
    };
  }, level);
  console.log(JSON.stringify(spots));
  let i = 0;
  for (const [name, list] of Object.entries(spots)) {
    if (!Array.isArray(list)) continue;
    for (const [x, y] of list) {
      await page.evaluate(([x, y]) => { cruciata.camera(x, y); }, [x, y]);
      await page.mouse.move(600, 400);
      for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -300);
      await page.waitForTimeout(500);
      await page.evaluate(([x, y]) => { cruciata.camera(x, y); }, [x, y]);
      await page.waitForTimeout(600);
      await page.locator("canvas").first().screenshot({ path: `${out}-${name}-${i++}.png` });
      for (let k = 0; k < 6; k++) await page.mouse.wheel(0, 300);
    }
  }
  await browser.close();
})();
