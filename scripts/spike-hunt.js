// Start npm start first. Runs live frames and lists steps slower than a threshold, with the CPU profile of the worst.
const { chromium } = require("@playwright/test");
(async () => {
  const levels = (process.argv[2] || "0,3,5").split(",").map(Number),
    minutes = Number(process.argv[3] || 4),
    threshold = Number(process.argv[4] || 30);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  for (const level of levels) {
    const out = await page.evaluate(
      ({ level, minutes, threshold }) => {
        document.getElementById("front-menu").hidden = true;
        cruciata.start(level);
        const spikes = [];
        let worst = 0,
          total = 0,
          n = 0;
        for (let i = 0; i < minutes * 60 * 30; i++) {
          const [ms] = cruciata.liveFrame(1);
          total += ms;
          n++;
          worst = Math.max(worst, ms);
          if (ms > threshold) spikes.push([Math.round(i / 30), +ms.toFixed(0)]);
        }
        return {
          level,
          avg: +(total / n).toFixed(2),
          worst: +worst.toFixed(0),
          spikes: spikes.slice(0, 25),
          spikeCount: spikes.length,
        };
      },
      { level, minutes, threshold },
    );
    console.log(JSON.stringify(out));
  }
  await browser.close();
})();
