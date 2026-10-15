const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto("http://127.0.0.1:3000/?test"); await page.locator("#open-campaign").click();
  const r = await page.evaluate(() => { document.getElementById("front-menu").hidden = true; cruciata.start(5); cruciata.step(5);
    const t = []; for (let i = 0; i < 3; i++) { const a = performance.now(); cruciata.scenario(() => {}); t.push(performance.now() - a); }
    // per-step cost breakdown
    const s = []; for (let i = 0; i < 100; i++) { const a = performance.now(); cruciata.step(1/30); s.push(performance.now() - a); }
    s.sort((x, y) => x - y);
    return { rebuildPlusFog: t, step: { med: s[50], p95: s[95], max: s[99] } }; });
  console.log(JSON.stringify(r)); await b.close(); })();
