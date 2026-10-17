// Reference screenshots of the web UI for comparison with the native client.
const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const out = process.argv[2] || "artifacts/rust-shots";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto("http://127.0.0.1:3000/?test");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + "/js-menu.png" });
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "/js-game.png" });
  await page.evaluate(() => {
    const I = cruciata.internals();
    const b = I.state.buildings.find((x) => x.team === 0 && x.kind === "towncenter");
    document.getElementById("settlement-tab").click();
    window.__b = b;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/js-build.png" });
  await page.click("#army-tab");
  const box = await page.evaluate(() => {
    const p = cruciata.project(window.__b.x, window.__b.y);
    return p;
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + "/js-selected.png" });
  await browser.close();
})();
