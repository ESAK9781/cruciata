const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto("http://127.0.0.1:3000/?test"); await page.locator("#open-campaign").click();
  const r = await page.evaluate(() => { document.getElementById("front-menu").hidden = true; cruciata.start(5); cruciata.step(5);
    const t = []; for (let i = 0; i < 3; i++) { const a = performance.now(); cruciata.save(); t.push(performance.now() - a); }
    return { t, size: Object.keys(localStorage).map(k => [k, localStorage[k].length]) }; });
  console.log(JSON.stringify(r)); await b.close(); })();
