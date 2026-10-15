// Start npm start first. Reports the navigation job behind any frame slower than a threshold.
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 3),
    seconds = Number(process.argv[3] || 240),
    threshold = Number(process.argv[4] || 150);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const out = await page.evaluate(
    ({ level, seconds, threshold }) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      const I = cruciata.internals(),
        nav = I.nav,
        orig = nav.process.bind(nav),
        slow = [];
      nav.process = (budget, limit) => {
        const t = performance.now(),
          job = nav.activeJob || nav.jobs[0];
        const info = job && {
          start: [Math.round(job.start.x), Math.round(job.start.y)],
          dest: [Math.round(job.destination.x), Math.round(job.destination.y)],
          priority: job.priority,
          owners: [...(job.owners || [])].slice(0, 2),
        };
        orig(budget, limit);
        const ms = performance.now() - t;
        if (ms > threshold)
          slow.push({
            at: +I.state.time.toFixed(1),
            ms: Math.round(ms),
            info,
            pending: nav.pending.size,
          });
      };
      const frames = [];
      for (let i = 0; i < seconds * 30; i++) {
        const t = performance.now(),
          before = I.state.time;
        cruciata.liveFrame(1);
        const ms = performance.now() - t;
        if (ms > threshold)
          frames.push({ at: +I.state.time.toFixed(1), ms: Math.round(ms) });
      }
      return { slow, frames: frames.slice(0, 20) };
    },
    { level, seconds, threshold },
  );
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
