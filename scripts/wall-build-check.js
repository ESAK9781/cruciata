// Start npm start first. Plans corner/diagonal walls with real mouse input and checks that builders finish them: node scripts/wall-build-check.js [trials]
const { chromium } = require("@playwright/test");
(async () => {
  const trials = Number(process.argv[2] || 6);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.cheat?.("resources");
  });
  for (let t = 0; t < trials; t++) {
    const info = await page.evaluate(() => {
      const s = cruciata.internals().state;
      const workers = s.units.filter(
        (u) => u.team === 0 && u.type === "worker" && u.hp > 0,
      );
      const tc = s.buildings.find(
        (b) => b.team === 0 && b.kind === "towncenter",
      );
      return { ids: workers.map((w) => w.id), x: tc.x, y: tc.y };
    });
    await page.evaluate(({ x, y }) => cruciata.camera(x, y), info);
    await page.waitForTimeout(100);
    const sel = await page.evaluate(({ x, y, ids }) => {
      const I = cruciata.internals();
      // select all workers directly through the real UI button
      document.getElementById("workers-button").click();
      return { n: cruciata.snapshot().selected.length };
    }, info);
    const ox = (t % 2 ? 1 : -1) * 250,
      oy = 150 + t * 20;
    const A = await page.evaluate(
      ({ x, y, ox, oy }) => cruciata.project(x + ox, y + oy),
      { ...info, ox, oy },
    );
    const B = await page.evaluate(
      ({ x, y, ox, oy, extra }) =>
        cruciata.project(x + ox + 260, y + oy + 130 + extra),
      { ...info, ox, oy, extra: (t % 3) * 30 },
    );
    await page.click("#build-wall");
    await page.mouse.move(A.x, A.y);
    await page.mouse.down();
    await page.mouse.move(B.x, A.y, { steps: 4 });
    await page.mouse.move(B.x, B.y, { steps: 4 });
    await page.mouse.up();
    const result = await page.evaluate(() => {
      const planned = cruciata
        .snapshot()
        .buildings.filter(
          (b) => b.team === 0 && b.kind === "wall" && b.progress < 1,
        ).length;
      let done = null;
      for (let i = 0; i < 180 * 30; i++) {
        cruciata.liveFrame(1);
        if (i % 30 === 0) {
          const left = cruciata
            .internals()
            .state.buildings.filter(
              (b) =>
                b.team === 0 && b.kind === "wall" && b.hp > 0 && b.progress < 1,
            ).length;
          if (!left) {
            done = i / 30;
            break;
          }
        }
      }
      const s = cruciata.internals().state;
      return {
        planned,
        done,
        left: s.buildings.filter(
          (b) =>
            b.team === 0 && b.kind === "wall" && b.hp > 0 && b.progress < 1,
        ).length,
        idle: s.units.filter(
          (u) => u.team === 0 && u.type === "worker" && !u.job && !u.order,
        ).length,
        sel: cruciata.snapshot().selected.length,
      };
    });
    console.log(t, JSON.stringify(result));
  }
  await browser.close();
})();
