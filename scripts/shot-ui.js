// Start npm start first. Captures the menu and in-game HUD at desktop and phone widths.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h] of [
    ["desktop", 1440, 900],
    ["phone", 390, 800],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => console.log("PAGEERROR", name, e.message));
    await page.goto("http://127.0.0.1:3000/?test");
    await page.screenshot({ path: `artifacts/shots/ui-${name}-menu.png` });
    await page.locator("#open-campaign").click();
    await page.screenshot({ path: `artifacts/shots/ui-${name}-chapters.png` });
    await page.evaluate(() => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(1);
      cruciata.step(2);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/shots/ui-${name}-game.png` });
    await page.close();
  }
  await browser.close();
})();
